import request from 'supertest';
import app from '../../src/app.js';
import { User, Team } from '../../src/models/User.js';
import { ROLES } from '../../src/constants/roles.js';

/**
 * Shared test helpers: fixtures, factories and authentication helpers.
 */

export const DEMO_PASSWORD = 'TestPassw0rd!2024';

/**
 * Create a user with a known password.
 */
export async function createUser(overrides = {}) {
  const payload = {
    name: overrides.name || 'Test User',
    email: overrides.email || `user${Math.random().toString(36).slice(2, 8)}@example.com`,
    role: overrides.role || ROLES.SALES_EXECUTIVE,
    isActive: overrides.isActive !== undefined ? overrides.isActive : true,
    team: overrides.team || null,
  };
  const passwordHash = await User.hashPassword(overrides.password || DEMO_PASSWORD);
  return User.create({ ...payload, phone: overrides.phone || '', passwordHash });
}

/**
 * Create a team and return it.
 */
export async function createTeam(name = 'Test Team', members = []) {
  return Team.create({ name, members });
}

/**
 * Log in through the real API and return the auth payload.
 */
export async function login(email, password = DEMO_PASSWORD) {
  const response = await request(app).post('/api/v1/auth/login').send({ email, password });
  if (response.status !== 200) {
    throw new Error(`Login failed for ${email}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.data;
}

/**
 * Create a user and immediately log in.
 */
export async function createAuthenticatedUser(overrides = {}) {
  const password = overrides.password || DEMO_PASSWORD;
  const user = await createUser({ ...overrides, password });
  const tokens = await login(user.email, password);
  return { user, tokens, password };
}

/**
 * Authorization header helper.
 */
export const authHeader = (tokens) => ({ Authorization: `Bearer ${tokens.accessToken}` });

/**
 * Build a future / past ISO date string.
 */
export const daysFromNow = (days) => new Date(Date.now() + days * 86400000).toISOString();

/**
 * Create a lead directly through the model (bypasses the API) for fixtures that
 * need a specific state.
 */
export async function createLead(overrides = {}, createdBy, assignedTo) {
  const { Lead } = await import('../../src/models/Lead.js');
  return Lead.create({
    name: overrides.name || 'Fixture Lead',
    email: overrides.email || `lead${Math.random().toString(36).slice(2, 8)}@example.com`,
    company: overrides.company || 'Fixture Co',
    status: overrides.status || 'NEW',
    priority: overrides.priority || 'MEDIUM',
    source: overrides.source || 'WEBSITE',
    createdBy: createdBy?._id ?? overrides.createdBy,
    assignedTo: assignedTo?._id ?? overrides.assignedTo ?? null,
  });
}

export { app, request };