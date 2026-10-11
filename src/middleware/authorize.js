import { ApiError } from '../utils/ApiError.js';
import { ROLES } from '../constants/roles.js';

/**
 * Role-based authorisation middleware.
 *
 * @param {...string} allowedRoles roles allowed to access the route
 */
export const authorize = (...allowedRoles) => (req, _res, next) => {
  try {
    if (!req.user) {
      throw ApiError.unauthorized('Authentication required');
    }
    if (!allowedRoles.includes(req.user.role)) {
      throw ApiError.forbidden(
        `This action requires one of the following roles: ${allowedRoles.join(', ')}`
      );
    }
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Convenience wrappers used by the route definitions.
 */
export const adminOnly = authorize(ROLES.ADMIN);
export const managerOrAdmin = authorize(ROLES.ADMIN, ROLES.SALES_MANAGER);
export const salesRoles = authorize(ROLES.ADMIN, ROLES.SALES_MANAGER, ROLES.SALES_EXECUTIVE);

/**
 * Require that the authenticated user is either an administrator or the owner of
 * the record identified by the request parameter.
 */
export const selfOrAdmin = (paramName = 'id') => (req, _res, next) => {
  try {
    if (!req.user) throw ApiError.unauthorized('Authentication required');
    if (req.user.role === ROLES.ADMIN) return next();
    if (String(req.user.id) === String(req.params[paramName])) return next();
    throw ApiError.forbidden('You may only access your own records');
  } catch (error) {
    next(error);
  }
};

export default authorize;