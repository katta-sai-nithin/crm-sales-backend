/**
 * Consistent success envelope builders.
 */
export const sendSuccess = (res, { status = 200, message = 'Request completed successfully', data = null, pagination = undefined, meta = undefined } = {}) => {
  const body = { success: true, message, data };
  if (pagination) body.pagination = pagination;
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};

export const sendCreated = (res, { message = 'Resource created successfully', data = null, meta } = {}) =>
  sendSuccess(res, { status: 201, message, data, meta });

export const sendNoContent = (res) => res.status(204).send();

/**
 * Build the standard pagination block.
 */
export const buildPaginationMeta = ({ page, limit, totalRecords }) => ({
  page,
  limit,
  totalRecords,
  totalPages: limit > 0 ? Math.ceil(totalRecords / limit) : 0,
  hasNextPage: page * limit < totalRecords,
  hasPreviousPage: page > 1,
});

export default sendSuccess;