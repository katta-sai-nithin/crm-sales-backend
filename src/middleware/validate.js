import { ApiError } from '../utils/ApiError.js';
import { humanizeZodIssues } from './errorHandler.js';

/**
 * Zod based request validation middleware.
 *
 * Validated values are written back onto the request in their parsed / coerced
 * form, so downstream services always work with trusted, normalised data and can
 * never observe a raw string where a number was expected.
 *
 * @param {import('zod').ZodTypeAny} schema
 * @param {'body'|'query'|'params'} source
 */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  try {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      throw ApiError.badRequest('Request validation failed', {
        errors: humanizeZodIssues(result.error.issues, source),
      });
    }

    if (source === 'query') {
      // Express 5 exposes `req.query` through a getter, so the parsed value is
      // attached to a dedicated property instead of being assigned.
      req.validatedQuery = result.data;
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
      });
    } else if (source === 'params') {
      req.params = result.data;
    } else {
      req.body = result.data;
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Combine several schemas so that a single route can validate several sources.
 */
export const validateAll = (schemas) => (req, _res, next) => {
  try {
    for (const [source, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(req[source] ?? {});
      if (!result.success) {
        throw ApiError.badRequest('Request validation failed', {
          errors: humanizeZodIssues(result.error.issues, source),
        });
      }
      if (source === 'query') {
        req.validatedQuery = result.data;
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          configurable: true,
        });
      } else if (source === 'params') {
        req.params = result.data;
      } else {
        req.body = result.data;
      }
    }
    next();
  } catch (error) {
    next(error);
  }
};

export default validate;