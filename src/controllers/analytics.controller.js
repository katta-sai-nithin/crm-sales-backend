import { analyticsService } from '../services/analytics.service.js';
import { sendSuccess } from '../utils/ApiResponse.js';

/**
 * GET /api/v1/analytics/dashboard
 */
export const getDashboard = async (req, res) => {
  const data = await analyticsService.dashboard(req.query, req.user);
  return sendSuccess(res, { message: 'Dashboard metrics fetched successfully', data });
};

/**
 * GET /api/v1/analytics/pipeline
 */
export const getPipeline = async (req, res) => {
  const data = await analyticsService.pipeline(req.query, req.user);
  return sendSuccess(res, { message: 'Pipeline report fetched successfully', data });
};

/**
 * GET /api/v1/analytics/team-performance
 */
export const getTeamPerformance = async (req, res) => {
  const data = await analyticsService.teamPerformance(req.query, req.user);
  return sendSuccess(res, { message: 'Team performance fetched successfully', data });
};

/**
 * GET /api/v1/analytics/lead-sources
 */
export const getLeadSources = async (req, res) => {
  const data = await analyticsService.leadSources(req.query, req.user);
  return sendSuccess(res, { message: 'Lead source report fetched successfully', data });
};