import config from '../config/env.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { verifyToken } from '../services/token.service.js';
import { toObjectId } from '../utils/objectId.js';

/**
 * Extract a bearer token from the Authorization header.
 * Also supports an `accessToken` cookie for browser clients.
 */
function extractAccessToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  if (req.cookies?.accessToken) {
    return req.cookies.accessToken;
  }
  return null;
}

/**
 * Authenticate the request using a valid, unexpired access token.
 *
 * The user document is re-read on every request so that a deactivated account or
 * a changed role takes effect immediately rather than at token expiry.
 */
export async function authenticate(req, _res, next) {
  try {
    const token = extractAccessToken(req);
    if (!token) {
      throw ApiError.unauthorized('Authentication required: missing access token');
    }

    let decoded;
    try {
      decoded = verifyToken(token, { secret: config.jwt.accessSecret, type: 'access' });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw ApiError.unauthorized('Access token has expired', { code: 'TOKEN_EXPIRED' });
      }
      throw ApiError.unauthorized('Invalid access token', { code: 'TOKEN_INVALID' });
    }

    const userId = toObjectId(decoded.sub);
    if (!userId) {
      throw ApiError.unauthorized('Invalid access token', { code: 'TOKEN_INVALID' });
    }

    const user = await User.findById(userId);
    if (!user) {
      throw ApiError.unauthorized('Account no longer exists');
    }
    if (!user.isActive) {
      throw ApiError.forbidden('Your account has been deactivated. Please contact an administrator.');
    }

    req.user = user;
    req.userId = user.id;
    req.tokenPayload = decoded;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Optional authentication: populates `req.user` when a valid token is present but
 * never rejects the request.
 */
export async function optionalAuthenticate(req, res, next) {
  if (!extractAccessToken(req)) return next();
  return authenticate(req, res, next);
}

export default authenticate;