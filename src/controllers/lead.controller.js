import { leadService } from '../services/lead.service.js';
import { convertLead as runConversion } from '../services/conversion.service.js';
import { timelineService } from '../services/timeline.service.js';
import { sendSuccess, sendCreated, sendNoContent } from '../utils/ApiResponse.js';
import { TIMELINE_ENTITY_TYPES } from '../constants/timeline.js';
import { paginationFor, buildPaginationMeta } from './pagination.js';

const context = (req) => ({ ip: req.ip || '' });

/**
 * POST /api/v1/leads
 */
export const createLead = async (req, res) => {
  const lead = await leadService.create(req.body, req.user, context(req));
  return sendCreated(res, { message: 'Lead created successfully', data: lead });
};

/**
 * GET /api/v1/leads
 */
export const listLeads = async (req, res) => {
  const { records, pagination } = await leadService.list(req.query, req.user);
  return sendSuccess(res, { message: 'Leads fetched successfully', data: records, pagination });
};

/**
 * GET /api/v1/leads/:id
 */
export const getLead = async (req, res) => {
  const lead = await leadService.getVisible(req.params.id, req.user);
  return sendSuccess(res, { message: 'Lead fetched successfully', data: lead });
};

/**
 * PATCH /api/v1/leads/:id
 */
export const updateLead = async (req, res) => {
  const lead = await leadService.update(req.params.id, req.body, req.user, context(req));
  return sendSuccess(res, { message: 'Lead updated successfully', data: lead });
};

/**
 * PATCH /api/v1/leads/:id/status
 */
export const updateLeadStatus = async (req, res) => {
  const lead = await leadService.updateStatus(req.params.id, req.body.status, req.user, context(req), {
    reason: req.body.reason,
  });
  return sendSuccess(res, { message: 'Lead status updated successfully', data: lead });
};

/**
 * PATCH /api/v1/leads/:id/assignment
 */
export const assignLead = async (req, res) => {
  const lead = await leadService.assign(req.params.id, req.body.assignedTo, req.user, context(req), {
    reason: req.body.reason,
  });
  return sendSuccess(res, { message: 'Lead assignment updated', data: lead });
};

/**
 * DELETE /api/v1/leads/:id
 */
export const deleteLead = async (req, res) => {
  await leadService.remove(req.params.id, req.user, context(req));
  return sendNoContent(res);
};

/**
 * POST /api/v1/leads/:id/convert
 */
export const convertLeadHandler = async (req, res) => {
  const result = await runConversion(req.params.id, req.body, req.user, context(req));
  return sendCreated(res, {
    message: 'Lead converted successfully',
    data: {
      lead: result.lead,
      customer: result.customer,
      deal: result.deal,
    },
  });
};

/**
 * GET /api/v1/leads/:id/timeline
 */
export const getLeadTimeline = async (req, res) => {
  const lead = await leadService.getVisible(req.params.id, req.user);
  const { page, limit, skip } = paginationFor(req.query);
  const { records, totalRecords } = await timelineService.list({
    entityType: TIMELINE_ENTITY_TYPES.LEAD,
    entityId: lead._id,
    page,
    limit,
    skip,
    action: req.query.action,
    sort: { createdAt: -1, _id: -1 },
  });

  return sendSuccess(res, {
    message: 'Lead timeline fetched successfully',
    data: records,
    pagination: buildPaginationMeta({ page, limit, totalRecords }),
  });
};