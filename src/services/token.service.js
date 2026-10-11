import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import config from '../config/env.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { ApiError } from '../utils/ApiError.js';

/**
 * Issue a signed JWT.
 *
 * `expiresIn` is always expressed in seconds so that the value is explicit and
 * cannot be misinterpreted by jsonwebtoken (a bare number means "seconds", while
 * a string such as "15m" is parsed as a timespan).
 */
function signToken(payload, secret, expiresIn) {
  return jwt.sign(payload, secret, {
    expiresIn,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

/**
 * Convert a timespan string ("15m", "7d", "3600") into seconds.
 */
export function timespanToSeconds(timespan) {
  if (typeof timespan === 'number') return timespan;
  const match = /^(\d+)\s*([smhd])?$/i.exec(String(timespan).trim());
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return amount * multipliers[unit];
}

/**
 * Create an access token for a user.
 *
 * The token is deliberately short lived and stateless. It carries the role so
 * that role checks do not require a database round-trip, while `authenticate`
 * still re-loads the user to enforce the active-account check.
 */
export function signAccessToken(user) {
  const payload = {
    sub: user.id ?? user._id.toString(),
    email: user.email,
    role: user.role,
    type: 'access',
    jti: crypto.randomUUID(),
  };
  return {
    token: signToken(payload, config.jwt.accessSecret, timespanToSeconds(config.jwt.accessExpiresIn)),
    expiresInSeconds: timespanToSeconds(config.jwt.accessExpiresIn),
    expiresAt: new Date(Date.now() + timespanToSeconds(config.jwt.accessExpiresIn) * 1000),
  };
}

/**
 * Create a refresh token and persist only its hash.
 */
export async function issueRefreshToken(user, { familyId = null, userAgent = '', ip = '', session = null } = {}) {
  const jti = crypto.randomUUID();
  const token = signToken(
    { sub: user.id ?? user._id.toString(), jti, type: 'refresh', familyId },
    config.jwt.refreshSecret,
    timespanToSeconds(config.jwt.refreshExpiresIn)
  );

  const tokenHash = RefreshToken.hashToken(token);
  const expiresAt = new Date(Date.now() + timespanToSeconds(config.jwt.refreshExpiresIn) * 1000);
  const resolvedFamilyId = familyId || jti;

  await RefreshToken.create(
    [
      {
        user: user._id ?? user.id,
        tokenHash,
        familyId: resolvedFamilyId,
        expiresAt,
        userAgent: userAgent.slice(0, 300),
        ip: ip.slice(0, 64),
      },
    ],
    session ? { session } : undefined
  );

  return { token, expiresAt, familyId: resolvedFamilyId, tokenHash };
}

/**
 * Verify a JWT with the given secret and expected token type.
 */
export function verifyToken(token, { secret, type }) {
  const decoded = jwt.verify(token, secret, {
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
  if (decoded.type !== type) {
    throw new jwt.JsonWebTokenError('Invalid token type');
  }
  return decoded;
}

/**
 * Decode a token without verifying it (diagnostics only).
 */
export function decodeToken(token) {
  return jwt.decode(token);
}

/**
 * Rotate a refresh token: the presented token is revoked and replaced by a new
 * one belonging to the same family. Presenting an already revoked token revokes
 * the whole family (token reuse detection).
 */
export async function rotateRefreshToken(presentedToken, { userAgent = '', ip = '' } = {}) {
  // Throws for expired, tampered or wrong-type tokens.
verifyToken(presentedToken, {
    secret: config.jwt.refreshSecret,
    type: 'refresh',
  });

  const tokenHash = RefreshToken.hashToken(presentedToken);
  const stored = await RefreshToken.findOne({ tokenHash }).select('+tokenHash');

  if (!stored) {
    throw ApiError.unauthorized('Invalid refresh token');
  }

  if (stored.revokedAt) {
    // Reuse of a rotated token: revoke the entire family defensively.
    await RefreshToken.updateMany(
      { familyId: stored.familyId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedReason: 'token_reuse_detected' } }
    );
    throw ApiError.unauthorized('Refresh token has already been used. Please sign in again.');
  }

  if (stored.expiresAt.getTime() <= Date.now()) {
    throw ApiError.unauthorized('Refresh token has expired. Please sign in again.');
  }

  const nextToken = await issueRefreshToken(
    { _id: stored.user },
    { familyId: stored.familyId, userAgent, ip }
  );

  stored.revokedAt = new Date();
  stored.revokedReason = 'rotated';
  stored.replacedByTokenHash = nextToken.tokenHash;
  await stored.save();

  return {
    token: nextToken.token,
    expiresAt: nextToken.expiresAt,
    userId: stored.user.toString(),
  };
}

/**
 * Revoke a single refresh token (logout). Idempotent: revoking an unknown or
 * already revoked token succeeds so that logout never leaks information.
 */
export async function revokeRefreshToken(presentedToken, reason = 'logout') {
  if (!presentedToken) return false;
  let tokenHash;
  try {
    tokenHash = RefreshToken.hashToken(presentedToken);
  } catch {
    return false;
  }
  const result = await RefreshToken.updateOne(
    { tokenHash, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  );
  return result.modifiedCount > 0;
}

/**
 * Revoke every active session for a user (used when an account is deactivated or
 * when a password is changed).
 */
export async function revokeAllUserTokens(userId, reason = 'security') {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: null },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  );
}

/**
 * Count active sessions for a user (surfaced on the profile endpoint).
 */
export async function countActiveSessions(userId) {
  return RefreshToken.countDocuments({ user: userId, revokedAt: null, expiresAt: { $gt: new Date() } });
}

/**
 * Parse a "15m" style timespan into milliseconds.
 */
export function timespanToMs(timespan) {
  return timespanToSeconds(timespan) * 1000;
}