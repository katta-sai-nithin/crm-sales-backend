import { activityService } from '../services/activity.service.js';
import { timelineService } from '../services/timeline.service.js';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/ApiResponse.js';
import { TIMELINE_ENTITY_TYPES } from '../constants/timeline.js';
import { paginationFor, buildPaginationMeta } from './pagination.js';
import { leadService } from '../services/lead.service.js';
import { customerService } from '../services/customer.service.js';
import { dealService } from '../services/deal.service.js';
import { ApiError } from '../utils/ApiError.js';

const context = (req) => ({ ip: req.ip || '' });

/**
 * POST /api/v1/activities
 */
export const createActivity = async (req, res) => {
  const activity = await activityService.create(req.body, req.user, context(req));
  return sendCreated(res, { message: 'Activity created successfully', data: activity });
};

/**
 * GET /api/v1/activities
 */
export const listActivities = async (req, res) => {
  const { records, pagination } = await activityService.list(req.query, req.user);
  return sendSuccess(res, { message: 'Activities fetched successfully', data: records, pagination });
};

/**
 * GET /api/v1/activities/:id
 */
export const getActivity = async (req, res) => {
  const activity = await activityService.getVisible(req.params.id, req.user);
  return sendSuccess(res, { message: 'Activity fetched successfully', data: activity });
};

/**
 * PATCH /api/v1/activities/:id
 */
export const updateActivity = async (req, res) => {
  const activity = await activityService.update(req.params.id, req.body, req.user, context(req));
  return sendSuccess(res, { message: 'Activity updated successfully', data: activity });
};

/**
 * PATCH /api/v1/activities/:id/complete
 */
export const completeActivity = async (req, res) => {
  const activity = await activityService.complete(req.params.id, req.user, context(req));
  return sendSuccess(res, { message: 'Activity completed successfully', data: activity });
};

/**
 * DELETE /api/v1/activities/:id
 */
export const deleteActivity = async (req, res) => {
  await activityService.remove(req.params.id, req.user, context(req));
  return sendNoContent(res);
};

/**
 * GET /api/v1/timeline/:entityType/:entityId
 *
 * The entity must exist AND be visible to the caller, otherwise a 404 is
 * returned so that the endpoint cannot be used to probe for record existence.
 */
export const getEntityTimeline = async (req, res) => {
  const { entityType, entityId } = req.params;

  switch (entityType) {
    case TIMELINE_ENTITY_TYPES.LEAD:
      await leadService.getVisible(entityId, req.user);
      break;
    case TIMELINE_ENTITY_TYPES.CUSTOMER:
      await customerService.getVisible(entityId, req.user);
      break;
    case TIMELINE_ENTITY_TYPES.DEAL:
      await dealService.getVisible(entityId, req.user);
      break;
    case TIMELINE_ENTITY_TYPES.ACTIVITY:
      await activityService.getVisible(entityId, req.user);
      break;
    case TIMELINE_ENTITY_TYPES.USER: {
      if (!['ADMIN', 'SALES_MANAGER'].includes(req.user.role)) {
        throw ApiError.forbidden('Only administrators and sales managers can read a user timeline');
      }
      break;
    }
    default:
      throw ApiError.badRequest(`Unsupported entity type: ${entityType}`);
  }

  const { page, limit, skip } = paginationFor(req.query);
  const { records, totalRecords } = await timelineService.list({
    entityType,
    entityId,
    page,
    limit,
    skip,
    action: req.query.action,
    sort: { createdAt: -1, _id: -1 },
  });

  return sendSuccess(res, {
    message: 'Timeline fetched successfully',
    data: records,
    pagination: buildPaginationMeta({ page, limit, totalRecords }),
  });
};