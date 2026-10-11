import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import config from '../config/env.js';
import { ROLES } from '../constants/roles.js';

/**
 * Denylist of unauthenticated brute-force login attempts keyed by IP.
 *
 * The in-memory store is sufficient for a single process deployment; for a
 * multi-instance deployment swap the store for a shared one (e.g. the Redis
 * store) - see README § Known limitations.
 */
const loginAttempts = new Map();
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function pruneAttempts(now) {
  for (const [key, entry] of loginAttempts) {
    if (now - entry.first > ATTEMPT_WINDOW_MS) loginAttempts.delete(key);
  }
}

export function registerFailedLogin(key) {
  const now = Date.now();
  pruneAttempts(now);
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.first > ATTEMPT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, first: now });
    return;
  }
  entry.count += 1;
}

export function isLoginBlocked(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (now - entry.first > ATTEMPT_WINDOW_MS) {
    loginAttempts.delete(key);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

export function clearLoginAttempts(key) {
  loginAttempts.delete(key);
}

export function resetLoginAttempts() {
  loginAttempts.clear();
}

/**
 * Build an express-rate-limit middleware that returns the standard API envelope.
 */
function buildLimiter({ windowMs, max, keyGenerator, message, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    keyGenerator,
    handler: (_req, _res, next) => {
      next(
        Object.assign(new Error(message), {
          status: 429,
          code: 'RATE_LIMIT_EXCEEDED',
          isRateLimit: true,
        })
      );
    },
  });
}

/**
 * Global API rate limiter.
 */
export const apiRateLimiter = buildLimiter({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: 'Too many requests. Please try again later.',
});

/**
 * Stricter limiter for credential based endpoints, keyed by IP + submitted email
 * so that a distributed credential stuffing attempt is throttled per account.
 */
export const authRateLimiter = buildLimiter({
  windowMs: config.rateLimit.authWindowMs,
  max: config.rateLimit.authMax,
  skipSuccessfulRequests: true,
keyGenerator: (req) => {
      // ipKeyGenerator normalises IPv6 addresses into a /64 subnet so that a
      // single client cannot rotate through addresses to bypass the limit.
      const ip = ipKeyGenerator(req.ip || 'unknown');
      const email = String(req.body?.email || '').toLowerCase().trim();
      return email ? `${ip}:${email}` : ip;
    },
  message: 'Too many authentication attempts. Please try again later.',
});

/**
 * In-memory account lockout that survives a single rate-limit window.
 */
export function accountLockoutMiddleware(req, _res, next) {
  if (!config.rateLimit.enabled) return next();
  const email = String(req.body?.email || '').toLowerCase().trim();
  if (!email) return next();
  const key = `${req.ip}:${email}`;
  if (isLoginBlocked(key)) {
    return next(
      Object.assign(new Error('Too many failed login attempts. Please try again in a few minutes.'), {
        status: 429,
        code: 'RATE_LIMIT_EXCEEDED',
        isRateLimit: true,
      })
    );
  }
  return next();
}

/**
 * No-op placeholder kept for readability in the app pipeline.
 */
export const noopRateLimiter = (_req, _res, next) => next();

export const roleOf = (req) => req.user?.role ?? ROLES.SALES_EXECUTIVE;