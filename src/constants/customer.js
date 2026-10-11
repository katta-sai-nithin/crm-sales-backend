/**
 * Customer lifecycle constants.
 */
export const CUSTOMER_STATUSES = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

export const CUSTOMER_STATUS_VALUES = Object.freeze(Object.values(CUSTOMER_STATUSES));

/**
 * How the customer record came into existence.
 *  - MANUAL: created directly by an authorised user from the customers API.
 *  - CONVERTED: created automatically as a side effect of converting a qualified lead.
 */
export const CUSTOMER_ORIGINS = Object.freeze({
  MANUAL: 'MANUAL',
  CONVERTED: 'CONVERTED',
});

export const CUSTOMER_ORIGIN_VALUES = Object.freeze(Object.values(CUSTOMER_ORIGINS));