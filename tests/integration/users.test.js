import { describe, it, expect, beforeEach } from 'vitest';
import {
  request,
  app,
  createUser,
  createAuthenticatedUser,
  createLead,
} from '../setup/helpers.js';
import { ROLES } from '../../src/constants/roles.js';

describe('user management authorization', () => {
  let admin;
  let manager;
  let executive;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN, name: 'Admin' });
    manager = await createAuthenticatedUser({ role: ROLES.SALES_MANAGER, name: 'Manager' });
    executive = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE, name: 'Exec' });
  });

  it('allows an admin to list and create users', async () => {
    const list = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.pagination.totalRecords).toBeGreaterThanOrEqual(3);

    const create = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({
        name: 'New Manager',
        email: 'new.manager@example.com',
        password: 'Str0ngPassw0rd',
        role: ROLES.SALES_MANAGER,
      });
    expect(create.status).toBe(201);
    expect(create.body.data.role).toBe(ROLES.SALES_MANAGER);
    expect(JSON.stringify(create.body)).not.toContain('passwordHash');
  });

  it('forbids a sales manager from creating users', async () => {
    const response = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${manager.tokens.accessToken}`)
      .send({ name: 'Nope', email: 'nope@example.com', password: 'Str0ngPassw0rd', role: ROLES.SALES_EXECUTIVE });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('forbids a sales executive from user management', async () => {
    const list = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);
    expect(list.status).toBe(403);

    const single = await request(app)
      .get(`/api/v1/users/${manager.user.id}`)
      .set('Authorization', `Bearer ${executive.tokens.accessToken}`);
    expect(single.status).toBe(403);
  });

  it('never shows admin accounts to a sales manager', async () => {
    await createUser({ role: ROLES.ADMIN, email: 'admin2@example.com' });
    const response = await request(app)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${manager.tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.every((user) => user.role !== ROLES.ADMIN)).toBe(true);
  });

  it('allows a manager to fetch a user inside their scope but not an admin', async () => {
    const other = await createUser({ role: ROLES.SALES_EXECUTIVE });
    const ok = await request(app)
      .get(`/api/v1/users/${other.id}`)
      .set('Authorization', `Bearer ${manager.tokens.accessToken}`);
    expect(ok.status).toBe(200);

    const denied = await request(app)
      .get(`/api/v1/users/${admin.user.id}`)
      .set('Authorization', `Bearer ${manager.tokens.accessToken}`);
    expect(denied.status).toBe(404);
  });

  it('prevents a manager from editing another user', async () => {
    const target = await createUser({ role: ROLES.SALES_EXECUTIVE });
    const response = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${manager.tokens.accessToken}`)
      .send({ name: 'Hacked' });
    expect(response.status).toBe(403);
  });
});

describe('user lifecycle rules', () => {
  let admin;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
  });

  it('deactivates a user and revokes their sessions', async () => {
    const target = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });

    const response = await request(app)
      .patch(`/api/v1/users/${target.user.id}/status`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ isActive: false });

    expect(response.status).toBe(200);
    expect(response.body.data.user.isActive).toBe(false);

    // The refresh session is gone.
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: target.tokens.refreshToken });
    expect(refresh.status).toBe(401);

    // The already issued access token no longer authenticates.
    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${target.tokens.accessToken}`);
    expect(me.status).toBe(403);
  });

  it('reports orphaned records when deactivating', async () => {
    const target = await createAuthenticatedUser({ role: ROLES.SALES_EXECUTIVE });
    await createLead({}, admin.user, target.user);

    const response = await request(app)
      .patch(`/api/v1/users/${target.user.id}/status`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ isActive: false });

    expect(response.status).toBe(200);
    expect(response.body.data.orphanedRecords.leads).toBe(1);
  });

  it('rejects a duplicate status change', async () => {
    const target = await createUser({ role: ROLES.SALES_EXECUTIVE, isActive: true });
    const response = await request(app)
      .patch(`/api/v1/users/${target.id}/status`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ isActive: true });
    expect(response.status).toBe(422);
  });

  it('refuses to delete a user that still owns records', async () => {
    const target = await createUser({ role: ROLES.SALES_EXECUTIVE });
    await createLead({}, admin.user, target);

    const response = await request(app)
      .delete(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(422);
  });

  it('deletes a user with no owned records', async () => {
    const target = await createUser({ role: ROLES.SALES_EXECUTIVE });
    const response = await request(app)
      .delete(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(204);
  });

  it('refuses to delete its own account', async () => {
    const response = await request(app)
      .delete(`/api/v1/users/${admin.user.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(422);
  });

  it('refuses to demote the last active administrator', async () => {
    const response = await request(app)
      .patch(`/api/v1/users/${admin.user.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ role: ROLES.SALES_EXECUTIVE });
    expect(response.status).toBe(422);
    expect(response.body.message).toMatch(/administrator/i);
  });

  it('allows an admin to change a role when another admin exists', async () => {
    const otherAdmin = await createUser({ role: ROLES.ADMIN });
    const response = await request(app)
      .patch(`/api/v1/users/${otherAdmin.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ role: ROLES.SALES_MANAGER });
    expect(response.status).toBe(200);
    expect(response.body.data.role).toBe(ROLES.SALES_MANAGER);
  });

  it('rejects an invalid role in the payload', async () => {
    const target = await createUser({ role: ROLES.SALES_EXECUTIVE });
    const response = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ role: 'SUPER_ADMIN' });
    expect(response.status).toBe(400);
  });

  it('rejects an attempt to set isActive through the generic update endpoint', async () => {
    const target = await createUser({ role: ROLES.SALES_EXECUTIVE });
    const response = await request(app)
      .patch(`/api/v1/users/${target.id}`)
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`)
      .send({ isActive: false });
    expect(response.status).toBe(400);
  });
});

describe('user listing filters', () => {
  let admin;

  beforeEach(async () => {
    admin = await createAuthenticatedUser({ role: ROLES.ADMIN });
  });

  it('filters by role and active status', async () => {
    await createUser({ role: ROLES.SALES_MANAGER, email: 'm1@example.com' });
    await createUser({ role: ROLES.SALES_EXECUTIVE, isActive: false, email: 'e1@example.com' });

    const managers = await request(app)
      .get('/api/v1/users?role=SALES_MANAGER')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(managers.status).toBe(200);
    expect(managers.body.data.every((u) => u.role === ROLES.SALES_MANAGER)).toBe(true);

    const active = await request(app)
      .get('/api/v1/users?isActive=true')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(active.body.data.every((u) => u.isActive === true)).toBe(true);
  });

  it('searches by name and email with pagination metadata', async () => {
    await createUser({ name: 'Unique Person', email: 'unique.person@example.com', role: ROLES.SALES_EXECUTIVE });

    const response = await request(app)
      .get('/api/v1/users?search=Unique%20Person&page=1&limit=5')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toMatchObject({ page: 1, limit: 5, totalRecords: 1, totalPages: 1 });
  });

  it('rejects an unsupported sort field', async () => {
    const response = await request(app)
      .get('/api/v1/users?sortBy=passwordHash')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(400);
  });

  it('returns 400 for a limit above the maximum', async () => {
    const response = await request(app)
      .get('/api/v1/users?limit=1000')
      .set('Authorization', `Bearer ${admin.tokens.accessToken}`);
    expect(response.status).toBe(400);
  });
});

describe('GET /api/v1/users/me', () => {
  it('returns the authenticated profile without secrets', async () => {
    const { user, tokens } = await createAuthenticatedUser({ role: ROLES.SALES_MANAGER, name: 'Me' });
    const response = await request(app)
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(user.id);
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data.activeSessions).toBeGreaterThan(0);
  });
});