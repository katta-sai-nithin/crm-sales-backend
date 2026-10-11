/**
 * Deal pipeline constants, stage transition graph and monetary helpers.
 */
export const DEAL_STAGES = Object.freeze({
  QUALIFICATION: 'QUALIFICATION',
  DISCOVERY: 'DISCOVERY',
  PROPOSAL: 'PROPOSAL',
  NEGOTIATION: 'NEGOTIATION',
  WON: 'WON',
  LOST: 'LOST',
});

export const DEAL_STAGE_VALUES = Object.freeze(Object.values(DEAL_STAGES));

export const OPEN_DEAL_STAGES = Object.freeze([
  DEAL_STAGES.QUALIFICATION,
  DEAL_STAGES.DISCOVERY,
  DEAL_STAGES.PROPOSAL,
  DEAL_STAGES.NEGOTIATION,
]);

export const CLOSED_DEAL_STAGES = Object.freeze([DEAL_STAGES.WON, DEAL_STAGES.LOST]);

/**
 * Allowed deal stage transitions.
 *
 * Documented assumption: the pipeline is strictly forward moving. A closed deal
 * (WON / LOST) cannot return to an open stage through the regular stage update
 * endpoint - only through the explicit `POST /api/v1/deals/:id/reopen` operation.
 */
export const DEAL_STAGE_TRANSITIONS = Object.freeze({
  QUALIFICATION: ['DISCOVERY', 'PROPOSAL', 'WON', 'LOST'],
  DISCOVERY: ['PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'],
  PROPOSAL: ['NEGOTIATION', 'WON', 'LOST'],
  NEGOTIATION: ['WON', 'LOST'],
  WON: [],
  LOST: [],
});

/**
 * Monetary configuration.
 *
 * Assumption: all monetary amounts are expressed in a single currency (USD by
 * default, configurable through DEAL_CURRENCY) and stored as a Number with two
 * decimal places of precision. Server-side rounding uses
 * `roundToCents` so that `dealValue * probability / 100` is computed from integer
 * cents and is therefore free of binary floating point drift.
 */
export const MONEY = Object.freeze({
  currency: process.env.DEAL_CURRENCY || 'USD',
  decimals: 2,
  maxAmount: 999_999_999.99,
});