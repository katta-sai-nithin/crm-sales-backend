/**
 * Lead lifecycle constants and the allowed status transition graph.
 */
export const LEAD_SOURCES = Object.freeze({
  WEBSITE: 'WEBSITE',
  REFERRAL: 'REFERRAL',
  SOCIAL_MEDIA: 'SOCIAL_MEDIA',
  EMAIL: 'EMAIL',
  PHONE: 'PHONE',
  OTHER: 'OTHER',
});

export const LEAD_SOURCE_VALUES = Object.freeze(Object.values(LEAD_SOURCES));

export const LEAD_STATUSES = Object.freeze({
  NEW: 'NEW',
  CONTACTED: 'CONTACTED',
  QUALIFIED: 'QUALIFIED',
  UNQUALIFIED: 'UNQUALIFIED',
  CONVERTED: 'CONVERTED',
  LOST: 'LOST',
});

export const LEAD_STATUS_VALUES = Object.freeze(Object.values(LEAD_STATUSES));

export const LEAD_PRIORITIES = Object.freeze({
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
});

export const LEAD_PRIORITY_VALUES = Object.freeze(Object.values(LEAD_PRIORITIES));

/**
 * Allowed lead status transitions.
 *
 * Documented assumptions:
 *  - A CONVERTED lead is terminal. Conversion is only performed by the dedicated
 *    conversion endpoint, never by a plain status update.
 *  - A LOST or UNQUALIFIED lead can be reworked back into the pipeline.
 */
export const LEAD_STATUS_TRANSITIONS = Object.freeze({
  NEW: ['CONTACTED', 'QUALIFIED', 'UNQUALIFIED', 'LOST'],
  CONTACTED: ['QUALIFIED', 'UNQUALIFIED', 'LOST'],
  QUALIFIED: ['CONVERTED', 'LOST'],
  UNQUALIFIED: ['CONTACTED', 'QUALIFIED', 'LOST'],
  CONVERTED: [],
  LOST: ['CONTACTED', 'QUALIFIED'],
});

export const LEAD_TERMINAL_STATUSES = Object.freeze(['CONVERTED']);