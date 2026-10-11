import { describe, it, expect } from 'vitest';
import { request, app, createUser, login, DEMO_PASSWORD } from '../setup/helpers.js';
import { ROLES } from '../../src/constants/roles.js';

describe('smoke', () => {
  it('serves the health endpoint', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.database.connected).toBe(true);
  });

  it('registers, logs in and returns /auth/me', async () => {
    const email = `smoke${Date.now()}@example.com`;
    const registerResponse = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Smoke Tester', email, password: 'Str0ngPassw0rd' });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.data.user.role).toBe(ROLES.SALES_EXECUTIVE);
    expect(JSON.stringify(registerResponse.body)).not.toContain('passwordHash');

    const tokens = registerResponse.body.data;
    const meResponse = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(meResponse.status).toBe(200);
    expect(meResponse.body.data.email).toBe(email);
  });

  it('creates a user and logs in', async () => {
    const email = `smoke-admin${Date.now()}@example.com`;
    await createUser({ email, role: ROLES.ADMIN, password: DEMO_PASSWORD });
    const tokens = await login(email);
    expect(tokens.user.email).toBe(email);
  });
});