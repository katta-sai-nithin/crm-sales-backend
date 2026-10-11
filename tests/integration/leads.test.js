import { describe, it, expect, beforeEach } from 'vitest';
import {
  request,
  app,
  createUser,
  createAuthenticatedUser,
  createTeam,
  createLead,
  daysFromNow,
} from '../setup/helpers.js';
import { ROLES } from '../../src/constants/roles.js';
import { Lead } from '../../src/models/Lead.js';

describe('lead CRUD', () => {
  let admin;
  let executive;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executive = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
  });

  it('creates a lead with a normalised email and the authenticated creator', async () => {
    const response = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({
        name: 'Acme Corp',
        email: 'Buyer@ACME.com',
        company: 'Acme',
        source: 'WEBSITE',
        priority: 'HIGH',
        assignedTo: executive.user.id,
      });

    expect(response.status).toBe(201);
    expect(response.body.data.email).toBe('buyer@acme.com');
    expect(response.body.data.status).toBe('NEW');
    expect(response.body.data.createdBy.id).toBe(admin.user.id);
    expect(response.body.data.assignedTo.id).toBe(executive.user.id);
  });

  it('validates the payload and rejects unknown fields', async () => {
    const missingEmail = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ name: 'No Email' });
    expect(missingEmail.status).toBe(400);

    const badStatus = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ name: 'Bad', email: 'bad@example.com', source: 'CARRIER_PIGEON' });
    expect(badStatus.status).toBe(400);

    const massAssign = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ name: 'Sneaky', email: 'sneaky@example.com', createdBy: executive.user.id, status: 'QUALIFIED' });
    expect(massAssign.status).toBe(400);
  });

  it('returns 400 for an invalid ObjectId in the path', async () => {
    const response = await request(app)
      .get('/api/v1/leads/not-an-id')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(400);
  });

  it('auto-assigns a lead created by a sales executive to themselves', async () => {
    const response = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send({ name: 'Exec Lead', email: 'exec.lead@example.com' });

    expect(response.status).toBe(201);
    expect(response.body.data.assignedTo.id).toBe(executive.user.id);
  });

  it('ignores an executive attempt to assign a lead to somebody else', async () => {
    const other = await createUser({ role: ROLES.SALES_EXECUTIVE });
    const response = await request(app)
      .post('/api/v1/leads')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send({ name: 'Sneaky Assign', email: 'sneaky.assign@example.com', assignedTo: other.id });

    expect(response.status).toBe(201);
    expect(response.body.data.assignedTo.id).toBe(executive.user.id);
  });

  it('patches only allowed fields', async () => {
    const lead = await createLead({}, admin.user, executive.user);

    const ok = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ company: 'New Company', priority: 'HIGH' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.company).toBe('New Company');

    const blocked = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ assignedTo: admin.user.id });
    expect(blocked.status).toBe(400);

    const statusBlocked = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ status: 'QUALIFIED' });
    expect(statusBlocked.status).toBe(400);
  });

  it('updates, fetches and deletes a lead', async () => {
    const lead = await createLead({}, admin.user, executive.user);

    const fetched = await request(app)
      .get(`/api/v1/leads/${lead.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(fetched.status).toBe(200);

    const deleted = await request(app)
      .delete(`/api/v1/leads/${lead.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(deleted.status).toBe(204);

    expect(await Lead.findById(lead.id)).toBeNull();
  });
});

describe('lead status transitions', () => {
  let admin;
  let executive;
  let lead;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executive = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    lead = await createLead({ status: 'NEW' }, admin.user, executive.user);
  });

  it('allows a valid transition', async () => {
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/status`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ status: 'CONTACTED' });
    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('CONTACTED');
  });

  it('rejects an invalid transition with 422', async () => {
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/status`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ status: 'CONVERTED' });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('BUSINESS_RULE_VIOLATION');
  });

  it('rejects a repeated transition', async () => {
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/status`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ status: 'NEW' });
    expect(response.status).toBe(422);
  });

  it('rejects an unknown status value with 400', async () => {
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/status`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ status: 'TELEPORTED' });
    expect(response.status).toBe(400);
  });
});

describe('lead assignment rules', () => {
  let admin;
  let manager;
  let teamMember;
  let outsider;
  let lead;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    teamMember = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE, name: 'Team Exec' });
    outsider = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE, name: 'Outsider' });

    const team = await createTeam('Region A', [teamMember.user._id]);
    manager = await createAuthenticatedUser({ role: ROLES.SALES_MANAGER });
    manager.user.team = team._id;
    await manager.user.save();

    // Unassigned leads form a shared pool that any sales user can see and claim.
    lead = await createLead({}, admin.user, null);
  });

  it('allows an admin to assign to an active executive', async () => {
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/assignment`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ assignedTo: teamMember.user.id });

    expect(response.status).toBe(200);
    expect(response.body.data.assignedTo.id).toBe(teamMember.user.id);
  });

  it('allows a manager to assign inside their own team', async () => {
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/assignment`)
      .set('Authorization', `Bearer ${manager.tokens.accessToken}`)
      .send({ assignedTo: teamMember.user.id });
    expect(response.status).toBe(200);
  });

  it('forbids a manager from assigning outside their team', async () => {
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/assignment`)
      .set('Authorization', `Bearer ${manager.tokens.accessToken}`)
      .send({ assignedTo: outsider.user.id });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('forbids an executive from assigning a lead to somebody else', async () => {
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/assignment`)
      .set('Authorization', `Bearer ${teamMember.tokens.accessToken}`)
      .send({ assignedTo: outsider.user.id });
    expect(response.status).toBe(403);
  });

  it('allows an executive to claim an unassigned lead for themselves', async () => {
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/assignment`)
      .set('Authorization', `Bearer ${teamMember.tokens.accessToken}`)
      .send({ assignedTo: teamMember.user.id });
    expect(response.status).toBe(200);
  });

  it('refuses assignment to an inactive user', async () => {
    await createUser({ role: ROLES.SALES_EXECUTIVE, isActive: false, email: 'gone@example.com' });
    const inactive = await (await import('../../src/models/User.js')).User.findOne({ email: 'gone@example.com' });

    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/assignment`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ assignedTo: inactive.id });
    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/active/i);
  });

  it('refuses assignment to an administrator', async () => {
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/assignment`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ assignedTo: admin.user.id });
    expect(response.status).toBe(422);
  });

  it('refuses assignment to a non existent user', async () => {
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/assignment`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ assignedTo: '507f1f77bcf86cd799439011' });
    expect(response.status).toBe(400);
  });

  it('rejects a reassignment to the same user', async () => {
    await request(app)
      .patch(`/api/v1/leads/${lead.id}/assignment`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ assignedTo: teamMember.user.id });

    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}/assignment`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ assignedTo: teamMember.user.id });
    expect(response.status).toBe(422);
  });

  it('records the previous and new assignee on the timeline', async () => {
    const ownedByAdmin = await createLead({}, admin.user, admin.user);
    await request(app)
      .patch(`/api/v1/leads/${ownedByAdmin.id}/assignment`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ assignedTo: teamMember.user.id, reason: 'Capacity' });

    const timeline = await request(app)
      .get(`/api/v1/leads/${ownedByAdmin.id}/timeline`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);

    expect(timeline.status).toBe(200);
    const entry = timeline.body.data.find((item) => item.action === 'LEAD_REASSIGNED');
    expect(entry).toBeDefined();
    expect(entry.previousValue.assignedTo).toBe(admin.user.id);
    expect(entry.newValue.assignedTo).toBe(teamMember.user.id);
    expect(entry.metadata.reason).toBe('Capacity');
  });

  it('never stores a password or token in the audit trail', async () => {
    const response = await request(app)
      .get(`/api/v1/timeline/LEAD/${lead.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('password');
    expect(body).not.toContain('token');
  });
});

describe('lead visibility scoping', () => {
  let admin;
  let execA;
  let execB;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    execA = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    execB = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
  });

  it('only lists the caller’s own leads for an executive', async () => {
    await createLead({ name: 'A Lead' }, admin.user, execA.user);
    await createLead({ name: 'B Lead' }, admin.user, execB.user);

    const response = await request(app)
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${execA.tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('A Lead');
  });

  it('hides other users’ leads with 404 (no existence disclosure)', async () => {
    const foreign = await createLead({ name: 'Secret' }, admin.user, execB.user);
    const response = await request(app)
      .get(`/api/v1/leads/${foreign.id}`)
      .set('Authorization', `Bearer ${execA.tokens.accessToken}`);
    expect(response.status).toBe(404);
  });

  it('lists every lead for an admin', async () => {
    await createLead({ name: 'A Lead' }, admin.user, execA.user);
    await createLead({ name: 'B Lead' }, admin.user, execB.user);

    const response = await request(app)
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.body.data).toHaveLength(2);
  });

  it('shows a manager their team plus their own leads', async () => {
    const team = await createTeam('Region B', [execA.user._id]);
    const manager = await createAuthenticatedUser({ role: ROLES.SALES_MANAGER });
    manager.user.team = team._id;
    await manager.user.save();

    await createLead({ name: 'Team Lead' }, admin.user, execA.user);
    await createLead({ name: 'Manager Lead' }, admin.user, manager.user);
    await createLead({ name: 'Other Lead' }, admin.user, execB.user);

    const response = await request(app)
      .get('/api/v1/leads')
      .set('Authorization', `Bearer ${manager.tokens.accessToken}`);

    expect(response.body.data).toHaveLength(2);
  });
});

describe('lead list filters, search, sorting and pagination', () => {
  let admin;
  let exec;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    exec = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
  });

  it('searches by keyword across name, company and email', async () => {
    await createLead({ name: 'Alpha Industries', company: 'Alpha', email: 'alpha@example.com' }, admin.user, exec.user);
    await createLead({ name: 'Beta Corp', company: 'Beta', email: 'beta@example.com' }, admin.user, exec.user);

    const response = await request(app)
      .get('/api/v1/leads?search=Alpha')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('Alpha Industries');
  });

  it('treats a regex metacharacter search literally', async () => {
    await createLead({ name: 'Plain Name', company: 'Plain', email: 'plain@example.com' }, admin.user, exec.user);
    await createLead({ name: 'Other', company: 'Other', email: 'other@example.com' }, admin.user, exec.user);

    const response = await request(app)
      .get('/api/v1/leads?search=.*')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.body.data).toHaveLength(0);
  });

  it('filters by status, priority and source together', async () => {
    await createLead({ status: 'QUALIFIED', priority: 'HIGH', source: 'WEBSITE' }, admin.user, exec.user);
    await createLead({ status: 'QUALIFIED', priority: 'LOW', source: 'PHONE' }, admin.user, exec.user);
    await createLead({ status: 'NEW', priority: 'HIGH', source: 'WEBSITE' }, admin.user, exec.user);

    const response = await request(app)
      .get('/api/v1/leads?status=QUALIFIED&priority=HIGH&source=WEBSITE')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.body.data).toHaveLength(1);
  });

  it('rejects an unsupported filter value', async () => {
    const response = await request(app)
      .get('/api/v1/leads?status=TELEPORTED')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(400);
  });

  it('sorts by an allow-listed field', async () => {
    await createLead({ name: 'Bravo' }, admin.user, exec.user);
    await createLead({ name: 'Alpha' }, admin.user, exec.user);

    const response = await request(app)
      .get('/api/v1/leads?sortBy=name&sortOrder=asc')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);

    expect(response.body.data[0].name).toBe('Alpha');
    expect(response.body.data[1].name).toBe('Bravo');
  });

  it('rejects sorting on a non allow-listed field', async () => {
    const response = await request(app)
      .get('/api/v1/leads?sortBy=assignedTo')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(400);
  });

  it('paginates with the standard envelope', async () => {
    for (let i = 0; i < 7; i += 1) {
      await createLead({ name: `Lead ${i}` }, admin.user, exec.user);
    }

    const page1 = await request(app)
      .get('/api/v1/leads?page=1&limit=3')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(page1.body.data).toHaveLength(3);
    expect(page1.body.pagination).toMatchObject({ page: 1, limit: 3, totalRecords: 7, totalPages: 3 });

    const page3 = await request(app)
      .get('/api/v1/leads?page=3&limit=3')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(page3.body.data).toHaveLength(1);
  });

  it('filters by a created date range', async () => {
    const old = await createLead({ name: 'Old' }, admin.user, exec.user);
    // Raw driver update so that Mongoose timestamps do not overwrite createdAt.
    await Lead.collection.updateOne(
      { _id: old._id },
      { $set: { createdAt: new Date('2020-01-01'), updatedAt: new Date('2020-01-01') } }
    );
    await createLead({ name: 'New' }, admin.user, exec.user);

    const response = await request(app)
      .get(`/api/v1/leads?dateFrom=${daysFromNow(-1)}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].name).toBe('New');
  });

  it('returns an empty result set consistently', async () => {
    const response = await request(app)
      .get('/api/v1/leads?search=nothing-matches-this')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([]);
    expect(response.body.pagination.totalRecords).toBe(0);
    expect(response.body.pagination.totalPages).toBe(0);
  });
});

describe('lead deletion rules', () => {
  let admin;
  let executive;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executive = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
  });

  it('forbids an executive from deleting a lead', async () => {
    const lead = await createLead({}, admin.user, executive.user);
    const response = await request(app)
      .delete(`/api/v1/leads/${lead.id}`)
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);
    expect(response.status).toBe(403);
  });

  it('forbids deleting a converted lead', async () => {
    const lead = await createLead({ status: 'CONVERTED' }, admin.user, executive.user);
    const response = await request(app)
      .delete(`/api/v1/leads/${lead.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(422);
  });

  it('refuses edits to a converted lead', async () => {
    const lead = await createLead({ status: 'CONVERTED' }, admin.user, executive.user);
    const response = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ company: 'Nope' });
    expect(response.status).toBe(422);
  });
});