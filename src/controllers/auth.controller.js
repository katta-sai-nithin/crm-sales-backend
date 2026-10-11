import config from '../config/env.js';
import { authService } from '../services/auth.service.js';
import { sendSuccess, sendCreated } from '../utils/ApiResponse.js';

const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Attach the refresh token as an HttpOnly cookie for browser clients.
 *
 * Security notes (see README § Authentication flow):
 *  - `httpOnly`  : JavaScript cannot read it, so an XSS bug cannot exfiltrate it.
 *  - `secure`    : only transmitted over HTTPS (enabled automatically in prod).
 *  - `sameSite`  : `Strict` by default; the cookie is only sent for same-site
 *                  requests. A `Lax` configuration is acceptable together with
 *                  CSRF protection for a cross-site SPA deployment.
 *  - `path`      : restricted to the auth routes so it is not attached to every
 *                  API call.
 */
function setRefreshCookie(res, token) {
  if (!config.security.refreshTokenCookie) return;
  res.cookie(config.security.refreshCookieName, token, {
    httpOnly: true,
    secure: config.security.refreshCookieSecure,
    sameSite: config.security.refreshCookieSameSite,
    path: config.security.refreshCookiePath,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(config.security.refreshCookieName, {
    httpOnly: true,
    secure: config.security.refreshCookieSecure,
    sameSite: config.security.refreshCookieSameSite,
    path: config.security.refreshCookiePath,
  });
}

/**
 * Build the request context (IP + user agent) used by the token store.
 */
const contextFrom = (req) => ({
  ip: req.ip || '',
  userAgent: req.headers['user-agent'] || '',
});

/**
 * POST /api/v1/auth/register
 */
export const register = async (req, res) => {
  const payload = await authService.register(req.body, contextFrom(req));
  setRefreshCookie(res, payload.refreshToken);
  return sendCreated(res, {
    message: 'Account created successfully',
    data: payload,
  });
};

/**
 * POST /api/v1/auth/login
 */
export const login = async (req, res) => {
  const payload = await authService.login(req.body, contextFrom(req));
  setRefreshCookie(res, payload.refreshToken);
  return sendSuccess(res, {
    message: 'Logged in successfully',
    data: payload,
  });
};

/**
 * POST /api/v1/auth/refresh
 */
export const refresh = async (req, res) => {
  const refreshToken = req.body?.refreshToken || req.cookies?.[config.security.refreshCookieName];
  const payload = await authService.refresh({ refreshToken }, contextFrom(req));
  setRefreshCookie(res, payload.refreshToken);
  return sendSuccess(res, {
    message: 'Access token refreshed',
    data: payload,
  });
};

/**
 * POST /api/v1/auth/logout
 */
export const logout = async (req, res) => {
  const refreshToken = req.body?.refreshToken || req.cookies?.[config.security.refreshCookieName];
  const result = await authService.logout({
    refreshToken,
    allDevices: req.body?.allDevices ?? false,
    userId: req.userId,
  });
  clearRefreshCookie(res);
  return sendSuccess(res, {
    message: 'Logged out successfully',
    data: result,
  });
};

/**
 * GET /api/v1/auth/me
 */
export const me = async (req, res) => {
  const user = await authService.me(req.userId);
  return sendSuccess(res, { message: 'Current user retrieved', data: user });
};

/**
 * PATCH /api/v1/auth/password
 */
export const changePassword = async (req, res) => {
  const result = await authService.changePassword(req.userId, req.body);
  clearRefreshCookie(res);
  return sendSuccess(res, {
    message: 'Password updated. Please sign in again on all devices.',
    data: result,
  });
};

export { setRefreshCookie, clearRefreshCookie };