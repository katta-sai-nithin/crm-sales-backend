/**
 * Sales activity / follow-up constants.
 */
export const ACTIVITY_TYPES = Object.freeze({
  CALL: 'CALL',
  EMAIL: 'EMAIL',
  MEETING: 'MEETING',
  DEMO: 'DEMO',
  FOLLOW_UP: 'FOLLOW_UP',
  REMINDER: 'REMINDER',
  NOTE: 'NOTE',
});

export const ACTIVITY_TYPE_VALUES = Object.freeze(Object.values(ACTIVITY_TYPES));

/**
 * Activity statuses.
 *
 * Stored statuses are PENDING and COMPLETED. OVERDUE is a *derived* status: it is
 * computed on read (and optionally persisted by the scheduled maintenance job)
 * whenever a non-completed activity's due date is in the past.
 */
export const ACTIVITY_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  COMPLETED: 'COMPLETED',
  OVERDUE: 'OVERDUE',
});

export const ACTIVITY_STATUS_VALUES = Object.freeze(Object.values(ACTIVITY_STATUSES));

export const ACTIVITY_RELATED_ENTITY_TYPES = Object.freeze({
  LEAD: 'LEAD',
  CUSTOMER: 'CUSTOMER',
  DEAL: 'DEAL',
  USER: 'USER',
});

export const ACTIVITY_RELATED_ENTITY_VALUES = Object.freeze(
  Object.values(ACTIVITY_RELATED_ENTITY_TYPES)
);

/** Types that create a follow-up obligation and therefore require a due date. */
export const ACTIVITY_TYPES_REQUIRING_DUE_DATE = Object.freeze([
  ACTIVITY_TYPES.CALL,
  ACTIVITY_TYPES.EMAIL,
  ACTIVITY_TYPES.MEETING,
  ACTIVITY_TYPES.DEMO,
  ACTIVITY_TYPES.FOLLOW_UP,
  ACTIVITY_TYPES.REMINDER,
]);