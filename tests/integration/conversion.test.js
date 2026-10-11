import { describe, it, expect, beforeEach, vi } from 'vitest';
import { request, app, createAuthenticatedUser, createLead, daysFromNow } from '../setup/helpers.js';
import { ROLES } from '../../src/constants/roles.js';
import { Lead } from '../../src/models/Lead.js';
import { Customer } from '../../src/models/Customer.js';
import { Deal } from '../../src/models/Deal.js';
import { Timeline } from '../../src/models/Timeline.js';

const idOf = (value) =>
    typeof value === 'object' && value !== null ? String(value.id ?? value._id) : String(value);

const conversionPayload = (overrides = {}) => ({
  dealName: 'Acme - Initial Deal',
  dealValue: 50000,
  probability: 60,
  expectedClosingDate: daysFromNow(30),
  stage: 'PROPOSAL',
  description: 'Initial deal from conversion',
  ...overrides,
});

describe('POST /api/v1/leads/:id/convert', () => {
  let admin;
  let executive;
  let qualifiedLead;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executive = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    qualifiedLead = await createLead(
      { status: 'QUALIFIED', name: 'Acme Corp', email: 'buyer@acme.test', company: 'Acme Corp', phone: '+1 555 0100' },
      admin.user,
      executive.user
    );
  });

  it('converts a qualified lead into a customer and an initial deal', async () => {
    const response = await request(app)
      .post(`/api/v1/leads/${qualifiedLead.id}/convert`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(conversionPayload());

    expect(response.status).toBe(201);
    expect(response.body.data.customer).toBeTruthy();
    expect(response.body.data.deal).toBeTruthy();

    const { customer, deal, lead } = response.body.data;

    // Relationships stay consistent.
    expect(idOf(customer.originalLead)).toBe(qualifiedLead.id);
    expect(customer.origin).toBe('CONVERTED');
    expect(idOf(deal.customer)).toBe(customer.id);
    expect(idOf(deal.lead)).toBe(qualifiedLead.id);
    expect(idOf(deal.assignedTo)).toBe(executive.user.id);
    expect(idOf(deal.createdBy)).toBe(admin.user.id);

    // Server computed revenue.
    expect(deal.expectedRevenue).toBe(30000);

    // Lead is flagged as converted and linked back.
    expect(lead.status).toBe('CONVERTED');
    expect(idOf(lead.convertedCustomer)).toBe(customer.id);
    expect(idOf(lead.convertedDeal)).toBe(deal.id);
    expect(lead.convertedAt).toBeTruthy();
  });

  it('refuses to convert a lead that is not QUALIFIED', async () => {
    const newLead = await createLead({ status: 'NEW' }, admin.user, executive.user);
    const response = await request(app)
      .post(`/api/v1/leads/${newLead.id}/convert`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(conversionPayload());

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/QUALIFIED/i);

    expect(await Customer.countDocuments()).toBe(0);
    expect(await Deal.countDocuments()).toBe(0);
  });

  it('refuses a second conversion of the same lead', async () => {
    const first = await request(app)
      .post(`/api/v1/leads/${qualifiedLead.id}/convert`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(conversionPayload());
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/leads/${qualifiedLead.id}/convert`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(conversionPayload({ dealName: 'Duplicate attempt' }));

    expect(second.status).toBe(409);
    expect(await Customer.countDocuments({ originalLead: qualifiedLead.id })).toBe(1);
    expect(await Deal.countDocuments({ lead: qualifiedLead.id })).toBe(1);
  });

  it('allows only one conversion under concurrent requests', async () => {
    const attempts = await Promise.all(
      [1, 2, 3].map((index) =>
        request(app)
          .post(`/api/v1/leads/${qualifiedLead.id}/convert`)
          .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
          .send(conversionPayload({ dealName: `Concurrent deal ${index}` }))
      )
    );

    const statuses = attempts.map((attempt) => attempt.status).sort();
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(2);

    expect(await Customer.countDocuments({ originalLead: qualifiedLead.id })).toBe(1);
    expect(await Deal.countDocuments({ lead: qualifiedLead.id })).toBe(1);

    const lead = await Lead.findById(qualifiedLead.id);
    expect(lead.status).toBe('CONVERTED');
  });

  it('validates the request before writing anything', async () => {
    const response = await request(app)
      .post(`/api/v1/leads/${qualifiedLead.id}/convert`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(conversionPayload({ dealValue: -5 }));

    expect(response.status).toBe(400);
    expect(await Customer.countDocuments()).toBe(0);
    expect(await Deal.countDocuments()).toBe(0);
  });

  it('rejects a past closing date', async () => {
    const response = await request(app)
      .post(`/api/v1/leads/${qualifiedLead.id}/convert`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(conversionPayload({ expectedClosingDate: daysFromNow(-10) }));

    expect(response.status).toBe(422);
    expect(await Customer.countDocuments()).toBe(0);
  });

  it('rolls back the whole transaction when a later step fails', async () => {
    // Force the deal creation to fail inside the transaction.
    const spy = vi.spyOn(Deal, 'create').mockImplementationOnce(() => {
      throw new Error('Simulated deal creation failure');
    });

    const response = await request(app)
      .post(`/api/v1/leads/${qualifiedLead.id}/convert`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(conversionPayload());

    expect(response.status).toBe(500);
    spy.mockRestore();

    // No orphaned customer, no orphan lead mutation, no audit entries.
    expect(await Customer.countDocuments()).toBe(0);
    expect(await Deal.countDocuments()).toBe(0);

    const lead = await Lead.findById(qualifiedLead.id);
    expect(lead.status).toBe('QUALIFIED');
    expect(lead.convertedCustomer).toBeNull();

    expect(
      await Timeline.countDocuments({ entityId: qualifiedLead.id, action: 'LEAD_CONVERTED' })
    ).toBe(0);
  });

  it('writes the audit trail entries inside the transaction', async () => {
    await request(app)
      .post(`/api/v1/leads/${qualifiedLead.id}/convert`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(conversionPayload());

    const customer = await Customer.findOne({ originalLead: qualifiedLead.id });
    const deal = await Deal.findOne({ lead: qualifiedLead.id });

    expect(await Timeline.countDocuments({ entityId: qualifiedLead.id, action: 'LEAD_CONVERTED' })).toBe(1);
    expect(await Timeline.countDocuments({ entityId: customer._id, action: 'CUSTOMER_CREATED' })).toBe(1);
    expect(await Timeline.countDocuments({ entityId: deal._id, action: 'DEAL_CREATED' })).toBe(1);
  });

  it('hides a lead the caller cannot see', async () => {
    const otherExec = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    const response = await request(app)
      .post(`/api/v1/leads/${qualifiedLead.id}/convert`)
      .set('Authorization', `Bearer ${otherExec.tokens.accessToken}`)
      .send(conversionPayload());

    expect(response.status).toBe(404);
    expect(await Customer.countDocuments()).toBe(0);
  });

  it('lets the assignee convert their own lead', async () => {
    const response = await request(app)
      .post(`/api/v1/leads/${qualifiedLead.id}/convert`)
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send(conversionPayload());

    expect(response.status).toBe(201);
    expect(idOf(response.body.data.deal.assignedTo)).toBe(executive.user.id);
  });

  it('enforces the database unique index on customers.originalLead', async () => {
    await request(app)
      .post(`/api/v1/leads/${qualifiedLead.id}/convert`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(conversionPayload());

    // Bypassing the service entirely still cannot create a second customer.
    await expect(
      Customer.create({
        name: 'Duplicate',
        email: 'dup@acme.test',
        originalLead: qualifiedLead.id,
        assignedTo: executive.user._id,
      })
    ).rejects.toMatchObject({ code: 11000 });
  });
});