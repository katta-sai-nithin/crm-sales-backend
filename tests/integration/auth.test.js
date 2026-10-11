import { describe, it, expect, beforeEach } from 'vitest';
import {
  request,
  app,
  createUser,
  createAuthenticatedUser,
  login,
  DEMO_PASSWORD,
} from '../setup/helpers.js';
import { ROLES } from '../../src/constants/roles.js';
import { RefreshToken } from '../../src/models/RefreshToken.js';
import { resetLoginAttempts } from '../../src/middleware/rateLimiter.js';

describe('POST /api/v1/auth/register', () => {
  it('creates a Sales Executive and returns tokens', async () => {
    const response = await request(app).post('/api/v1/auth/register').send({
      name: 'New Exec',
      email: 'New.Exec@Example.com',
      password: 'Str0ngPassw0rd',
      phone: '+1 555 0100',
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.data.user.role).toBe(ROLES.SALES_EXECUTIVE);
    expect(response.body.data.user.email).toBe('new.exec@example.com');
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.refreshToken).toBeTruthy();
  });

  it('never exposes the password hash', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Hash Test', email: 'hash@example.com', password: 'Str0ngPassw0rd' });

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('$2b$');
  });

  it('ignores / rejects a self-assigned admin role (privilege escalation attempt)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Sneaky', email: 'sneaky@example.com', password: 'Str0ngPassw0rd', role: ROLES.ADMIN });

    // The strict schema rejects the unknown field outright.
    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects a duplicate email with 409', async () => {
    await createUser({ email: 'dup@example.com' });
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'Dup', email: 'dup@example.com', password: 'Str0ngPassw0rd' });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('DUPLICATE_RESOURCE');
  });

  it('rejects an invalid email and a weak password with 400', async () => {
    const badEmail = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'X', email: 'not-an-email', password: 'Str0ngPassw0rd' });
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.errors.length).toBeGreaterThan(0);

    const weakPassword = await request(app)
      .post('/api/v1/auth/register')
      .send({ name: 'X', email: 'weak@example.com', password: 'short' });
    expect(weakPassword.status).toBe(400);
  });
});

describe('POST /api/v1/auth/login', () => {
  let user;

  beforeEach(async () => {
    resetLoginAttempts();
    user = await createUser({ email: 'login@example.com', password: DEMO_PASSWORD });
  });

  it('returns an access and refresh token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login@example.com', password: DEMO_PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.data.tokenType).toBe('Bearer');
    expect(response.body.data.expiresIn).toBeGreaterThan(0);
    expect(response.body.data.user.id).toBe(user.id);
  });

  it('stores only a hash of the refresh token', async () => {
    const tokens = await login('login@example.com');
    const stored = await RefreshToken.findOne({ user: user._id }).select('+tokenHash');
    expect(stored.tokenHash).toBeTruthy();
    expect(stored.tokenHash).not.toBe(tokens.refreshToken);
    expect(stored.tokenHash).toHaveLength(64); // sha256 hex
  });

  it('is case insensitive on the email', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'LOGIN@EXAMPLE.COM', password: DEMO_PASSWORD });
    expect(response.status).toBe(200);
  });

  it('returns a generic 401 for wrong credentials', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login@example.com', password: 'WrongPassword1' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid email or password');
  });

  it('returns the same generic message for an unknown email (no enumeration)', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'WrongPassword1' });

    expect(response.status).toBe(401);
    expect(response.body.message).toBe('Invalid email or password');
  });

  it('refuses an inactive account with 403', async () => {
    user.isActive = false;
    await user.save();

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'login@example.com', password: DEMO_PASSWORD });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/deactivated/i);
  });
});

describe('access token handling', () => {
  it('rejects a request without a token', async () => {
    const response = await request(app).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer not.a.jwt');
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('TOKEN_INVALID');
  });

  it('rejects an expired access token', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const config = (await import('../../src/config/env.js')).default;
    const expired = jwt.sign({ sub: '507f1f77bcf86cd799439011', type: 'access', role: 'ADMIN' }, config.jwt.accessSecret, {
      expiresIn: '-1s',
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
    });

    const response = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('TOKEN_EXPIRED');
  });

  it('blocks access immediately after the account is deactivated', async () => {
    const { user, tokens } = await createAuthenticatedUser({ role: ROLES.ADMIN });
    const before = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(before.status).toBe(200);

    user.isActive = false;
    await user.save();

    const after = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${tokens.accessToken}`);
    expect(after.status).toBe(403);
  });
});

describe('refresh token rotation', () => {
  it('rotates the token and revokes the previous one', async () => {
    const { user } = await createAuthenticatedUser();
    const first = await login(user.email);

    const refreshResponse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken });

    expect(refreshResponse.status).toBe(200);
    expect(refreshResponse.body.data.refreshToken).not.toBe(first.refreshToken);
    expect(refreshResponse.body.data.accessToken).toBeTruthy();

    // Reusing the old token is rejected and revokes the whole family.
    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(reuse.status).toBe(401);

    const second = refreshResponse.body.data.refreshToken;
    const afterReuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: second });
    expect(afterReuse.status).toBe(401);
  });

  it('rejects an unknown refresh token', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'a'.repeat(64) });
    expect(response.status).toBe(401);
  });

  it('rejects a refresh token signed with the wrong secret', async () => {
    const jwt = (await import('jsonwebtoken')).default;
    const forged = jwt.sign({ sub: '507f1f77bcf86cd799439011', type: 'refresh' }, 'wrong-secret', {
      expiresIn: '1h',
    });
    const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: forged });
    expect(response.status).toBe(401);
  });

  it('refuses an access token on the refresh endpoint', async () => {
    const { tokens } = await createAuthenticatedUser();
    const response = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: tokens.accessToken });
    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the refresh session', async () => {
    const { user, tokens } = await createAuthenticatedUser();

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ refreshToken: tokens.refreshToken });
    expect(logout.status).toBe(200);
    expect(logout.body.data.revoked).toBe(true);

    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken });
    expect(reuse.status).toBe(401);

    const sessions = await RefreshToken.countDocuments({ user: user._id, revokedAt: null });
    expect(sessions).toBe(0);
  });

  it('supports logging out of every device', async () => {
    const { user, tokens } = await createAuthenticatedUser();
    const second = await login(user.email);

    const logout = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ allDevices: true });
    expect(logout.status).toBe(200);
    expect(logout.body.data.revokedAll).toBe(true);

    expect((await request(app).post('/api/v1/auth/refresh').send({ refreshToken: second.refreshToken })).status).toBe(401);
  });

  it('requires authentication', async () => {
    const response = await request(app).post('/api/v1/auth/logout').send({});
    expect(response.status).toBe(401);
  });
});

describe('password change', () => {
  it('changes the password and revokes every session', async () => {
    const { user, tokens } = await createAuthenticatedUser();

    const response = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ currentPassword: DEMO_PASSWORD, newPassword: 'An0therStrongPass!' });

    expect(response.status).toBe(200);

    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: DEMO_PASSWORD });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'An0therStrongPass!' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects an incorrect current password', async () => {
    const { tokens } = await createAuthenticatedUser();
    const response = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .send({ currentPassword: 'NotMyPassword1', newPassword: 'An0therStrongPass!' });
    expect(response.status).toBe(401);
  });
});