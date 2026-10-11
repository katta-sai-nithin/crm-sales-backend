/**
 * User roles.
 */
export const ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  SALES_MANAGER: 'SALES_MANAGER',
  SALES_EXECUTIVE: 'SALES_EXECUTIVE',
});

export const ROLE_VALUES = Object.freeze(Object.values(ROLES));

/**
 * Roles that a lead / customer / deal may be assigned to.
 * ADMIN users are intentionally excluded: administrators oversee the system,
 * they do not carry a sales book.
 */
export const ASSIGNABLE_ROLES = Object.freeze([
  ROLES.SALES_MANAGER,
  ROLES.SALES_EXECUTIVE,
]);

export const ROLE_LABELS = Object.freeze({
  ADMIN: 'Administrator',
  SALES_MANAGER: 'Sales Manager',
  SALES_EXECUTIVE: 'Sales Executive',
});