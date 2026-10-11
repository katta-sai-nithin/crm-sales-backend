import { z } from 'zod';
import {
  email,
  password,
  name,
  optionalPhone,
  roleEnum,
  objectId,
  strictObject,
  booleanFlag,
  sortByField,
  sortOrderField,
} from './common.validator.js';
import { PAGINATION } from '../constants/pagination.js';

/**
 * POST /api/v1/auth/register
 *
 * Public self-registration. The role is deliberately fixed to SALES_EXECUTIVE:
 * a public caller can never create (or escalate to) an administrator account.
 */
export const registerSchema = strictObject({
  name,
  email,
  phone: optionalPhone,
  password,
});

/**
 * POST /api/v1/auth/login
 */
export const loginSchema = strictObject({
  email,
  // Deliberately permissive: a login attempt must not leak password policy rules.
  password: z.string().min(1, 'Password is required').max(128),
});

/**
 * POST /api/v1/auth/refresh
 */
export const refreshSchema = strictObject({
  refreshToken: z.string().min(10, 'refreshToken is required').optional(),
});

/**
 * POST /api/v1/auth/logout
 */
export const logoutSchema = strictObject({
  refreshToken: z.string().min(10, 'refreshToken is required').optional(),
  allDevices: booleanFlag.optional().default(false),
});

/**
 * POST /api/v1/users (admin user creation)
 */
export const createUserSchema = strictObject({
  name,
  email,
  phone: optionalPhone,
  password,
  role: roleEnum,
  team: objectId.optional(),
});

/**
 * PATCH /api/v1/users/:id
 *
 * `isActive` is intentionally NOT part of this schema: activation and
 * deactivation are dedicated, separately audited operations.
 */
export const updateUserSchema = strictObject({
  name: name.optional(),
  email: email.optional(),
  phone: optionalPhone.optional(),
  role: roleEnum.optional(),
  team: objectId.nullable().optional(),
});

/**
 * PATCH /api/v1/users/:id/password (self service password change)
 */
export const changePasswordSchema = strictObject({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: password,
});

/**
 * GET /api/v1/users
 */
export const listUsersQuery = z
  .object({
    page: z.coerce.number().int().min(1).optional().default(PAGINATION.DEFAULT_PAGE),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(PAGINATION.MAX_LIMIT, `Must be <= ${PAGINATION.MAX_LIMIT}`)
      .optional()
      .default(PAGINATION.DEFAULT_LIMIT),
    sortBy: sortByField('users').optional(),
    sortOrder: sortOrderField.optional(),
    search: z.string().trim().max(120).optional(),
    role: roleEnum.optional(),
    isActive: booleanFlag.optional(),
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().optional(),
  })
  .strict();

export const idParamSchema = strictObject({ id: objectId });

/**
 * PATCH /api/v1/users/:id/status
 */
export const setUserStatusSchema = strictObject({
  isActive: z.boolean({ error: 'isActive must be a boolean' }),
});