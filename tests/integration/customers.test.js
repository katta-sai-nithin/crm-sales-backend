import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createAuthenticatedUser, createTeam, daysFromNow } from '../setup/helpers.js';
import { ROLES } from '../../src/constants/roles.js';
import { Customer } from '../../src/models/Customer.js';
import { Deal } from '../../src/models/Deal.js';

describe('customer CRUD', () => {
  let admin;
  let manager;
  let executive;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    manager = await createAuthenticatedUser({ role: ROLES.SALES_MANAGER });
    executive = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
  });

  it('creates a manual customer owned by the creator', async () => {
    const response = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ name: 'Manual Co', email: 'contact@manual.test', company: 'Manual Co' });

    expect(response.status).toBe(201);
    expect(response.body.data.origin).toBe('MANUAL');
    expect(response.body.data.originalLead).toBeNull();
    expect(response.body.data.assignedTo.id).toBe(admin.user.id);
  });

  it('forbids a sales executive from creating a customer directly', async () => {
    const response = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send({ name: 'Exec Co', email: 'exec@manual.test' });

    expect(response.status).toBe(403);
  });

  it('validates the payload', async () => {
    const response = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ name: 'No Email' });
    expect(response.status).toBe(400);
  });

  it('lists, fetches, updates and deletes a customer', async () => {
    const created = await request(app)
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ name: 'Lifecycle Co', email: 'lifecycle@test.com' });

    const id = created.body.data.id;

    const list = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(list.body.pagination.totalRecords).toBe(1);

    const single = await request(app)
      .get(`/api/v1/customers/${id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(single.status).toBe(200);

    const updated = await request(app)
      .patch(`/api/v1/customers/${id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ address: '1 Test Street' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.address).toBe('1 Test Street');

    const removed = await request(app)
      .delete(`/api/v1/customers/${id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(removed.status).toBe(204);
    expect(await Customer.findById(id)).toBeNull();
  });

  it('refuses to delete a customer that still owns deals', async () => {
    const customer = await Customer.create({
      name: 'Busy Co',
      email: 'busy@test.com',
      assignedTo: admin.user._id,
    });
    await Deal.create({
      name: 'Live deal',
      customer: customer._id,
      assignedTo: admin.user._id,
      dealValue: 1000,
      probability: 10,
      expectedRevenue: 100,
      expectedClosingDate: daysFromNow(20),
      createdBy: admin.user._id,
    });

    const response = await request(app)
      .delete(`/api/v1/customers/${customer.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/deals or activities/i);
  });

  it('scopes visibility: an executive only sees their own customers', async () => {
    await Customer.create({ name: 'Alpha Co', email: 'a@test.com', assignedTo: executive.user._id });
    await Customer.create({ name: 'Beta Co', email: 'b@test.com', assignedTo: admin.user._id });

    const response = await request(app)
      .get('/api/v1/customers')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Alpha Co');
  });

  it('reassigns a customer (manager only)', async () => {
    const team = await createTeam('Customer Team', [executive.user._id]);
    manager.user.team = team._id;
    await manager.user.save();

    const customer = await Customer.create({
      name: 'Reassignable',
      email: 'reassign@test.com',
      assignedTo: manager.user._id,
    });

    const byManager = await request(app)
      .patch(`/api/v1/customers/${customer.id}/assignment`)
      .set('Authorization', `Bearer ${manager.tokens.accessToken}`)
      .send({ assignedTo: executive.user.id });
    expect(byManager.status).toBe(200);
    expect(byManager.body.data.assignedTo.id).toBe(executive.user.id);

    const byExecutive = await request(app)
      .patch(`/api/v1/customers/${customer.id}/assignment`)
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send({ assignedTo: manager.user.id });
    expect(byExecutive.status).toBe(403);
  });

  it('lists the deals and activities of a customer', async () => {
    const customer = await Customer.create({
      name: 'With Deals',
      email: 'withdeals@test.com',
      assignedTo: admin.user._id,
    });
    await Deal.create({
      name: 'Deal 1',
      customer: customer._id,
      assignedTo: admin.user._id,
      dealValue: 5000,
      probability: 50,
      expectedRevenue: 2500,
      expectedClosingDate: daysFromNow(10),
      createdBy: admin.user._id,
    });

    const deals = await request(app)
      .get(`/api/v1/customers/${customer.id}/deals`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(deals.status).toBe(200);
    expect(deals.body.data).toHaveLength(1);

    const activities = await request(app)
      .get(`/api/v1/customers/${customer.id}/activities`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(activities.status).toBe(200);
    expect(activities.body.data).toEqual([]);
  });

  it('filters customers by origin and status', async () => {
    await Customer.create({ name: 'M1', email: 'm1@test.com', origin: 'MANUAL', assignedTo: admin.user._id });
    await Customer.create({
      name: 'C1',
      email: 'c1@test.com',
      origin: 'CONVERTED',
      assignedTo: admin.user._id,
    });

    const response = await request(app)
      .get('/api/v1/customers?origin=CONVERTED')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('C1');
  });

  it('rejects an unsupported sort field', async () => {
    const response = await request(app)
      .get('/api/v1/customers?sortBy=originalLead')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(400);
  });
});