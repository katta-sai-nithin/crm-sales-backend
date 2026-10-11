import { buildPaginationMeta } from '../utils/ApiResponse.js';

/**
 * Shared pagination helper for controllers.
 */
export function paginationFor(query = {}) {
  const page = Number(query.page) || 1;
  const limit = Number(query.limit) || 10;
  return { page, limit, skip: (page - 1) * limit };
}

export { buildPaginationMeta };