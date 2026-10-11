import { z } from 'zod';
import {
  objectId,
  email,
  name,
  optionalPhone,
  paginationQuery,
  strictObject,
  csvEnum,
  sortByField,
} from './common.validator.js';
import { LEAD_SOURCE_VALUES, LEAD_STATUS_VALUES, LEAD_PRIORITY_VALUES } from '../constants/lead.js';
import { CUSTOMER_STATUS_VALUES, CUSTOMER_ORIGIN_VALUES } from '../constants/customer.js';

/**
 * POST /api/v1/leads
 *
 * `assignedTo` is accepted here but validated again on the server by
 * LeadService, which enforces role / team rules. A client can never bypass those
 * checks by crafting the payload.
 */
export const createLeadSchema = strictObject({
  name,
  email,
  phone: optionalPhone,
  company: z.string().trim().max(160).optional().default(''),
  source: z.enum(LEAD_SOURCE_VALUES).optional().default('OTHER'),
  priority: z.enum(LEAD_PRIORITY_VALUES).optional().default('MEDIUM'),
  assignedTo: objectId.nullish(),
  description: z.string().trim().max(4000).optional().default(''),
});

/**
 * PATCH /api/v1/leads/:id
 *
 * `assignedTo` and `status` are intentionally excluded: they can only be changed
 * through the dedicated assignment / status endpoints, which run the full
 * authorisation and transition checks.
 */
export const updateLeadSchema = strictObject({
  name: name.optional(),
  email: email.optional(),
  phone: optionalPhone.optional(),
  company: z.string().trim().max(160).optional(),
  source: z.enum(LEAD_SOURCE_VALUES).optional(),
  priority: z.enum(LEAD_PRIORITY_VALUES).optional(),
  description: z.string().trim().max(4000).optional(),
});

export const updateLeadStatusSchema = strictObject({
  status: z.enum(LEAD_STATUS_VALUES),
  reason: z.string().trim().max(500).optional(),
});

export const assignLeadSchema = strictObject({
  assignedTo: objectId.nullable(),
  reason: z.string().trim().max(500).optional(),
});

export const listLeadsQuery = paginationQuery
  .extend({
    status: csvEnum(LEAD_STATUS_VALUES).optional(),
    priority: csvEnum(LEAD_PRIORITY_VALUES).optional(),
    source: csvEnum(LEAD_SOURCE_VALUES).optional(),
    assignedTo: objectId.optional(),
    createdBy: objectId.optional(),
    unassigned: z
      .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
      .transform((v) => v === true || v === 'true' || v === '1')
      .optional(),
    sortBy: sortByField('leads').optional(),
  })
  .strict();

/**
 * POST /api/v1/leads/:id/convert
 */
export const convertLeadSchema = strictObject({
  dealName: z.string().trim().min(2, 'dealName must be at least 2 characters').max(160),
  dealValue: z.coerce
    .number({ error: 'dealValue must be a number' })
    .positive('dealValue must be greater than zero')
    .max(999999999.99, 'dealValue is too large'),
  probability: z.coerce
    .number({ error: 'probability must be a number' })
    .int('probability must be an integer')
    .min(0, 'probability must be between 0 and 100')
    .max(100, 'probability must be between 0 and 100'),
  expectedClosingDate: z
    .string()
    .trim()
    .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'expectedClosingDate must be a valid ISO date' })
    .transform((value) => new Date(value)),
  stage: z
    .enum(['QUALIFICATION', 'DISCOVERY', 'PROPOSAL', 'NEGOTIATION'])
    .optional()
    .default('QUALIFICATION'),
  description: z.string().trim().max(4000).optional().default(''),
  assignedTo: objectId.optional(),
});

/**
 * POST /api/v1/customers
 */
export const createCustomerSchema = strictObject({
  name,
  email,
  phone: optionalPhone,
  company: z.string().trim().max(160).optional().default(''),
  address: z.string().trim().max(400).optional().default(''),
  assignedTo: objectId.nullish(),
  status: z.enum(CUSTOMER_STATUS_VALUES).optional().default('ACTIVE'),
  notes: z.string().trim().max(4000).optional().default(''),
});

export const updateCustomerSchema = strictObject({
  name: name.optional(),
  email: email.optional(),
  phone: optionalPhone.optional(),
  company: z.string().trim().max(160).optional(),
  address: z.string().trim().max(400).optional(),
  status: z.enum(CUSTOMER_STATUS_VALUES).optional(),
  notes: z.string().trim().max(4000).optional(),
});

export const listCustomersQuery = paginationQuery
  .extend({
    status: csvEnum(CUSTOMER_STATUS_VALUES).optional(),
    origin: csvEnum(CUSTOMER_ORIGIN_VALUES).optional(),
    assignedTo: objectId.optional(),
    originalLead: objectId.optional(),
    sortBy: sortByField('customers').optional(),
  })
  .strict();

export const assignCustomerSchema = strictObject({
  assignedTo: objectId.nullable(),
  reason: z.string().trim().max(500).optional(),
});