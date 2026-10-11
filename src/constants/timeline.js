/**
 * Audit / timeline event constants.
 *
 * Timeline entries are append-only: the public API never exposes an update or
 * delete operation for them.
 */
export const TIMELINE_ENTITY_TYPES = Object.freeze({
  LEAD: 'LEAD',
  CUSTOMER: 'CUSTOMER',
  DEAL: 'DEAL',
  USER: 'USER',
  ACTIVITY: 'ACTIVITY',
});

export const TIMELINE_ENTITY_VALUES = Object.freeze(Object.values(TIMELINE_ENTITY_TYPES));

export const TIMELINE_ACTIONS = Object.freeze({
  LEAD_CREATED: 'LEAD_CREATED',
  LEAD_ASSIGNED: 'LEAD_ASSIGNED',
  LEAD_REASSIGNED: 'LEAD_REASSIGNED',
  LEAD_STATUS_CHANGED: 'LEAD_STATUS_CHANGED',
  LEAD_PRIORITY_CHANGED: 'LEAD_PRIORITY_CHANGED',
  LEAD_UPDATED: 'LEAD_UPDATED',
  LEAD_DELETED: 'LEAD_DELETED',

  CUSTOMER_CREATED: 'CUSTOMER_CREATED',
  CUSTOMER_ASSIGNED: 'CUSTOMER_ASSIGNED',
  CUSTOMER_UPDATED: 'CUSTOMER_UPDATED',
  CUSTOMER_DELETED: 'CUSTOMER_DELETED',

  LEAD_CONVERTED: 'LEAD_CONVERTED',

  DEAL_CREATED: 'DEAL_CREATED',
  DEAL_ASSIGNED: 'DEAL_ASSIGNED',
  DEAL_STAGE_CHANGED: 'DEAL_STAGE_CHANGED',
  DEAL_WON: 'DEAL_WON',
  DEAL_LOST: 'DEAL_LOST',
  DEAL_REOPENED: 'DEAL_REOPENED',
  DEAL_UPDATED: 'DEAL_UPDATED',
  DEAL_DELETED: 'DEAL_DELETED',

  ACTIVITY_CREATED: 'ACTIVITY_CREATED',
  ACTIVITY_COMPLETED: 'ACTIVITY_COMPLETED',
  ACTIVITY_UPDATED: 'ACTIVITY_UPDATED',
  ACTIVITY_DELETED: 'ACTIVITY_DELETED',

  USER_CREATED: 'USER_CREATED',
  USER_ACTIVATED: 'USER_ACTIVATED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  USER_UPDATED: 'USER_UPDATED',
});

/**
 * Field allowlist for audit payloads. Any attempt to write a key outside this
 * list is dropped, which guarantees that passwords, tokens or other secrets can
 * never end up in the audit trail.
 */
export const TIMELINE_SAFE_FIELDS = Object.freeze([
  'name',
  'email',
  'phone',
  'company',
  'status',
  'priority',
  'source',
  'stage',
  'probability',
  'dealValue',
  'expectedRevenue',
  'expectedClosingDate',
  'assignedTo',
  'createdBy',
  'closedAt',
  'lostReason',
  'dueDate',
  'completedAt',
  'type',
  'title',
  'isActive',
  'role',
  'relatedEntityType',
  'relatedEntityId',
  'convertedCustomer',
  'originalLead',
  'customer',
  'lead',
  'address',
  'description',
]);