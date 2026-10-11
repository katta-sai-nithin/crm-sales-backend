import { customerService } from '../services/customer.service.js';
import { timelineService } from '../services/timeline.service.js';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/ApiResponse.js';
import { TIMELINE_ENTITY_TYPES } from '../constants/timeline.js';
import { paginationFor, buildPaginationMeta } from './pagination.js';

const context = (req) => ({ ip: req.ip || '' });

/**
 * POST /api/v1/customers
 */
export const createCustomer = async (req, res) => {
  const customer = await customerService.create(req.body, req.user, context(req));
  return sendCreated(res, { message: 'Customer created successfully', data: customer });
};

/**
 * GET /api/v1/customers
 */
export const listCustomers = async (req, res) => {
  const { records, pagination } = await customerService.list(req.query, req.user);
  return sendSuccess(res, { message: 'Customers fetched successfully', data: records, pagination });
};

/**
 * GET /api/v1/customers/:id
 */
export const getCustomer = async (req, res) => {
  const customer = await customerService.getVisible(req.params.id, req.user);
  return sendSuccess(res, { message: 'Customer fetched successfully', data: customer });
};

/**
 * PATCH /api/v1/customers/:id
 */
export const updateCustomer = async (req, res) => {
  const customer = await customerService.update(req.params.id, req.body, req.user, context(req));
  return sendSuccess(res, { message: 'Customer updated successfully', data: customer });
};

/**
 * PATCH /api/v1/customers/:id/assignment
 */
export const assignCustomer = async (req, res) => {
  const customer = await customerService.assign(req.params.id, req.body.assignedTo, req.user, context(req));
  return sendSuccess(res, { message: 'Customer assignment updated', data: customer });
};

/**
 * DELETE /api/v1/customers/:id
 */
export const deleteCustomer = async (req, res) => {
  await customerService.remove(req.params.id, req.user, context(req));
  return sendNoContent(res);
};

/**
 * GET /api/v1/customers/:id/deals
 */
export const getCustomerDeals = async (req, res) => {
  const { records, pagination } = await customerService.listDeals(req.params.id, req.query, req.user);
  return sendSuccess(res, { message: 'Customer deals fetched successfully', data: records, pagination });
};

/**
 * GET /api/v1/customers/:id/activities
 */
export const getCustomerActivities = async (req, res) => {
  const { records, pagination } = await customerService.listActivities(req.params.id, req.query, req.user);
  return sendSuccess(res, { message: 'Customer activities fetched successfully', data: records, pagination });
};

/**
 * GET /api/v1/customers/:id/timeline
 */
export const getCustomerTimeline = async (req, res) => {
  const customer = await customerService.getVisible(req.params.id, req.user);
  const { page, limit, skip } = paginationFor(req.query);
  const { records, totalRecords } = await timelineService.list({
    entityType: TIMELINE_ENTITY_TYPES.CUSTOMER,
    entityId: customer._id,
    page,
    limit,
    skip,
    action: req.query.action,
    sort: { createdAt: -1, _id: -1 },
  });

  return sendSuccess(res, {
    message: 'Customer timeline fetched successfully',
    data: records,
    pagination: buildPaginationMeta({ page, limit, totalRecords }),
  });
};