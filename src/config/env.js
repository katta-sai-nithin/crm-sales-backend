/**
 * Environment configuration and validation.
 *
 * All environment variables are read and validated exactly once at import time so
 * that a misconfigured deployment fails fast and loudly instead of failing at the
 * first request.
 */
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config();

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';
const isTest = NODE_ENV === 'test';

const errors = [];

/**
 * Read a required variable or record a validation error.
 */
function required(key, { minLength = 1 } = {}) {
  const value = process.env[key];
  if (!value || value.trim().length === 0) {
    errors.push(`${key} is required but was not provided`);
    return '';
  }
  if (value.trim().length < minLength) {
    errors.push(`${key} must be at least ${minLength} characters long`);
  }
  return value.trim();
}

function optional(key, fallback = '') {
  const value = process.env[key];
  if (value === undefined || value === '') return fallback;
  return value.trim();
}

function toInt(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    errors.push(`${key} must be an integer`);
    return fallback;
  }
  return parsed;
}

function toBool(key, fallback) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function toList(key, fallback = []) {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Weak secrets are rejected in production so that a copy/pasted `.env.example`
 * placeholder can never be deployed.
 */
function assertStrongSecret(key, value) {
  const placeholders = ['replace', 'changeme', 'your_secret', 'secret', 'string', 'todo'];
  const lowered = value.toLowerCase();
  if (lowered.length < 32) {
    errors.push(`${key} must be at least 32 characters long in production`);
  }
  if (placeholders.some((placeholder) => lowered.includes(placeholder))) {
    errors.push(`${key} still contains a placeholder value`);
  }
}

const MONGODB_URI = optional('MONGODB_URI', 'mongodb://127.0.0.1:27017/crm_sales_db');

let JWT_ACCESS_SECRET = required('JWT_ACCESS_SECRET', { minLength: 16 });
let JWT_REFRESH_SECRET = required('JWT_REFRESH_SECRET', { minLength: 16 });

// In non-production environments a deterministic development secret keeps the app
// bootable out of the box while still being explicit about being insecure.
if (!isProduction && (!JWT_ACCESS_SECRET || JWT_ACCESS_SECRET.length < 32)) {
  if (!process.env.JWT_ACCESS_SECRET) {
    JWT_ACCESS_SECRET = crypto
      .createHash('sha256')
      .update(`dev-access-secret-${NODE_ENV}`)
      .digest('hex');
  }
  if (!process.env.JWT_REFRESH_SECRET) {
    JWT_REFRESH_SECRET = crypto
      .createHash('sha256')
      .update(`dev-refresh-secret-${NODE_ENV}`)
      .digest('hex');
  }
  // Re-evaluate: only non-empty values can pass the length check above.
  errors.length = 0;
}

if (isProduction) {
  assertStrongSecret('JWT_ACCESS_SECRET', JWT_ACCESS_SECRET);
  assertStrongSecret('JWT_REFRESH_SECRET', JWT_REFRESH_SECRET);
  if (JWT_ACCESS_SECRET === JWT_REFRESH_SECRET) {
    errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different values');
  }
}

const config = {
  env: NODE_ENV,
  isProduction,
  isTest,
  appName: optional('APP_NAME', 'CRM Sales Management API'),
  appVersion: optional('APP_VERSION', '1.0.0'),
  port: toInt('PORT', 5000),

  mongo: {
    uri: MONGODB_URI,
    dbName: optional('MONGO_DB_NAME', ''),
    serverSelectionTimeoutMS: toInt('MONGO_SERVER_SELECTION_TIMEOUT_MS', 10000),
    maxPoolSize: toInt('MONGO_MAX_POOL_SIZE', 20),
  },

  jwt: {
    accessSecret: JWT_ACCESS_SECRET,
    refreshSecret: JWT_REFRESH_SECRET,
    accessExpiresIn: optional('JWT_ACCESS_EXPIRES_IN', '15m'),
    refreshExpiresIn: optional('JWT_REFRESH_EXPIRES_IN', '7d'),
    issuer: optional('JWT_ISSUER', 'crm-sales-api'),
    audience: optional('JWT_AUDIENCE', 'crm-sales-client'),
  },

  bcrypt: {
    saltRounds: toInt('BCRYPT_SALT_ROUNDS', isTest ? 4 : 12),
  },

  cors: {
    // Comma separated allowlist, e.g. "http://localhost:3000,https://app.example.com"
    origins: toList('CORS_ORIGIN', ['http://localhost:3000']),
    credentials: toBool('CORS_CREDENTIALS', true),
  },

  rateLimit: {
    windowMs: toInt('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    max: toInt('RATE_LIMIT_MAX_REQUESTS', 100),
    authWindowMs: toInt('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    authMax: toInt('AUTH_RATE_LIMIT_MAX_REQUESTS', 10),
    enabled: toBool('RATE_LIMIT_ENABLED', true),
  },

  security: {
    jsonLimit: optional('JSON_BODY_LIMIT', '1mb'),
    trustProxy: toBool('TRUST_PROXY', false),
    // When true the refresh token is additionally delivered as an HttpOnly cookie.
    refreshTokenCookie: toBool('REFRESH_TOKEN_IN_COOKIE', true),
    refreshCookieName: optional('REFRESH_COOKIE_NAME', 'refreshToken'),
    refreshCookieSecure: toBool('REFRESH_COOKIE_SECURE', isProduction),
    refreshCookieSameSite: optional('REFRESH_COOKIE_SAMESITE', 'Strict'),
    refreshCookiePath: optional('REFRESH_COOKIE_PATH', '/api/v1/auth'),
  },

  bootstrap: {
    adminName: optional('INITIAL_ADMIN_NAME', ''),
    adminEmail: optional('INITIAL_ADMIN_EMAIL', ''),
    adminPassword: optional('INITIAL_ADMIN_PASSWORD', ''),
  },

  seed: {
    enabled: toBool('SEED_DEMO_DATA', false),
    force: toBool('SEED_FORCE', false),
  },

  jobs: {
    // Scheduled maintenance jobs (e.g. persisting the OVERDUE activity flag).
    // Overdue activity reporting never depends on this job; it is computed in queries.
    enabled: toBool('JOBS_ENABLED', false),
    overdueIntervalMs: toInt('OVERDUE_JOB_INTERVAL_MS', 60 * 60 * 1000),
  },

  logging: {
    level: optional('LOG_LEVEL', isProduction ? 'info' : 'debug'),
    pretty: toBool('LOG_PRETTY', !isProduction),
  },

  swagger: {
    enabled: toBool('SWAGGER_ENABLED', !isProduction),
  },

  shutdownTimeoutMs: toInt('SHUTDOWN_TIMEOUT_MS', 10000),
};

export function validateEnv() {
  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n - ${errors.join('\n - ')}`);
  }
  return true;
}

export function getEnvErrors() {
  return [...errors];
}

export default config;