import { z } from 'zod';
import { PAGINATION, SORTABLE_FIELDS } from '../constants/pagination.js';
import { ROLE_VALUES } from '../constants/roles.js';
import { TIMELINE_ENTITY_VALUES } from '../constants/timeline.js';
import { isValidObjectId } from '../utils/objectId.js';

/**
 * Reusable validation primitives shared by every module validator.
 */

export const objectId = z
  .string()
  .refine(isValidObjectId, { message: 'Must be a valid MongoDB ObjectId' });

export const optionalObjectId = objectId.nullish().transform((value) => value ?? undefined);

export const email = z
  .string()
  .trim()
  .min(3, 'Email is required')
  .max(254, 'Email must be at most 254 characters')
  .toLowerCase()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Must be a valid email address');

export const phone = z
  .string()
  .trim()
  .regex(/^[+]?[0-9\s()-]{7,20}$/, 'Must be a valid phone number');

export const optionalPhone = z.union([phone, z.literal('')]).optional().default('');

export const name = z.string().trim().min(2, 'Must be at least 2 characters').max(120);

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const isoDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'Must be a valid ISO date' })
  .transform((value) => new Date(value));

export const isoDateOptional = isoDate.optional();

export const idParam = z.object({ id: objectId });

/** Alias used by the route modules: `{ id: <ObjectId> }` path parameter. */
export const idParamSchema = idParam;

export const roleEnum = z.enum(ROLE_VALUES, {
  errorMap: () => ({ message: `Role must be one of: ${ROLE_VALUES.join(', ')}` }),
});

export const booleanFlag = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const csvEnum = (values) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((value) => (Array.isArray(value) ? value : String(value).split(',').map((v) => v.trim())))
    .transform((items) => items.filter(Boolean))
    .refine((items) => items.every((item) => values.includes(item)), {
      message: `Allowed values: ${values.join(', ')}`,
    });

/**
 * Build a `sortBy` schema from the shared per-collection allow-list so that the
 * validator and the query layer can never drift apart.
 */
export const sortByField = (collection) =>
  z.enum(SORTABLE_FIELDS[collection], {
    errorMap: () => ({
      message: `sortBy must be one of: ${SORTABLE_FIELDS[collection].join(', ')}`,
    }),
  });

export const sortOrderField = z.enum(['asc', 'desc', 'ASC', 'DESC'], {
  errorMap: () => ({ message: 'sortOrder must be one of: asc, desc' }),
});

/**
 * Partial-update schema helper: rejects unknown keys so that mass assignment is
 * impossible even if validation were bypassed.
 */
export const strictObject = (shape) => z.object(shape).strict();

/**
 * Standard list-query fields: pagination + sorting + search + date range.
 * Module specific filters are merged on top of this object.
 */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1, 'Must be >= 1').optional().default(PAGINATION.DEFAULT_PAGE),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Must be >= 1')
    .max(PAGINATION.MAX_LIMIT, `Must be <= ${PAGINATION.MAX_LIMIT}`)
    .optional()
    .default(PAGINATION.DEFAULT_LIMIT),
  sortBy: z.string().trim().optional(),
  sortOrder: sortOrderField.optional(),
  search: z.string().trim().max(120, 'Search keyword is too long').optional(),
  dateFrom: isoDateOptional,
  dateTo: isoDateOptional,
});

export const timelineEntityType = z.enum(TIMELINE_ENTITY_VALUES, {
  errorMap: () => ({ message: `Entity type must be one of: ${TIMELINE_ENTITY_VALUES.join(', ')}` }),
});