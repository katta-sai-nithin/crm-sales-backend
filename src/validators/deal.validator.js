import { z } from 'zod';
import {
  objectId,
  paginationQuery,
  strictObject,
  csvEnum,
  sortByField,
} from './common.validator.js';
import { DEAL_STAGE_VALUES } from '../constants/deal.js';
import {
  ACTIVITY_TYPE_VALUES,
  ACTIVITY_STATUS_VALUES,
  ACTIVITY_RELATED_ENTITY_VALUES,
} from '../constants/activity.js';
import { MONEY } from '../constants/deal.js';
import { TIMELINE_ENTITY_VALUES } from '../constants/timeline.js';

/**
 * POST /api/v1/deals
 */
export const createDealSchema = strictObject({
  name: z.string().trim().min(2, 'Deal name must be at least 2 characters').max(160),
  customer: objectId,
  assignedTo: objectId.optional(),
  dealValue: z.coerce
    .number({ error: 'dealValue must be a number' })
    .positive('dealValue must be greater than zero')
    .max(MONEY.maxAmount, `dealValue must not exceed ${MONEY.maxAmount}`),
  probability: z.coerce
    .number({ error: 'probability must be a number' })
    .int('probability must be an integer')
    .min(0, 'probability must be between 0 and 100')
    .max(100, 'probability must be between 0 and 100'),
  expectedClosingDate: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), {
      message: 'expectedClosingDate must be a valid ISO date',
    })
    .transform((value) => new Date(value)),
  stage: z.enum(DEAL_STAGE_VALUES).optional().default('QUALIFICATION'),
  description: z.string().trim().max(4000).optional().default(''),
  lostReason: z.string().trim().max(1000).optional().default(''),
});

/**
 * PATCH /api/v1/deals/:id
 *
 * Server controlled fields (`createdBy`, `expectedRevenue`, `closedAt`, `lead`,
 * `currency`) are not part of the schema and would be rejected as unknown keys.
 */
export const updateDealSchema = strictObject({
  name: z.string().trim().min(2).max(160).optional(),
  dealValue: z.coerce.number().positive().max(MONEY.maxAmount).optional(),
  probability: z.coerce.number().int().min(0).max(100).optional(),
  expectedClosingDate: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'Must be a valid ISO date' })
    .transform((value) => new Date(value))
    .optional(),
  description: z.string().trim().max(4000).optional(),
});

export const updateDealStageSchema = strictObject({
  stage: z.enum(DEAL_STAGE_VALUES),
  lostReason: z.string().trim().max(1000).optional(),
  expectedClosingDate: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'Must be a valid ISO date' })
    .transform((value) => new Date(value))
    .optional(),
});

export const assignDealSchema = strictObject({
  assignedTo: objectId.nullable(),
  reason: z.string().trim().max(500).optional(),
});

export const reopenDealSchema = strictObject({
  stage: z.enum(['QUALIFICATION', 'DISCOVERY', 'PROPOSAL', 'NEGOTIATION']),
  reason: z.string().trim().min(3, 'A reason is required when reopening a deal').max(500),
});

export const listDealsQuery = paginationQuery
  .extend({
    stage: csvEnum(DEAL_STAGE_VALUES).optional(),
    assignedTo: objectId.optional(),
    customer: objectId.optional(),
    lead: objectId.optional(),
    minValue: z.coerce.number().min(0, 'minValue must be >= 0').optional(),
    maxValue: z.coerce.number().min(0, 'maxValue must be >= 0').optional(),
    closingFrom: z.string().trim().optional(),
    closingTo: z.string().trim().optional(),
    sortBy: sortByField('deals').optional(),
  })
  .strict();

/**
 * POST /api/v1/activities
 */
export const createActivitySchema = strictObject({
  type: z.enum(ACTIVITY_TYPE_VALUES),
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(160),
  description: z.string().trim().max(4000).optional().default(''),
  assignedTo: objectId.optional(),
  dueDate: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'dueDate must be a valid ISO date' })
    .transform((value) => new Date(value))
    .optional(),
  relatedEntityType: z.enum(ACTIVITY_RELATED_ENTITY_VALUES),
  relatedEntityId: objectId,
});

/**
 * PATCH /api/v1/activities/:id
 */
export const updateActivitySchema = strictObject({
  title: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(4000).optional(),
  type: z.enum(ACTIVITY_TYPE_VALUES).optional(),
  dueDate: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'dueDate must be a valid ISO date' })
    .transform((value) => new Date(value))
    .nullable()
    .optional(),
});

export const listActivitiesQuery = paginationQuery
  .extend({
    type: csvEnum(ACTIVITY_TYPE_VALUES).optional(),
    status: csvEnum(ACTIVITY_STATUS_VALUES).optional(),
    assignedTo: objectId.optional(),
    relatedEntityType: z.enum(ACTIVITY_RELATED_ENTITY_VALUES).optional(),
    relatedEntityId: objectId.optional(),
    dueFrom: z.string().trim().optional(),
    dueTo: z.string().trim().optional(),
    sortBy: sortByField('activities').optional(),
  })
  .strict();

/**
 * GET /api/v1/timeline/:entityType/:entityId
 */
export const timelineParamsSchema = strictObject({
  entityType: z.enum(TIMELINE_ENTITY_VALUES, {
    errorMap: () => ({ message: `entityType must be one of: ${TIMELINE_ENTITY_VALUES.join(', ')}` }),
  }),
  entityId: objectId,
});

export const listTimelineQuery = paginationQuery
  .extend({
    action: z.string().trim().max(60).optional(),
  })
  .strict();

export const analyticsQuery = z
  .object({
    dateFrom: z.string().trim().optional(),
    dateTo: z.string().trim().optional(),
    team: z.string().trim().optional(),
  })
  .strict();