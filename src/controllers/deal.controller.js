import { dealService } from '../services/deal.service.js';
import { timelineService } from '../services/timeline.service.js';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/ApiResponse.js';
import { TIMELINE_ENTITY_TYPES } from '../constants/timeline.js';
import { paginationFor, buildPaginationMeta } from './pagination.js';

const context = (req) => ({ ip: req.ip || '' });

/**
 * POST /api/v1/deals
 */
export const createDeal = async (req, res) => {
  const deal = await dealService.create(req.body, req.user, context(req));
  return sendCreated(res, { message: 'Deal created successfully', data: deal });
};

/**
 * GET /api/v1/deals
 */
export const listDeals = async (req, res) => {
  const { records, pagination } = await dealService.list(req.query, req.user);
  return sendSuccess(res, { message: 'Deals fetched successfully', data: records, pagination });
};

/**
 * GET /api/v1/deals/:id
 */
export const getDeal = async (req, res) => {
  const deal = await dealService.getVisible(req.params.id, req.user);
  return sendSuccess(res, { message: 'Deal fetched successfully', data: deal });
};

/**
 * PATCH /api/v1/deals/:id
 */
export const updateDeal = async (req, res) => {
  const deal = await dealService.update(req.params.id, req.body, req.user, context(req));
  return sendSuccess(res, { message: 'Deal updated successfully', data: deal });
};

/**
 * PATCH /api/v1/deals/:id/stage
 */
export const updateDealStage = async (req, res) => {
  const deal = await dealService.updateStage(req.params.id, req.body, req.user, context(req));
  return sendSuccess(res, { message: 'Deal stage updated successfully', data: deal });
};

/**
 * POST /api/v1/deals/:id/reopen
 */
export const reopenDeal = async (req, res) => {
  const deal = await dealService.reopen(req.params.id, req.body, req.user, context(req));
  return sendSuccess(res, { message: 'Deal reopened successfully', data: deal });
};

/**
 * PATCH /api/v1/deals/:id/assignment
 */
export const assignDeal = async (req, res) => {
  const deal = await dealService.assign(req.params.id, req.body.assignedTo, req.user, context(req), {
    reason: req.body.reason,
  });
  return sendSuccess(res, { message: 'Deal assignment updated', data: deal });
};

/**
 * DELETE /api/v1/deals/:id
 */
export const deleteDeal = async (req, res) => {
  await dealService.remove(req.params.id, req.user, context(req));
  return sendNoContent(res);
};

/**
 * GET /api/v1/deals/:id/activities
 */
export const getDealActivities = async (req, res) => {
  const { records, pagination } = await dealService.listActivities(req.params.id, req.query, req.user);
  return sendSuccess(res, { message: 'Deal activities fetched successfully', data: records, pagination });
};

/**
 * GET /api/v1/deals/:id/timeline
 */
export const getDealTimeline = async (req, res) => {
  const deal = await dealService.getVisible(req.params.id, req.user);
  const { page, limit, skip } = paginationFor(req.query);
  const { records, totalRecords } = await timelineService.list({
    entityType: TIMELINE_ENTITY_TYPES.DEAL,
    entityId: deal._id,
    page,
    limit,
    skip,
    action: req.query.action,
    sort: { createdAt: -1, _id: -1 },
  });

  return sendSuccess(res, {
    message: 'Deal timeline fetched successfully',
    data: records,
    pagination: buildPaginationMeta({ page, limit, totalRecords }),
  });
};