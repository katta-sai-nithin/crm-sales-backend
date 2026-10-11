import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createAuthenticatedUser, createLead, createTeam, daysFromNow } from '../setup/helpers.js';
import { ROLES } from '../../src/constants/roles.js';
import { Customer } from '../../src/models/Customer.js';
import { Deal } from '../../src/models/Deal.js';
import { Activity } from '../../src/models/Activity.js';

describe('GET /api/v1/analytics/dashboard', () => {
  let admin;
  let executive;
  let customer;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executive = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    customer = await Customer.create({ name: 'Analytics Co', email: 'analytics@test.com', assignedTo: executive.user._id });
  });

  it('returns all metrics with a safe conversion rate', async () => {
    await createLead({ status: 'NEW' }, admin.user, executive.user);
    await createLead({ status: 'QUALIFIED' }, admin.user, executive.user);
    await createLead({ status: 'CONVERTED' }, admin.user, executive.user);
    await createLead({ status: 'LOST' }, admin.user, executive.user);

    await Deal.create([
      { name: 'Open deal', customer: customer._id, assignedTo: executive.user._id, dealValue: 10000, probability: 50, expectedRevenue: 5000, expectedClosingDate: daysFromNow(20), stage: 'PROPOSAL', createdBy: admin.user._id },
      { name: 'Won deal', customer: customer._id, assignedTo: executive.user._id, dealValue: 20000, probability: 100, expectedRevenue: 20000, expectedClosingDate: daysFromNow(-5), stage: 'WON', closedAt: new Date(), createdBy: admin.user._id },
      { name: 'Lost deal', customer: customer._id, assignedTo: executive.user._id, dealValue: 3000, probability: 0, expectedRevenue: 0, expectedClosingDate: daysFromNow(-2), stage: 'LOST', lostReason: 'No budget', closedAt: new Date(), createdBy: admin.user._id },
    ]);

    await Activity.create([
      { type: 'CALL', title: 'Future', assignedTo: executive.user._id, dueDate: daysFromNow(3), relatedEntityType: 'LEAD', relatedEntityId: customer._id, createdBy: admin.user._id },
      { type: 'CALL', title: 'Past', assignedTo: executive.user._id, dueDate: daysFromNow(-3), relatedEntityType: 'LEAD', relatedEntityId: customer._id, createdBy: admin.user._id },
      { type: 'CALL', title: 'Done', assignedTo: executive.user._id, status: 'COMPLETED', completedAt: new Date(), relatedEntityType: 'LEAD', relatedEntityId: customer._id, createdBy: admin.user._id },
    ]);

    const response = await request(app)
      .get('/api/v1/analytics/dashboard')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);

    expect(response.status).toBe(200);
    const data = response.body.data;

    expect(data.leads.total).toBe(4);
    expect(data.leads.new).toBe(1);
    expect(data.leads.qualified).toBe(1);
    expect(data.leads.converted).toBe(1);
    expect(data.leads.lost).toBe(1);

    // eligible = qualified + converted + lost + unqualified = 3
    expect(data.leads.eligible).toBe(3);
    expect(data.leads.conversionRate).toBeCloseTo(33.33, 2);

    expect(data.customers.total).toBe(1);
    expect(data.deals.total).toBe(3);
    expect(data.deals.open).toBe(1);
    expect(data.deals.won).toBe(1);
    expect(data.deals.lost).toBe(1);
    expect(data.deals.wonRevenue).toBe(20000);
    expect(data.deals.openExpectedRevenue).toBe(5000);
    expect(data.deals.winRate).toBe(50);

    expect(data.activities.pending).toBe(1);
    expect(data.activities.overdue).toBe(1);
    expect(data.activities.completed).toBe(1);
  });

  it('returns zeroes instead of NaN when there is no data', async () => {
    const response = await request(app)
      .get('/api/v1/analytics/dashboard')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.leads.conversionRate).toBe(0);
    expect(response.body.data.deals.winRate).toBe(0);
    expect(response.body.data.deals.wonRevenue).toBe(0);
  });

  it('scopes the dashboard to the caller', async () => {
    const other = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    await createLead({ name: 'Mine' }, admin.user, executive.user);
    await createLead({ name: 'Theirs' }, admin.user, other.user);

    const asExec = await request(app)
      .get('/api/v1/analytics/dashboard')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);
    expect(asExec.body.data.leads.total).toBe(1);
    expect(asExec.body.data.scope).toBe(ROLES.SALES_EXECUTIVE);

    const asAdmin = await request(app)
      .get('/api/v1/analytics/dashboard')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(asAdmin.body.data.leads.total).toBe(2);
    expect(asAdmin.body.data.scope).toBe(ROLES.ADMIN);
  });

  it('requires authentication', async () => {
    const response = await request(app).get('/api/v1/analytics/dashboard');
    expect(response.status).toBe(401);
  });
});

describe('GET /api/v1/analytics/pipeline', () => {
  let admin;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    const customer = await Customer.create({ name: 'Pipe Co', email: 'pipe@test.com', assignedTo: admin.user._id });

    await Deal.create([
      { name: 'Q1', customer: customer._id, assignedTo: admin.user._id, dealValue: 1000, probability: 10, expectedRevenue: 100, expectedClosingDate: daysFromNow(30), stage: 'QUALIFICATION', createdBy: admin.user._id },
      { name: 'Q2', customer: customer._id, assignedTo: admin.user._id, dealValue: 2000, probability: 20, expectedRevenue: 400, expectedClosingDate: daysFromNow(30), stage: 'QUALIFICATION', createdBy: admin.user._id },
      { name: 'P1', customer: customer._id, assignedTo: admin.user._id, dealValue: 5000, probability: 60, expectedRevenue: 3000, expectedClosingDate: daysFromNow(45), stage: 'PROPOSAL', createdBy: admin.user._id },
    ]);
  });

  it('groups deals by stage with counts and values', async () => {
    const response = await request(app)
      .get('/api/v1/analytics/pipeline')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);

    expect(response.status).toBe(200);
    const stages = response.body.data.stages;
    expect(stages).toHaveLength(6);

    const qualification = stages.find((stage) => stage.stage === 'QUALIFICATION');
    expect(qualification.count).toBe(2);
    expect(qualification.totalValue).toBe(3000);
    expect(qualification.expectedRevenue).toBe(500);
    expect(qualification.isOpen).toBe(true);

    const won = stages.find((stage) => stage.stage === 'WON');
    expect(won.count).toBe(0);
    expect(won.isOpen).toBe(false);

    expect(response.body.data.totals.dealCount).toBe(3);
    expect(response.body.data.totals.openDealCount).toBe(3);
    expect(response.body.data.totals.openExpectedRevenue).toBe(3500);
  });
});

describe('GET /api/v1/analytics/team-performance', () => {
  let admin;
  let manager;
  let executiveA;
  let executiveB;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executiveA = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    executiveB = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    manager = await createAuthenticatedUser({ role: ROLES.SALES_MANAGER });
    const team = await createTeam('Perf Team', [executiveA.user._id, manager.user._id]);
    manager.user.team = team._id;
    await manager.user.save();
  });

  it('returns per-member metrics for an admin', async () => {
    await createLead({ status: 'CONVERTED' }, admin.user, executiveA.user);
    await createLead({ status: 'NEW' }, admin.user, executiveA.user);
    await createLead({ status: 'CONVERTED' }, admin.user, executiveB.user);

    const customerA = await Customer.create({ name: 'PA', email: 'pa@test.com', assignedTo: executiveA.user._id });
    await Deal.create({
      name: 'A won',
      customer: customerA._id,
      assignedTo: executiveA.user._id,
      dealValue: 5000,
      probability: 100,
      expectedRevenue: 5000,
      expectedClosingDate: daysFromNow(-1),
      stage: 'WON',
      closedAt: new Date(),
      createdBy: admin.user._id,
    });

    const response = await request(app)
      .get('/api/v1/analytics/team-performance')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);

    expect(response.status).toBe(200);
    const member = response.body.data.team.find((row) => row.userId === executiveA.user.id);
    expect(member.assignedLeads).toBe(2);
    expect(member.convertedLeads).toBe(1);
    expect(member.wonDeals).toBe(1);
    expect(member.wonRevenue).toBe(5000);
    expect(member.leadConversionRate).toBe(50);
    expect(response.body.data.totals.assignedLeads).toBe(3);
  });

  it('restricts a sales manager to their own team', async () => {
    await createLead({ status: 'NEW' }, admin.user, executiveA.user);
    await createLead({ status: 'NEW' }, admin.user, executiveB.user);

    const response = await request(app)
      .get('/api/v1/analytics/team-performance')
      .set('Authorization', `Bearer ${manager.tokens.accessToken}`);

    expect(response.status).toBe(200);
    const ids = response.body.data.team.map((row) => row.userId);
    expect(ids).toContain(executiveA.user.id);
    expect(ids).not.toContain(executiveB.user.id);
  });

  it('forbids a sales executive', async () => {
    const response = await request(app)
      .get('/api/v1/analytics/team-performance')
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`);
    expect(response.status).toBe(403);
  });
});

describe('GET /api/v1/analytics/lead-sources', () => {
  it('groups leads by source', async () => {
    const admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    await createLead({ source: 'WEBSITE', status: 'CONVERTED' }, admin.user, admin.user);
    await createLead({ source: 'WEBSITE', status: 'NEW' }, admin.user, admin.user);
    await createLead({ source: 'PHONE', status: 'NEW' }, admin.user, admin.user);

    const response = await request(app)
      .get('/api/v1/analytics/lead-sources')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);

    expect(response.status).toBe(200);
    const website = response.body.data.find((row) => row.source === 'WEBSITE');
    expect(website.total).toBe(2);
    expect(website.converted).toBe(1);
    expect(website.conversionRate).toBe(50);
  });
});

describe('GET /api/v1/health', () => {
  it('reports database connectivity and transaction support', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.data.database.connected).toBe(true);
    expect(response.body.data.database.transactionsSupported).toBe(true);
    expect(response.body.data.status).toBe('ok');
  });
});