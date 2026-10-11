import { ZodError } from 'zod';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import config from '../config/env.js';
import logger from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { HTTP_STATUS, ERROR_CODES } from '../constants/http.js';

/**
 * Centralised error handling middleware.
 *
 * Responsibilities:
 *  - Translate known error families (Zod, Mongoose, JWT, duplicate keys, cast
 *    errors) into the consistent `{ success, message, errors }` envelope.
 *  - Never leak stack traces, credentials, MongoDB internals or driver messages
 *    to the client in production.
 *  - Log every unhandled error with full detail server-side.
 */
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const context = {
    method: req.method,
    url: req.originalUrl,
    requestId: req.id,
    userId: req.user?.id,
    status: err.status || err.statusCode,
    errName: err.name,
    errMessage: err.message,
    stack: err.stack,
  };

  const normalized = normalizeError(err);
  normalized.status = normalized.status || HTTP_STATUS.INTERNAL_SERVER_ERROR;

  if (normalized.status >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
    logger.error(context, 'Unhandled error while processing request');
  } else {
    logger.warn(
      { ...context, stack: undefined, code: normalized.code },
      'Request rejected'
    );
  }

  const isServerError = normalized.status >= HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const message = isServerError && config.isProduction
    ? 'Internal server error'
    : normalized.message;

  const body = {
    success: false,
    message,
    code: normalized.code,
    errors: normalized.errors || [],
  };

  if (!config.isProduction && !isServerError && normalized.details) {
    body.details = normalized.details;
  }

  return res.status(normalized.status).json(body);
}

/**
 * Turn Zod's machine-oriented issue list into messages a human can act on.
 *
 * Zod v4 reports a missing field as "Invalid input: expected string, received
 * undefined", which is meaningless to an API consumer looking at a 400 in
 * Swagger UI. Schema-authored messages (for example "Must be a valid email
 * address") are kept verbatim; only the generic structural ones are rewritten.
 * At most one message is reported per field.
 *
 * @param {Array<object>} issues Zod issues
 * @param {string} fallbackField name used when an issue has no path (e.g. `body`)
 */
export function humanizeZodIssues(issues = [], fallbackField = 'request') {
  const seen = new Set();
  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

  return issues.reduce((acc, issue) => {
    const field = issue.path?.join('.') || fallbackField;

    // One message per field is enough to tell the caller what to fix.
    if (seen.has(field)) return acc;
    seen.add(field);

    let message = issue.message;

    if (issue.code === 'invalid_type') {
      // Zod 4 no longer exposes `received` on the issue object; it is only in
      // the message, so it has to be read from there.
      const received = issue.received ?? /received (\S+?)[.)]?$/.exec(issue.message)?.[1];
      message =
        received === 'undefined' || received === 'null'
          ? `${field} is required`
          : `${field} must be a ${String(issue.expected)}`;
    } else if (issue.code === 'too_big' && issue.origin === 'string') {
      message = `${field} must be at most ${plural(issue.maximum, 'character')}`;
    } else if (issue.code === 'too_small' && issue.origin === 'string') {
      message = `${field} must be at least ${plural(issue.minimum, 'character')}`;
    } else if (issue.code === 'unrecognized_keys') {
      const keys = (issue.keys || []).map((key) => `"${key}"`).join(', ');
      message = `Unexpected field(s) not allowed: ${keys}`;
    }

    acc.push({ field, message, code: issue.code });
    return acc;
  }, []);
}

/**
 * Map any thrown error onto the API error contract.
 */
export function normalizeError(err) {
  if (err instanceof ApiError) return err;

  // Zod validation errors -> 400 with field level details
  if (err instanceof ZodError) {
    return ApiError.badRequest('Request validation failed', {
      errors: humanizeZodIssues(err.issues),
    });
  }

  // Duplicate key (unique index violation) -> 409
  if (err?.code === 11000 || err?.code === 11001) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
    const duplicateValue = err.keyValue?.[field];
    return ApiError.conflict(`A record with this ${field} already exists`, {
      errors: [{ field, message: 'Duplicate value', value: duplicateValue }],
    });
  }

  // Mongoose schema validation -> 400
  if (err instanceof mongoose.Error.ValidationError) {
    const errors = Object.values(err.errors).map((validationError) => ({
      field: validationError.path,
      message: validationError.message,
    }));
    return ApiError.badRequest('Request validation failed', { errors });
  }

  // Invalid ObjectId in a path parameter -> 400
  if (err instanceof mongoose.Error.CastError) {
    const field = err.path || 'parameter';
    const isObjectIdPath = err.kind === 'ObjectId';
    return isObjectIdPath
      ? ApiError.badRequest(`Invalid value for "${field}": must be a valid ObjectId`, {
          errors: [{ field, message: 'Invalid identifier' }],
        })
      : ApiError.badRequest(`Invalid value for "${field}"`, {
          errors: [{ field, message: err.message }],
        });
  }

  // Strict-mode query of an unknown field -> 400
  if (err.name === 'StrictQueryError') {
    return ApiError.badRequest('Query contains an unsupported field', {
      errors: [{ field: err.path || 'query', message: err.message }],
    });
  }

  // Document failed schema validation during save -> 400
  if (err.name === 'MongooseError' && err.message) {
    return ApiError.badRequest('Database validation failed', {
      errors: [{ field: 'document', message: err.message }],
    });
  }

  // JWT errors -> 401
  if (err instanceof jwt.TokenExpiredError) {
    return ApiError.unauthorized('Access token has expired', { code: ERROR_CODES.TOKEN_EXPIRED });
  }
  if (err instanceof jwt.JsonWebTokenError) {
    return ApiError.unauthorized('Invalid authentication token', { code: ERROR_CODES.TOKEN_INVALID });
  }
  if (err instanceof jwt.NotBeforeError) {
    return ApiError.unauthorized('Authentication token is not active yet');
  }

  // express.json body parse errors -> 400
  if (err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Malformed JSON payload');
  }
  if (err.type === 'entity.too.large') {
    return new ApiError('Request payload is too large', {
      status: HTTP_STATUS.BAD_REQUEST,
      code: ERROR_CODES.VALIDATION_ERROR,
    });
  }

  // Body-parser unsupported content type
  if (err.type === 'encoding.unsupported' || err.status === 415) {
    return ApiError.badRequest('Unsupported content type or encoding');
  }

  // CORS / other express errors carrying a status
  if (typeof err.status === 'number' && err.status < 500) {
    return new ApiError(err.message || 'Request rejected', {
      status: err.status,
      code: ERROR_CODES.VALIDATION_ERROR,
    });
  }

  // Fallback: unexpected server error (message hidden in production)
  return new ApiError(err.message || 'Internal server error', {
    status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    code: ERROR_CODES.INTERNAL_ERROR,
    isOperational: false,
  });
}

/**
 * 404 handler for unknown routes.
 */
export function notFoundHandler(req, res) {
  const err = new ApiError(`Route not found: ${req.method} ${req.originalUrl}`, {
    status: HTTP_STATUS.NOT_FOUND,
    code: ERROR_CODES.ROUTE_NOT_FOUND,
  });
  logger.warn({ url: req.originalUrl, method: req.method, requestId: req.id }, 'Route not found');

  return res.status(err.status).json({
    success: false,
    message: 'Route not found',
    code: err.code,
    errors: [],
  });
}

/**
 * Last-resort guard for unhandled promise rejections and uncaught exceptions.
 */
export function registerProcessErrorHandlers() {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'Uncaught exception - shutting down');
    // Give the process a chance to flush logs, then exit.
    setTimeout(() => process.exit(1), 100).unref();
  });
}