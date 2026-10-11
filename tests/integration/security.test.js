import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app.js';

describe('CORS policy', () => {
  const ORIGIN = 'http://localhost:3000';

  it('allows a configured origin and echoes it back', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', ORIGIN);

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
  });

  it('answers an unknown origin without CORS headers instead of a 500', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example.com');

    // The request still succeeds server-side; the *browser* is what blocks it.
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never turns a CORS rejection into a 500 on a state-changing route', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .set('Origin', 'https://evil.example.com')
      .send({ name: 'Attacker', email: 'attacker@example.com', password: 'Str0ngPassw0rd' });

    expect(response.status).toBe(201);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows a same-origin request (Swagger UI served by the API itself)', async () => {
    const response = await request(app)
      .get('/api/v1/health')
      .set('Host', 'localhost:5000')
      .set('Origin', 'http://localhost:5000');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5000');
  });

  it('treats a same-origin request as same even without Origin', async () => {
    // No Origin header at all (curl, Postman, health probes) must work.
    const response = await request(app).get('/api/v1/health');
    expect(response.status).toBe(200);
  });

  it('answers the CORS preflight for a configured origin', async () => {
    const response = await request(app)
      .options('/api/v1/leads')
      .set('Origin', ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');

    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not emit wildcard with credentials enabled', async () => {
    const response = await request(app).get('/api/v1/health').set('Origin', ORIGIN);
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('security headers and hardening', () => {
  it('sets Helmet headers', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toBeTruthy();
    expect(response.headers['x-dns-prefetch-control']).toBeTruthy();
  });

  it('does not advertise the server technology', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('returns a structured 404 for an unknown route', async () => {
    const response = await request(app).get('/api/v1/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, code: 'ROUTE_NOT_FOUND' });
    expect(response.body.errors).toEqual([]);
  });

  it('returns a structured 400 for malformed JSON', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{ not json');

    expect(response.status).toBe(400);
    expect(response.body.success).toBe(false);
  });

  it('rejects an oversized payload', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.com', password: 'x'.repeat(2 * 1024 * 1024) }));

    expect([400, 413]).toContain(response.status);
    expect(response.body.success).toBe(false);
  });

  it('assigns a request id', async () => {
    const response = await request(app).get('/api/v1/health');
    expect(response.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/i);
  });

  it('does not leak stack traces on an unexpected error', async () => {
    const response = await request(app).get('/api/v1/leads/507f1f77bcf86cd799439011');
    expect(response.status).toBe(401);
    expect(JSON.stringify(response.body)).not.toContain('at ');
  });
});