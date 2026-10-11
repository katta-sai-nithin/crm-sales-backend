import { User } from '../models/User.js';
import { ROLES } from '../constants/roles.js';
import { ApiError } from '../utils/ApiError.js';
import { normalizeEmail } from '../utils/sanitize.js';
import { toObjectId } from '../utils/objectId.js';
import {
  signAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
  countActiveSessions,
} from './token.service.js';
import {
  registerFailedLogin,
  clearLoginAttempts,
} from '../middleware/rateLimiter.js';

/**
 * Public user representation. Never includes `passwordHash`.
 */
export function toPublicUser(user) {
  if (!user) return null;
  const plain = typeof user.toObject === 'function' ? user.toObject() : user;
  delete plain.passwordHash;
  delete plain.__v;
  return {
    id: String(plain._id),
    name: plain.name,
    email: plain.email,
    phone: plain.phone || '',
    role: plain.role,
    isActive: plain.isActive,
    team: plain.team ? String(plain.team._id ?? plain.team) : null,
    lastLoginAt: plain.lastLoginAt ?? null,
    createdAt: plain.createdAt,
    updatedAt: plain.updatedAt,
  };
}

/**
 * Build the full authentication payload returned by login / register / refresh.
 */
export async function buildAuthPayload(user, { userAgent = '', ip = '' } = {}) {
  const access = signAccessToken(user);
  const refresh = await issueRefreshToken(user, { userAgent, ip });
  const activeSessions = await countActiveSessions(user._id);

  return {
    user: toPublicUser(user),
    accessToken: access.token,
    refreshToken: refresh.token,
    tokenType: 'Bearer',
    expiresIn: access.expiresInSeconds,
    expiresAt: access.expiresAt,
    refreshExpiresAt: refresh.expiresAt,
    activeSessions,
  };
}

class AuthService {
  /**
   * Public self-registration.
   *
   * A public caller always becomes a SALES_EXECUTIVE. Creating an administrator
   * requires either the `bootstrapAdmin` script (first admin only, from env
   * credentials) or an authenticated ADMIN calling POST /api/v1/users.
   */
  async register(payload, context = {}) {
    const email = normalizeEmail(payload.email);

    const existing = await User.findOne({ email });
    if (existing) {
      throw ApiError.conflict('An account with this email address already exists', {
        errors: [{ field: 'email', message: 'Email already registered' }],
      });
    }

    const passwordHash = await User.hashPassword(payload.password);

    const user = await User.create({
      name: payload.name,
      email,
      phone: payload.phone ?? '',
      passwordHash,
      // Server-controlled: never taken from the request body.
      role: ROLES.SALES_EXECUTIVE,
      isActive: true,
    });

    return buildAuthPayload(user, context);
  }

  /**
   * Authenticate with email + password.
   *
   * Failures are deliberately indistinguishable ("Invalid email or password") so
   * that the endpoint cannot be used to enumerate registered accounts.
   */
  async login({ email, password }, context = {}) {
    const normalizedEmail = normalizeEmail(email);
    const lookupKey = `${context.ip || 'unknown'}:${normalizedEmail}`;

    const user = await User.findOne({ email: normalizedEmail }).select('+passwordHash');

    if (!user || !(await user.comparePassword(password))) {
      registerFailedLogin(lookupKey);
      throw ApiError.unauthorized('Invalid email or password');
    }

    if (!user.isActive) {
      registerFailedLogin(lookupKey);
      throw ApiError.forbidden('Your account has been deactivated. Please contact an administrator.');
    }

    clearLoginAttempts(lookupKey);
    user.lastLoginAt = new Date();
    await user.save({ validateBeforeSave: false });

    return buildAuthPayload(user, context);
  }

  /**
   * Rotate a refresh token and mint a new access token.
   */
  async refresh({ refreshToken }, context = {}) {
    if (!refreshToken) {
      throw ApiError.badRequest('refreshToken is required (body or cookie)');
    }

    const rotated = await rotateRefreshToken(refreshToken, {
      userAgent: context.userAgent,
      ip: context.ip,
    });

    const user = await User.findById(rotated.userId);
    if (!user) throw ApiError.unauthorized('Account no longer exists');
    if (!user.isActive) {
      await revokeAllUserTokens(user._id, 'account_deactivated');
      throw ApiError.forbidden('Your account has been deactivated.');
    }

    const access = signAccessToken(user);
    return {
      user: toPublicUser(user),
      accessToken: access.token,
      refreshToken: rotated.token,
      tokenType: 'Bearer',
      expiresIn: access.expiresInSeconds,
      expiresAt: access.expiresAt,
      refreshExpiresAt: rotated.expiresAt,
    };
  }

  /**
   * Logout: revoke the presented refresh session (or every session).
   *
   * Note: an already issued *access* token remains valid until its own expiry
   * because access tokens are stateless. See README § Authentication flow.
   */
  async logout({ refreshToken, allDevices = false, userId = null }) {
    if (allDevices && userId) {
      await revokeAllUserTokens(userId, 'logout_all_devices');
      return { revokedAll: true };
    }
    const revoked = await revokeRefreshToken(refreshToken, 'logout');
    return { revoked, revokedAll: false };
  }

  /**
   * Current authenticated user profile.
   */
  async me(userId) {
    const user = await User.findById(toObjectId(userId));
    if (!user) throw ApiError.notFound('User not found');
    const activeSessions = await countActiveSessions(user._id);
    return { ...toPublicUser(user), activeSessions };
  }

  /**
   * Change the authenticated user's own password and revoke every existing
   * refresh session (all devices must sign in again).
   */
  async changePassword(userId, { currentPassword, newPassword }) {
    const user = await User.findById(toObjectId(userId)).select('+passwordHash');
    if (!user) throw ApiError.notFound('User not found');

    if (!(await user.comparePassword(currentPassword))) {
      throw ApiError.unauthorized('Current password is incorrect');
    }

    if (await user.comparePassword(newPassword)) {
      throw ApiError.badRequest('New password must be different from the current password');
    }

    user.passwordHash = await User.hashPassword(newPassword);
    await user.save();
    await revokeAllUserTokens(user._id, 'password_changed');

    return { revokedAllSessions: true };
  }

  /**
   * Verify that a password satisfies the security policy (length + complexity).
   * Exposed separately so the seed / bootstrap scripts can reuse it.
   */
  static validatePasswordPolicy(password) {
    const problems = [];
    if (password.length < 12) problems.push('at least 12 characters');
    if (!/[a-z]/.test(password)) problems.push('a lowercase letter');
    if (!/[A-Z]/.test(password)) problems.push('an uppercase letter');
    if (!/[0-9]/.test(password)) problems.push('a number');
    if (!/[^A-Za-z0-9]/.test(password)) problems.push('a symbol');
    if (problems.length) {
      throw ApiError.badRequest(`Password is too weak: it must contain ${problems.join(', ')}`, {
        errors: [{ field: 'password', message: 'Password does not meet the security policy' }],
      });
    }
    return true;
  }
}

export const authService = new AuthService();
export { AuthService };
export default authService;