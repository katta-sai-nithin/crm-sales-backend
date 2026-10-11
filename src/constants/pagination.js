/**
 * Pagination defaults and approved sort fields per collection.
 *
 * Sorting is always validated against an explicit allowlist: arbitrary field
 * names coming from the client are never forwarded to MongoDB.
 */
export const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 100,
  SORT_ORDERS: Object.freeze(['asc', 'desc']),
});

export const SORTABLE_FIELDS = Object.freeze({
  users: Object.freeze(['name', 'email', 'role', 'isActive', 'createdAt', 'updatedAt']),
  leads: Object.freeze([
    'name',
    'email',
    'company',
    'status',
    'priority',
    'source',
    'createdAt',
    'updatedAt',
  ]),
  customers: Object.freeze(['name', 'email', 'company', 'status', 'createdAt', 'updatedAt']),
  deals: Object.freeze([
    'name',
    'dealValue',
    'expectedRevenue',
    'probability',
    'stage',
    'expectedClosingDate',
    'createdAt',
    'updatedAt',
  ]),
  activities: Object.freeze(['type', 'status', 'dueDate', 'createdAt', 'updatedAt']),
  timelines: Object.freeze(['createdAt']),
});