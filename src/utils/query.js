import { PAGINATION } from '../constants/pagination.js';
import { ApiError } from './ApiError.js';
import { buildSearchRegex } from './sanitize.js';
import { toObjectId } from './objectId.js';
import { buildPaginationMeta } from './ApiResponse.js';

/**
 * Reusable query-string helpers shared by every list endpoint.
 *
 * Design rules enforced here:
 *  - Only allow-listed sort fields are accepted (no arbitrary Mongo paths).
 *  - Only allow-listed filter fields are mapped to Mongo paths.
 *  - ObjectId-typed filters are cast explicitly, invalid values are rejected.
 *  - Date ranges are validated and normalised.
 *  - Search keywords are escaped before being turned into a RegExp.
 */

/**
 * Parse and clamp pagination parameters.
 */
export function parsePagination(query = {}) {
  const rawPage = query.page ?? query.pageNumber;
  const rawLimit = query.limit ?? query.pageSize;

  let page = PAGINATION.DEFAULT_PAGE;
  if (rawPage !== undefined && rawPage !== '') {
    const parsed = Number(rawPage);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw ApiError.badRequest('Query parameter "page" must be an integer greater than or equal to 1', {
        errors: [{ field: 'page', message: 'Invalid page number' }],
      });
    }
    page = parsed;
  }

  let limit = PAGINATION.DEFAULT_LIMIT;
  if (rawLimit !== undefined && rawLimit !== '') {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw ApiError.badRequest('Query parameter "limit" must be an integer greater than or equal to 1', {
        errors: [{ field: 'limit', message: 'Invalid page size' }],
      });
    }
    if (parsed > PAGINATION.MAX_LIMIT) {
      throw ApiError.badRequest(`Query parameter "limit" must not exceed ${PAGINATION.MAX_LIMIT}`, {
        errors: [{ field: 'limit', message: `Maximum page size is ${PAGINATION.MAX_LIMIT}` }],
      });
    }
    limit = parsed;
  }

  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/**
 * Validate the requested sort field against an allowlist.
 */
export function parseSort(query = {}, { allowedFields = [], defaultField = 'createdAt', defaultOrder = 'desc' } = {}) {
  const sortBy = query.sortBy ? String(query.sortBy) : defaultField;
  const rawOrder = query.sortOrder ? String(query.sortOrder).toLowerCase() : defaultOrder;

  if (!PAGINATION.SORT_ORDERS.includes(rawOrder)) {
    throw ApiError.badRequest(`Query parameter "sortOrder" must be one of: ${PAGINATION.SORT_ORDERS.join(', ')}`, {
      errors: [{ field: 'sortOrder', message: 'Invalid sort order' }],
    });
  }

  if (!allowedFields.includes(sortBy)) {
    throw ApiError.badRequest(`Query parameter "sortBy" must be one of: ${allowedFields.join(', ')}`, {
      errors: [{ field: 'sortBy', message: 'Unsupported sort field' }],
    });
  }

  const direction = rawOrder === 'asc' ? 1 : -1;
  return { [sortBy]: direction, _id: -1 };
}

/**
 * Parse an ISO date string (or epoch millis) into a Date.
 */
export function parseDate(value, fieldName) {
  if (value === undefined || value === null || value === '') return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest(`Query parameter "${fieldName}" must be a valid ISO date`, {
      errors: [{ field: fieldName, message: 'Invalid date' }],
    });
  }
  return date;
}

/**
 * Build a `{ $gte, $lte }` range clause from `dateFrom` / `dateTo`.
 */
export function parseDateRange(query = {}, { fromField = 'dateFrom', toField = 'dateTo' } = {}) {
  const from = parseDate(query[fromField], fromField);
  const to = parseDate(query[toField], toField);
  if (!from && !to) return null;
  if (from && to && from > to) {
    throw ApiError.badRequest(`Query parameter "${fromField}" must be earlier than or equal to "${toField}"`, {
      errors: [{ field: fromField, message: 'Invalid date range' }],
    });
  }
  const range = {};
  if (from) range.$gte = from;
  if (to) range.$lte = to;
  return range;
}

/**
 * Validate a query value against a list of allowed enum values.
 * Accepts comma separated values for multi-select filters.
 */
export function parseEnum(value, allowedValues, fieldName, { multi = false } = {}) {
  if (value === undefined || value === null || value === '') return undefined;
  const rawValues = multi
    ? String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [String(value).trim()];

  const invalid = rawValues.filter((item) => !allowedValues.includes(item));
  if (invalid.length) {
    throw ApiError.badRequest(
      `Query parameter "${fieldName}" contains unsupported value(s): ${invalid.join(', ')}. Allowed: ${allowedValues.join(', ')}`,
      { errors: [{ field: fieldName, message: 'Invalid filter value' }] }
    );
  }
  return multi ? rawValues : rawValues[0];
}

/**
 * Cast a query parameter into an ObjectId.
 */
export function parseObjectIdParam(query = {}, fieldName) {
  const value = query[fieldName];
  if (value === undefined || value === null || value === '') return undefined;
  const objectId = toObjectId(String(value));
  if (!objectId) {
    throw ApiError.badRequest(`Query parameter "${fieldName}" must be a valid MongoDB ObjectId`, {
      errors: [{ field: fieldName, message: 'Invalid identifier' }],
    });
  }
  return objectId;
}

/**
 * Parse a numeric query parameter with optional min/max bounds.
 */
export function parseNumberParam(query = {}, fieldName, { min, max, integer = false } = {}) {
  const value = query[fieldName];
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw ApiError.badRequest(`Query parameter "${fieldName}" must be a number`, {
      errors: [{ field: fieldName, message: 'Invalid number' }],
    });
  }
  if (integer && !Number.isInteger(parsed)) {
    throw ApiError.badRequest(`Query parameter "${fieldName}" must be an integer`, {
      errors: [{ field: fieldName, message: 'Invalid number' }],
    });
  }
  if (min !== undefined && parsed < min) {
    throw ApiError.badRequest(`Query parameter "${fieldName}" must be greater than or equal to ${min}`, {
      errors: [{ field: fieldName, message: `Minimum value is ${min}` }],
    });
  }
  if (max !== undefined && parsed > max) {
    throw ApiError.badRequest(`Query parameter "${fieldName}" must be less than or equal to ${max}`, {
      errors: [{ field: fieldName, message: `Maximum value is ${max}` }],
    });
  }
  return parsed;
}

/**
 * Parse a boolean query parameter.
 */
export function parseBooleanParam(query = {}, fieldName) {
  const value = query[fieldName];
  if (value === undefined || value === null || value === '') return undefined;
  const normalized = String(value).toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw ApiError.badRequest(`Query parameter "${fieldName}" must be a boolean`, {
    errors: [{ field: fieldName, message: 'Invalid boolean' }],
  });
}

/**
 * Parse the shared `search` parameter into a safe RegExp.
 */
export function parseSearch(query = {}) {
  const keyword = query.search ?? query.q ?? query.keyword;
  if (keyword === undefined || keyword === null || String(keyword).trim() === '') return { keyword: undefined, regex: null };
  const regex = buildSearchRegex(String(keyword));
  return { keyword: String(keyword).trim().slice(0, 120), regex };
}

/**
 * Combine a list of Mongo filter fragments into a single filter object,
 * skipping null / undefined fragments.
 */
export function mergeFilters(...filters) {
  const merged = {};
  for (const filter of filters) {
    if (!filter || typeof filter !== 'object') continue;
    for (const [key, value] of Object.entries(filter)) {
      if (value === undefined) continue;
      merged[key] = value;
    }
  }
  return merged;
}

/**
 * Combine multiple `$or` fragments produced by different features (e.g. the
 * resource visibility scope and a keyword search) using `$and`.
 */
export function andFilters(...filters) {
  const valid = filters.filter((f) => f && typeof f === 'object' && Object.keys(f).length > 0);
  if (valid.length === 0) return {};
  if (valid.length === 1) return valid[0];
  return { $and: valid };
}

/**
 * Execute a paginated find on a model and return `{ records, pagination }`.
 */
export async function executePaginatedQuery(model, { filter = {}, sort = { createdAt: -1 }, page, limit, skip, projection, populate }) {
  const query = model.find(filter);
  if (projection) query.select(projection);
  if (populate) {
    for (const populateOptions of populate) {
      query.populate(populateOptions);
    }
  }

  const [records, totalRecords] = await Promise.all([
    query.sort(sort).skip(skip).limit(limit).lean(),
    model.countDocuments(filter),
  ]);

  return { records, pagination: buildPaginationMeta({ page, limit, totalRecords }) };
}