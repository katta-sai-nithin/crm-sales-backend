import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createAuthenticatedUser, daysFromNow } from '../setup/helpers.js';
import { ROLES } from '../../src/constants/roles.js';
import { Customer } from '../../src/models/Customer.js';
import { Deal } from '../../src/models/Deal.js';
import { Activity } from '../../src/models/Activity.js';

const validDeal = (customerId, overrides = {}) => ({
  name: 'Enterprise Licence',
  customer: customerId,
  dealValue: 20000,
  probability: 50,
  expectedClosingDate: daysFromNow(30),
  description: 'Test deal',
  ...overrides,
});

describe('deal creation and financial rules', () => {
  let admin;
  let executive;
  let customer;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executive = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    customer = await Customer.create({
      name: 'Acme',
      email: 'acme@test.com',
      assignedTo: executive.user._id,
    });
  });

  it('creates a deal and computes expected revenue on the server', async () => {
    const response = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(validDeal(customer.id, { dealValue: 19999.99, probability: 33 }));

    expect(response.status).toBe(201);
    // 19999.99 x 33 / 100 = 6599.9967 -> rounded half-up to 2 decimals = 6600
    expect(response.body.data.expectedRevenue).toBe(6600);
    expect(response.body.data.stage).toBe('QUALIFICATION');
    expect(response.body.data.currency).toBe('USD');
    expect(response.body.data.closedAt).toBeNull();
  });

  it('rejects a deal value of zero or less', async () => {
    const zero = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(validDeal(customer.id, { dealValue: 0 }));
    expect(zero.status).toBe(400);

    const negative = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(validDeal(customer.id, { dealValue: -100 }));
    expect(negative.status).toBe(400);
  });

  it('rejects a probability outside 0-100', async () => {
    const tooHigh = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(validDeal(customer.id, { probability: 101 }));
    expect(tooHigh.status).toBe(400);

    const negative = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(validDeal(customer.id, { probability: -1 }));
    expect(negative.status).toBe(400);
  });

  it('rejects a past closing date for an active deal', async () => {
    const response = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(validDeal(customer.id, { expectedClosingDate: daysFromNow(-5) }));
    expect(response.status).toBe(422);
  });

  it('rejects a non-existent customer', async () => {
    const response = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(validDeal('507f1f77bcf86cd799439011'));
    expect(response.status).toBe(400);
  });

  it('ignores a client supplied expectedRevenue', async () => {
    const response = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(validDeal(customer.id, { dealValue: 1000, probability: 10, expectedRevenue: 999999 }));

    expect(response.status).toBe(400); // unknown / server controlled field rejected
  });

  it('ignores a client supplied createdBy', async () => {
    const response = await request(app)
      .post('/api/v1/deals')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send(validDeal(customer.id, { createdBy: executive.user.id }));
    expect(response.status).toBe(400);
  });
});

describe('deal stage transitions', () => {
  let admin;
  let deal;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    const customer = await Customer.create({
      name: 'Stage Co',
      email: 'stage@test.com',
      assignedTo: admin.user._id,
    });
    deal = await Deal.create({
      name: 'Staged deal',
      customer: customer._id,
      assignedTo: admin.user._id,
      dealValue: 10000,
      probability: 40,
      expectedRevenue: 4000,
      expectedClosingDate: daysFromNow(30),
      createdBy: admin.user._id,
    });
  });

  it('moves through the forward pipeline', async () => {
    const toDiscovery = await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'DISCOVERY' });
    expect(toDiscovery.status).toBe(200);

    const toProposal = await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'PROPOSAL' });
    expect(toProposal.status).toBe(200);
    expect(toProposal.body.data.stage).toBe('PROPOSAL');
  });

  it('rejects a backwards transition with 422', async () => {
    await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'DISCOVERY' });

    const response = await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'QUALIFICATION' });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('wins a deal: probability normalised to 100, closedAt set', async () => {
    const response = await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'WON' });

    expect(response.status).toBe(200);
    expect(response.body.data.stage).toBe('WON');
    expect(response.body.data.probability).toBe(100);
    expect(response.body.data.expectedRevenue).toBe(10000);
    expect(response.body.data.closedAt).toBeTruthy();
  });

  it('loses a deal only with a lostReason', async () => {
    const noReason = await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'LOST' });
    expect(noReason.status).toBe(422);

    const withReason = await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'LOST', lostReason: 'Budget frozen' });
    expect(withReason.status).toBe(200);
    expect(withReason.body.data.lostReason).toBe('Budget frozen');
    expect(withReason.body.data.closedAt).toBeTruthy();
  });

  it('prevents a closed deal from returning to an active stage', async () => {
    await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'WON' });

    const response = await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'NEGOTIATION' });

    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/reopen/i);
  });

  it('refuses to update commercial fields of a closed deal', async () => {
    await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'WON' });

    const response = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ dealValue: 50000 });

    expect(response.status).toBe(422);
  });

  it('reopens a closed deal through the explicit endpoint only', async () => {
    await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'LOST', lostReason: 'Competitor' });

    const badStage = await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'DISCOVERY' });
    expect(badStage.status).toBe(422);

    const reopen = await request(app)
      .post(`/api/v1/deals/${deal.id}/reopen`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'DISCOVERY', reason: 'Customer came back' });

    expect(reopen.status).toBe(200);
    expect(reopen.body.data.stage).toBe('DISCOVERY');
    expect(reopen.body.data.closedAt).toBeNull();
    expect(reopen.body.data.lostReason).toBe('');
  });

  it('requires a reason to reopen', async () => {
    await request(app)
      .patch(`/api/v1/deals/${deal.id}/stage`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'WON' });

    const response = await request(app)
      .post(`/api/v1/deals/${deal.id}/reopen`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ stage: 'NEGOTIATION' });

    expect(response.status).toBe(400);
  });
});

describe('deal updates, assignment and ownership', () => {
  let admin;
  let executiveA;
  let executiveB;
  let customer;
  let deal;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executiveA = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    executiveB = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    customer = await Customer.create({
      name: 'Owner Co',
      email: 'owner@test.com',
      assignedTo: executiveA.user._id,
    });
    deal = await Deal.create({
      name: 'Owned deal',
      customer: customer._id,
      assignedTo: executiveA.user._id,
      dealValue: 1000,
      probability: 20,
      expectedRevenue: 200,
      expectedClosingDate: daysFromNow(15),
      createdBy: admin.user._id,
    });
  });

  it('recomputes expected revenue when the value or probability changes', async () => {
    const response = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`)
      .send({ dealValue: 4000, probability: 25 });

    expect(response.status).toBe(200);
    expect(response.body.data.dealValue).toBe(4000);
    expect(response.body.data.expectedRevenue).toBe(1000);
  });

  it('hides a deal from a user outside its scope', async () => {
    const response = await request(app)
      .get(`/api/v1/deals/${deal.id}`)
      .set('Authorization', `Bearer ${executiveB.tokens.accessToken}`);
    expect(response.status).toBe(404);
  });

  it('lets the owner read and update their own deal', async () => {
    const response = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`)
      .send({ description: 'Updated by owner' });
    expect(response.status).toBe(200);
  });

  it('forbids an executive from reassigning a deal to somebody else', async () => {
    const response = await request(app)
      .patch(`/api/v1/deals/${deal.id}/assignment`)
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`)
      .send({ assignedTo: executiveB.user.id });
    expect(response.status).toBe(403);
  });

  it('lets an admin reassign a deal and records it on the timeline', async () => {
    const response = await request(app)
      .patch(`/api/v1/deals/${deal.id}/assignment`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ assignedTo: executiveB.user.id });

    expect(response.status).toBe(200);

    const timeline = await request(app)
      .get(`/api/v1/deals/${deal.id}/timeline`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);

    const entry = timeline.body.data.find((item) => item.action === 'DEAL_ASSIGNED');
    expect(entry.previousValue.assignedTo).toBe(executiveA.user.id);
    expect(entry.newValue.assignedTo).toBe(executiveB.user.id);
  });

  it('refuses to delete a deal with activities', async () => {
    await Activity.create({
      type: 'NOTE',
      title: 'Note',
      assignedTo: executiveA.user._id,
      relatedEntityType: 'DEAL',
      relatedEntityId: deal._id,
      createdBy: admin.user._id,
    });

    const response = await request(app)
      .delete(`/api/v1/deals/${deal.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(422);
  });

  it('refuses deletion by a sales executive', async () => {
    const response = await request(app)
      .delete(`/api/v1/deals/${deal.id}`)
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`);
    expect(response.status).toBe(403);
  });
});

describe('deal listing filters', () => {
  let admin;
  let customer;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    customer = await Customer.create({
      name: 'Filter Co',
      email: 'filter@test.com',
      assignedTo: admin.user._id,
    });

    await Deal.create([
      { name: 'Small open', customer: customer._id, assignedTo: admin.user._id, dealValue: 1000, probability: 10, expectedRevenue: 100, expectedClosingDate: daysFromNow(10), stage: 'QUALIFICATION', createdBy: admin.user._id },
      { name: 'Large open', customer: customer._id, assignedTo: admin.user._id, dealValue: 90000, probability: 90, expectedRevenue: 81000, expectedClosingDate: daysFromNow(60), stage: 'PROPOSAL', createdBy: admin.user._id },
      { name: 'Closed won', customer: customer._id, assignedTo: admin.user._id, dealValue: 5000, probability: 100, expectedRevenue: 5000, expectedClosingDate: daysFromNow(-5), stage: 'WON', closedAt: new Date(), createdBy: admin.user._id },
    ]);
  });

  it('filters by stage', async () => {
    const response = await request(app)
      .get('/api/v1/deals?stage=WON')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Closed won');
  });

  it('filters by a deal value range', async () => {
    const response = await request(app)
      .get('/api/v1/deals?minValue=2000&maxValue=100000')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);

    expect(response.body.data.map((deal) => deal.name).sort()).toEqual(['Closed won', 'Large open']);
  });

  it('filters by closing date range', async () => {
    const response = await request(app)
      .get(`/api/v1/deals?closingFrom=${daysFromNow(0)}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.body.data).toHaveLength(2);
  });

  it('sorts by deal value', async () => {
    const response = await request(app)
      .get('/api/v1/deals?sortBy=dealValue&sortOrder=desc')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.body.data[0].name).toBe('Large open');
  });

  it('searches by name', async () => {
    const response = await request(app)
      .get('/api/v1/deals?search=Large')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.body.data).toHaveLength(1);
  });

  it('rejects a negative minValue', async () => {
    const response = await request(app)
      .get('/api/v1/deals?minValue=-100')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(400);
  });
});