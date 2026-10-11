import { HTTP_STATUS, ERROR_CODES } from '../constants/http.js';

/**
 * Application level error carrying an HTTP status code, a machine readable code
 * and an optional list of field level validation details.
 */
export class ApiError extends Error {
  constructor(message, { status = HTTP_STATUS.INTERNAL_SERVER_ERROR, code = ERROR_CODES.INTERNAL_ERROR, errors = [], details = null, isOperational = true } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.errors = errors;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message = 'Invalid request', options = {}) {
    return new ApiError(message, { status: HTTP_STATUS.BAD_REQUEST, code: ERROR_CODES.VALIDATION_ERROR, ...options });
  }

  static unauthorized(message = 'Authentication required', options = {}) {
    return new ApiError(message, { status: HTTP_STATUS.UNAUTHORIZED, code: ERROR_CODES.AUTHENTICATION_ERROR, ...options });
  }

  static forbidden(message = 'You do not have permission to perform this action', options = {}) {
    return new ApiError(message, { status: HTTP_STATUS.FORBIDDEN, code: ERROR_CODES.FORBIDDEN, ...options });
  }

  static notFound(message = 'Resource not found', options = {}) {
    return new ApiError(message, { status: HTTP_STATUS.NOT_FOUND, code: ERROR_CODES.NOT_FOUND, ...options });
  }

  static conflict(message = 'Resource already exists', options = {}) {
    return new ApiError(message, { status: HTTP_STATUS.CONFLICT, code: ERROR_CODES.DUPLICATE_RESOURCE, ...options });
  }

  static unprocessable(message = 'Business rule violation', options = {}) {
    return new ApiError(message, {
      status: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      code: ERROR_CODES.BUSINESS_RULE_VIOLATION,
      ...options,
    });
  }

  static internal(message = 'Internal server error', options = {}) {
    return new ApiError(message, { status: HTTP_STATUS.INTERNAL_SERVER_ERROR, ...options });
  }

  static serviceUnavailable(message = 'Service temporarily unavailable', options = {}) {
    return new ApiError(message, {
      status: HTTP_STATUS.SERVICE_UNAVAILABLE,
      code: ERROR_CODES.TRANSACTION_UNAVAILABLE,
      ...options,
    });
  }
}

export default ApiError;