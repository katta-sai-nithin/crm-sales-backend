import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../constants/roles.js';
import { analyticsQuery } from '../validators/deal.validator.js';
import {
  getDashboard,
  getPipeline,
  getTeamPerformance,
  getLeadSources,
} from '../controllers/analytics.controller.js';

const router = Router();

router.use(asyncHandler(authenticate));

/**
 * @openapi
 * /analytics/dashboard:
 *   get:
 *     tags: [Analytics]
 *     operationId: getDashboard
 *     summary: Dashboard metrics for the caller's scope
 *     description: |
 *       Scope by role:
 *        * ADMIN - the whole system
 *        * SALES_MANAGER - their own book plus their team
 *        * SALES_EXECUTIVE - only their own records
 *       Lead conversion rate is defined as `converted leads / eligible leads`,
 *       where an eligible lead is one that reached at least the QUALIFIED stage
 *       (currently QUALIFIED, CONVERTED, UNQUALIFIED or LOST). A zero denominator
 *       yields 0.
 *       `wonRevenue` is actual revenue from WON deals; `openExpectedRevenue` is the
 *       probability weighted forecast of open deals - the two are never mixed.
 *     parameters:
 *       - $ref: '#/components/parameters/DateFromParam'
 *       - $ref: '#/components/parameters/DateToParam'
 *     responses:
 *       200:
 *         description: Dashboard metrics
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Dashboard' }
 *       401:
 *         description: Unauthenticated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/dashboard', validate(analyticsQuery, 'query'), asyncHandler(getDashboard));

/**
 * @openapi
 * /analytics/pipeline:
 *   get:
 *     tags: [Analytics]
 *     operationId: getPipeline
 *     summary: Deal count and value grouped by pipeline stage
 *     responses:
 *       200:
 *         description: Pipeline report
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Pipeline' }
 */
router.get('/pipeline', validate(analyticsQuery, 'query'), asyncHandler(getPipeline));

/**
 * @openapi
 * /analytics/team-performance:
 *   get:
 *     tags: [Analytics]
 *     operationId: getTeamPerformance
 *     summary: Per-user sales performance (ADMIN, SALES_MANAGER)
 *     description: |
 *       Administrators may restrict the report to a single team with `?team=<id>`.
 *       Sales Managers always see only their own team. Sales Executives receive 403.
 *     parameters:
 *       - $ref: '#/components/parameters/DateFromParam'
 *       - $ref: '#/components/parameters/DateToParam'
 *       - in: query
 *         name: team
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Team performance report
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/TeamPerformance' }
 *       403:
 *         description: Sales Executives are not allowed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get(
  '/team-performance',
  authorize(ROLES.ADMIN, ROLES.SALES_MANAGER),
  validate(analyticsQuery, 'query'),
  asyncHandler(getTeamPerformance)
);

/**
 * @openapi
 * /analytics/lead-sources:
 *   get:
 *     tags: [Analytics]
 *     operationId: getLeadSources
 *     summary: Lead volume and conversion grouped by source
 *     responses:
 *       200:
 *         description: Lead source report
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           source: { type: string }
 *                           total: { type: integer }
 *                           qualified: { type: integer }
 *                           converted: { type: integer }
 *                           conversionRate: { type: number }
 */
router.get('/lead-sources', validate(analyticsQuery, 'query'), asyncHandler(getLeadSources));

export default router;