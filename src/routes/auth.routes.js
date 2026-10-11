import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  changePasswordSchema,
} from '../validators/auth.validator.js';
import {
  register,
  login,
  refresh,
  logout,
  me,
  changePassword,
} from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/authenticate.js';
import { accountLockoutMiddleware } from '../middleware/rateLimiter.js';
import config from '../config/env.js';

/**
 * Credential endpoints get their own, stricter limiter keyed by IP + email so a
 * distributed credential stuffing attempt is throttled per account.
 */
const credentialLimiter = config.rateLimit.enabled
  ? rateLimit({
      windowMs: config.rateLimit.authWindowMs,
      limit: config.rateLimit.authMax,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => {
        const ip = ipKeyGenerator(req.ip || 'unknown');
        const email = String(req.body?.email || '').toLowerCase().trim();
        return email ? `${ip}:${email}` : ip;
      },
      handler: (_req, _res, next) => {
        const error = new Error('Too many authentication attempts. Please try again later.');
        error.status = 429;
        error.code = 'RATE_LIMIT_EXCEEDED';
        error.isRateLimit = true;
        next(error);
      },
    })
  : (_req, _res, next) => next();

const router = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags: [Authentication]
 *     operationId: registerUser
 *     summary: Register a new Sales Executive account
 *     description: |
 *       Public self-registration. The new account is always created with the
 *       `SALES_EXECUTIVE` role - a public caller can never create or escalate to
 *       an administrator account. Administrators are created either through
 *       `npm run bootstrap-admin` or by an authenticated ADMIN calling
 *       `POST /api/v1/users`.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password]
 *             properties:
 *               name: { type: string, minLength: 2, maxLength: 120, example: 'Jane Doe' }
 *               email: { type: string, format: email, example: 'jane.doe@example.com' }
 *               phone: { type: string, example: '+1 555 0100' }
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: 'Str0ngPassw0rd!'
 *     responses:
 *       201:
 *         description: Account created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Email already registered
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429:
 *         description: Too many attempts
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/register',
  credentialLimiter,
  validate(registerSchema, 'body'),
  asyncHandler(register)
);

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags: [Authentication]
 *     operationId: loginUser
 *     summary: Authenticate and receive an access + refresh token pair
 *     description: |
 *       **Replace the example values below with the credentials you configured
 *       locally** (`npm run bootstrap-admin`). No real credentials are shipped
 *       with this API.
 *
 *       Paste the returned `accessToken` into the **Authorize** dialog at the top
 *       right of this page to call the protected endpoints.
 *
 *       The refresh token is returned in the body **and** set as an HttpOnly
 *       cookie. Send the cookie to `POST /api/v1/auth/refresh` or pass the token
 *       in the body.
 *
 *       | Status | Meaning |
 *       | --- | --- |
 *       | `200` | Success |
 *       | `400` | The payload is malformed - a field is missing/blank, the email is not a valid address, or an unexpected field was sent |
 *       | `401` | Email/password combination is wrong (deliberately generic) |
 *       | `403` | The account exists but has been deactivated |
 *       | `429` | Too many failed attempts for this IP + email |
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: The email address you registered the account with.
 *                 example: admin@example.com
 *               password:
 *                 type: string
 *                 minLength: 1
 *                 description: The account password. Never the literal example below.
 *                 example: YOUR-PASSWORD-HERE
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       401:
 *         description: Invalid credentials (deliberately generic)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Account deactivated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429:
 *         description: Too many attempts
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/login', credentialLimiter, accountLockoutMiddleware, validate(loginSchema, 'body'), asyncHandler(login));

/**
 * @openapi
 * /auth/refresh:
 *   post:
 *     tags: [Authentication]
 *     operationId: refreshAccessToken
 *     summary: Rotate a refresh token and mint a new access token
 *     description: |
 *       Refresh tokens are single use. Presenting a token revokes it and issues a
 *       replacement belonging to the same family. Re-using a revoked token revokes
 *       the entire family (token reuse detection).
 *       The token may be sent in the body or as an HttpOnly cookie
 *       (`refreshToken`, path `/api/v1/auth`).
 *     security: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string }
 *     responses:
 *       200:
 *         description: Token refreshed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/AuthResponse' }
 *       401:
 *         description: Invalid, expired or already used refresh token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/refresh', credentialLimiter, validate(refreshSchema, 'body'), asyncHandler(refresh));

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags: [Authentication]
 *     operationId: logoutUser
 *     summary: Revoke the current refresh session
 *     description: |
 *       Revokes the presented refresh token. Access tokens are stateless and stay
 *       valid until they expire (default 15 minutes).
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken: { type: string }
 *               allDevices: { type: boolean, default: false }
 *     responses:
 *       200:
 *         description: Logged out
 *       401:
 *         description: Not authenticated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/logout', asyncHandler(authenticate), validate(logoutSchema, 'body'), asyncHandler(logout));

/**
 * @openapi
 * /auth/me:
 *   get:
 *     tags: [Authentication]
 *     operationId: getCurrentUser
 *     summary: Return the authenticated user profile
 *     responses:
 *       200:
 *         description: Current user
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/User' }
 *       401:
 *         description: Missing or invalid access token
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/me', asyncHandler(authenticate), asyncHandler(me));

/**
 * @openapi
 * /auth/password:
 *   patch:
 *     tags: [Authentication]
 *     operationId: changeMyPassword
 *     summary: Change the authenticated user's own password
 *     description: All refresh sessions are revoked after a successful change.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentPassword, newPassword]
 *             properties:
 *               currentPassword: { type: string }
 *               newPassword: { type: string, minLength: 8 }
 *     responses:
 *       200:
 *         description: Password changed
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       401:
 *         description: Current password incorrect
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch(
  '/password',
  asyncHandler(authenticate),
  validate(changePasswordSchema, 'body'),
  asyncHandler(changePassword)
);

export default router;