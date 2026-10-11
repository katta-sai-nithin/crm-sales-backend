import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { healthCheck } from '../controllers/health.controller.js';

const router = Router();

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [System]
 *     operationId: getHealth
 *     summary: Liveness and database connectivity probe
 *     security: []
 *     responses:
 *       200:
 *         description: Service healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 message: { type: string }
 *                 data:
 *                   type: object
 *                   properties:
 *                     status: { type: string, example: ok }
 *                     service: { type: string }
 *                     version: { type: string }
 *                     environment: { type: string }
 *                     uptimeSeconds: { type: integer }
 *                     database:
 *                       type: object
 *                       properties:
 *                         connected: { type: boolean }
 *                         state: { type: string }
 *                         transactionsSupported: { type: boolean }
 *                     responseTimeMs: { type: integer }
 *                     timestamp: { type: string, format: date-time }
 *       503:
 *         description: Database not connected
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: false }
 *                 message: { type: string }
 */
router.get('/', asyncHandler(healthCheck));

export default router;