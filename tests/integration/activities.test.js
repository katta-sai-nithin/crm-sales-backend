import { describe, it, expect, beforeEach } from 'vitest';
import { request, app, createAuthenticatedUser, createLead, daysFromNow } from '../setup/helpers.js';
import { ROLES } from '../../src/constants/roles.js';
import { Customer } from '../../src/models/Customer.js';
import { Activity } from '../../src/models/Activity.js';
import { Timeline } from '../../src/models/Timeline.js';

describe('activity creation and validation', () => {
  let admin;
  let executive;
  let lead;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executive = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    lead = await createLead({}, admin.user, executive.user);
  });

  it('creates an activity against a visible lead', async () => {
    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send({
        type: 'CALL',
        title: 'Discovery call',
        dueDate: daysFromNow(2),
        relatedEntityType: 'LEAD',
        relatedEntityId: lead.id,
      });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('PENDING');
    expect(response.body.data.assignedTo.id).toBe(executive.user.id);
  });

  it('rejects a non-existent related entity', async () => {
    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send({
        type: 'CALL',
        title: 'Call',
        dueDate: daysFromNow(1),
        relatedEntityType: 'LEAD',
        relatedEntityId: '507f1f77bcf86cd799439011',
      });

    expect(response.status).toBe(400);
  });

  it('refuses to attach an activity to a record outside the caller scope', async () => {
    const other = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    const foreignLead = await createLead({}, admin.user, other.user);

    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send({
        type: 'CALL',
        title: 'Sneaky call',
        dueDate: daysFromNow(1),
        relatedEntityType: 'LEAD',
        relatedEntityId: foreignLead.id,
      });

    expect(response.status).toBe(404);
  });

  it('requires a due date for follow-up style activities', async () => {
    const response = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send({
        type: 'FOLLOW_UP',
        title: 'Follow up',
        relatedEntityType: 'LEAD',
        relatedEntityId: lead.id,
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/dueDate/);
  });

  it('rejects an unknown activity type and entity type', async () => {
    const badType = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send({ type: 'TELEPORT', title: 'X', relatedEntityType: 'LEAD', relatedEntityId: lead.id });
    expect(badType.status).toBe(400);

    const badEntity = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send({ type: 'NOTE', title: 'X', relatedEntityType: 'PLANET', relatedEntityId: lead.id });
    expect(badEntity.status).toBe(400);
  });
});

describe('activity completion and overdue handling', () => {
  let admin;
  let executive;
  let lead;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executive = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    lead = await createLead({}, admin.user, executive.user);
  });

  const createActivity = (overrides = {}) =>
    request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`)
      .send({
        type: 'CALL',
        title: 'Follow-up call',
        dueDate: daysFromNow(1),
        relatedEntityType: 'LEAD',
        relatedEntityId: lead.id,
        ...overrides,
      });

  it('completes an activity and stamps completedAt', async () => {
    const created = await createActivity();
    const response = await request(app)
      .patch(`/api/v1/activities/${created.body.data.id}/complete`)
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('COMPLETED');
    expect(response.body.data.completedAt).toBeTruthy();
  });

  it('refuses to complete an activity twice', async () => {
    const created = await createActivity();
    await request(app)
      .patch(`/api/v1/activities/${created.body.data.id}/complete`)
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);

    const second = await request(app)
      .patch(`/api/v1/activities/${created.body.data.id}/complete`)
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);

    expect(second.status).toBe(422);
  });

  it('derives OVERDUE at read time without any scheduled job', async () => {
    await createActivity({ dueDate: daysFromNow(-3) });

    const list = await request(app)
      .get('/api/v1/activities')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);

    expect(list.status).toBe(200);
    expect(list.body.data[0].status).toBe('PENDING'); // stored value
    expect(list.body.data[0].derivedStatus).toBe('OVERDUE'); // effective value
  });

  it('filters by the derived OVERDUE status', async () => {
    await createActivity({ title: 'Overdue call', dueDate: daysFromNow(-3) });
    await createActivity({ title: 'Future call', dueDate: daysFromNow(3) });

    const overdue = await request(app)
      .get('/api/v1/activities?status=OVERDUE')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);
    expect(overdue.body.data).toHaveLength(1);
    expect(overdue.body.data[0].title).toBe('Overdue call');

    const pending = await request(app)
      .get('/api/v1/activities?status=PENDING')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);
    expect(pending.body.data).toHaveLength(1);
    expect(pending.body.data[0].title).toBe('Future call');
  });

  it('never reports a completed activity as overdue', async () => {
    const created = await createActivity({ dueDate: daysFromNow(-3) });
    await request(app)
      .patch(`/api/v1/activities/${created.body.data.id}/complete`)
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);

    const overdue = await request(app)
      .get('/api/v1/activities?status=OVERDUE')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);
    expect(overdue.body.data).toHaveLength(0);

    const all = await request(app)
      .get('/api/v1/activities')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);
    expect(all.body.data[0].derivedStatus).toBe('COMPLETED');
  });

  it('records activity lifecycle events on the timeline', async () => {
    const created = await createActivity();
    await request(app)
      .patch(`/api/v1/activities/${created.body.data.id}/complete`)
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);

    const timeline = await request(app)
      .get(`/api/v1/timeline/ACTIVITY/${created.body.data.id}`)
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);

    const actions = timeline.body.data.map((entry) => entry.action);
    expect(actions).toContain('ACTIVITY_CREATED');
    expect(actions).toContain('ACTIVITY_COMPLETED');
  });
});

describe('activity listing and scoping', () => {
  let admin;
  let executiveA;
  let executiveB;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executiveA = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    executiveB = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
  });

  it('only lists activities assigned to the caller for an executive', async () => {
    const leadA = await createLead({}, admin.user, executiveA.user);
    const leadB = await createLead({}, admin.user, executiveB.user);

    await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ type: 'CALL', title: 'A call', dueDate: daysFromNow(1), relatedEntityType: 'LEAD', relatedEntityId: leadA.id });
    await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ type: 'CALL', title: 'B call', dueDate: daysFromNow(1), relatedEntityType: 'LEAD', relatedEntityId: leadB.id });

    const response = await request(app)
      .get('/api/v1/activities')
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].title).toBe('A call');
  });

  it('filters by related entity and type', async () => {
    const lead = await createLead({}, admin.user, executiveA.user);
    const customer = await Customer.create({ name: 'Act Co', email: 'act@test.com', assignedTo: executiveA.user._id });

    await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`)
      .send({ type: 'CALL', title: 'Lead call', dueDate: daysFromNow(1), relatedEntityType: 'LEAD', relatedEntityId: lead.id });
    await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`)
      .send({ type: 'NOTE', title: 'Customer note', relatedEntityType: 'CUSTOMER', relatedEntityId: customer.id });

    const filtered = await request(app)
      .get(`/api/v1/activities?relatedEntityType=CUSTOMER&relatedEntityId=${customer.id}`)
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].title).toBe('Customer note');

    const byType = await request(app)
      .get('/api/v1/activities?type=CALL')
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`);
    expect(byType.body.data).toHaveLength(1);
  });

  it('forbids an executive from completing somebody else’s activity', async () => {
    const lead = await createLead({}, admin.user, executiveA.user);
    const created = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`)
      .send({ type: 'CALL', title: 'Private call', dueDate: daysFromNow(1), relatedEntityType: 'LEAD', relatedEntityId: lead.id });

    const other = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    const response = await request(app)
      .patch(`/api/v1/activities/${created.body.data.id}/complete`)
      .set('Authorization', `Bearer ${other.tokens.accessToken}`);

    expect(response.status).toBe(404); // not visible
  });

  it('updates and deletes an activity', async () => {
    const lead = await createLead({}, admin.user, executiveA.user);
    const created = await request(app)
      .post('/api/v1/activities')
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`)
      .send({ type: 'CALL', title: 'Original', dueDate: daysFromNow(1), relatedEntityType: 'LEAD', relatedEntityId: lead.id });

    const updated = await request(app)
      .patch(`/api/v1/activities/${created.body.data.id}`)
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`)
      .send({ title: 'Renamed', dueDate: daysFromNow(5) });
    expect(updated.status).toBe(200);
    expect(updated.body.data.title).toBe('Renamed');

    const deleted = await request(app)
      .delete(`/api/v1/activities/${created.body.data.id}`)
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`);
    expect(deleted.status).toBe(204);
    expect(await Activity.findById(created.body.data.id)).toBeNull();
  });
});

describe('timeline access control', () => {
  let admin;
  let executiveA;
  let executiveB;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    executiveA = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    executiveB = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
  });

  it('returns the audit history of a visible lead', async () => {
    const lead = await createLead({}, admin.user, executiveA.user);
    await Timeline.create({
      action: 'LEAD_CREATED',
      entityType: 'LEAD',
      entityId: lead._id,
      performedBy: admin.user._id,
      newValue: { name: lead.name },
    });

    const response = await request(app)
      .get(`/api/v1/timeline/LEAD/${lead.id}`)
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination.totalRecords).toBe(1);
  });

  it('returns 404 for an entity outside the caller scope', async () => {
    const lead = await createLead({}, admin.user, executiveB.user);
    const response = await request(app)
      .get(`/api/v1/timeline/LEAD/${lead.id}`)
      .set('Authorization', `Bearer ${executiveA.tokens.accessToken}`);
    expect(response.status).toBe(404);
  });

  it('rejects an unknown entity type', async () => {
    const response = await request(app)
      .get('/api/v1/timeline/PLANET/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(400);
  });

  it('exposes no update or delete operation for audit entries', async () => {
    const response = await request(app)
      .patch('/api/v1/timeline/LEAD/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({});
    expect(response.status).toBe(404);

    const del = await request(app)
      .delete('/api/v1/timeline/LEAD/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(del.status).toBe(404);
  });
});

describe('scheduled overdue job', () => {
  it('persists the derived OVERDUE flag without affecting reporting', async () => {
    const admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
    const lead = await createLead({}, admin.user, admin.user);

    await Activity.create({
      type: 'CALL',
      title: 'Stale call',
      assignedTo: admin.user._id,
      dueDate: daysFromNow(-5),
      relatedEntityType: 'LEAD',
      relatedEntityId: lead._id,
      createdBy: admin.user._id,
    });

    const { activityService } = await import('../../src/services/activity.service.js');
    const updated = await activityService.markOverdueActivities();
    expect(updated).toBe(1);

    const stored = await Activity.findOne({ title: 'Stale call' });
    expect(stored.status).toBe('OVERDUE');
  });
});