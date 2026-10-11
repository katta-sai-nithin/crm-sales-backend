import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../constants/roles.js';
import { idParamSchema, paginationQuery } from '../validators/common.validator.js';
import {
  createDealSchema,
  updateDealSchema,
  updateDealStageSchema,
  assignDealSchema,
  reopenDealSchema,
  listDealsQuery,
  listActivitiesQuery,
} from '../validators/deal.validator.js';
import {
  createDeal,
  listDeals,
  getDeal,
  updateDeal,
  updateDealStage,
  reopenDeal,
  assignDeal,
  deleteDeal,
  getDealActivities,
  getDealTimeline,
} from '../controllers/deal.controller.js';

const router = Router();

router.use(asyncHandler(authenticate));

/**
 * @openapi
 * /deals:
 *   post:
 *     tags: [Deals]
 *     operationId: createDeal
 *     summary: Create a deal
 *     description: |
 *       `expectedRevenue` is always computed on the server as
 *       `dealValue * probability / 100` (rounded to 2 decimals) and can never be
 *       supplied by the client. An active deal must have a future closing date.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, customer, dealValue, probability, expectedClosingDate]
 *             properties:
 *               name: { type: string, example: 'Acme - Platform Licence' }
 *               customer: { type: string }
 *               assignedTo: { type: string }
 *               dealValue: { type: number, example: 25000 }
 *               probability: { type: integer, minimum: 0, maximum: 100, example: 60 }
 *               expectedClosingDate: { type: string, format: date-time }
 *               stage: { $ref: '#/components/schemas/DealStage' }
 *               description: { type: string }
 *               lostReason: { type: string }
 *     responses:
 *       201:
 *         description: Deal created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Deal' }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Business rule violation (e.g. past closing date)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   get:
 *     tags: [Deals]
 *     operationId: listDeals
 *     summary: List deals with filters and pagination
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/DateFromParam'
 *       - $ref: '#/components/parameters/DateToParam'
 *       - in: query
 *         name: stage
 *         schema: { type: string, example: 'NEGOTIATION,WON' }
 *       - in: query
 *         name: assignedTo
 *         schema: { type: string }
 *       - in: query
 *         name: customer
 *         schema: { type: string }
 *       - in: query
 *         name: lead
 *         schema: { type: string }
 *       - in: query
 *         name: minValue
 *         schema: { type: number }
 *       - in: query
 *         name: maxValue
 *         schema: { type: number }
 *       - in: query
 *         name: closingFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: closingTo
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Paginated deals
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedDeals' }
 */
router.post('/', validate(createDealSchema, 'body'), asyncHandler(createDeal));

router.get('/', validate(listDealsQuery, 'query'), asyncHandler(listDeals));

/**
 * @openapi
 * /deals/{id}:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   get:
 *     tags: [Deals]
 *     operationId: getDealById
 *     summary: Get a deal
 *     responses:
 *       200:
 *         description: Deal
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Deal' }
 *       404:
 *         description: Deal not found or not visible
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   patch:
 *     tags: [Deals]
 *     operationId: updateDeal
 *     summary: Update commercial fields of an open deal
 *     description: |
 *       Only `name`, `description`, `dealValue`, `probability` and
 *       `expectedClosingDate` can be updated. Server controlled fields
 *       (`createdBy`, `expectedRevenue`, `closedAt`, `stage`, `customer`, `lead`)
 *       are rejected by the schema.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               dealValue: { type: number }
 *               probability: { type: integer, minimum: 0, maximum: 100 }
 *               expectedClosingDate: { type: string, format: date-time }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Deal updated
 *       400:
 *         description: Validation error or attempt to set a server controlled field
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Closed deals cannot be updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     tags: [Deals]
 *     operationId: deleteDeal
 *     summary: Delete a deal (ADMIN, SALES_MANAGER)
 *     responses:
 *       204:
 *         description: Deal deleted
 *       403:
 *         description: Not permitted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Deal still has activities
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/:id', validate(idParamSchema, 'params'), asyncHandler(getDeal));

router.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateDealSchema, 'body'),
  asyncHandler(updateDeal)
);

router.delete(
  '/:id',
  authorize(ROLES.ADMIN, ROLES.SALES_MANAGER),
  validate(idParamSchema, 'params'),
  asyncHandler(deleteDeal)
);

/**
 * @openapi
 * /deals/{id}/stage:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   patch:
 *     tags: [Deals]
 *     operationId: updateDealStage
 *     summary: Move a deal to another stage
 *     description: |
 *       Allowed transitions:
 *        * QUALIFICATION -> DISCOVERY | PROPOSAL | WON | LOST
 *        * DISCOVERY -> PROPOSAL | NEGOTIATION | WON | LOST
 *        * PROPOSAL -> NEGOTIATION | WON | LOST
 *        * NEGOTIATION -> WON | LOST
 *        * WON / LOST -> terminal, use `POST /deals/{id}/reopen`
 *       `lostReason` is required for LOST. Moving to WON normalises the
 *       probability to 100 and sets `closedAt`.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stage]
 *             properties:
 *               stage: { $ref: '#/components/schemas/DealStage' }
 *               lostReason: { type: string }
 *               expectedClosingDate: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Stage updated
 *       422:
 *         description: Invalid transition or missing lostReason
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch(
  '/:id/stage',
  validate(idParamSchema, 'params'),
  validate(updateDealStageSchema, 'body'),
  asyncHandler(updateDealStage)
);

/**
 * @openapi
 * /deals/{id}/reopen:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   post:
 *     tags: [Deals]
 *     operationId: reopenDeal
 *     summary: Reopen a closed deal (ADMIN, SALES_MANAGER)
 *     description: |
 *       Explicit business operation to move a WON or LOST deal back into the open
 *       pipeline. Requires a reason, clears `closedAt` and `lostReason` and records
 *       a `DEAL_REOPENED` audit entry.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stage, reason]
 *             properties:
 *               stage: { type: string, enum: [QUALIFICATION, DISCOVERY, PROPOSAL, NEGOTIATION] }
 *               reason: { type: string, minLength: 3 }
 *     responses:
 *       200:
 *         description: Deal reopened
 *       403:
 *         description: Not permitted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Deal is not closed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/:id/reopen',
  authorize(ROLES.ADMIN, ROLES.SALES_MANAGER),
  validate(idParamSchema, 'params'),
  validate(reopenDealSchema, 'body'),
  asyncHandler(reopenDeal)
);

/**
 * @openapi
 * /deals/{id}/assignment:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   patch:
 *     tags: [Deals]
 *     operationId: assignDeal
 *     summary: Assign or reassign a deal
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [assignedTo]
 *             properties:
 *               assignedTo: { type: string, nullable: true }
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Assignment updated
 *       403:
 *         description: Not permitted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch(
  '/:id/assignment',
  validate(idParamSchema, 'params'),
  validate(assignDealSchema, 'body'),
  asyncHandler(assignDeal)
);

/**
 * @openapi
 * /deals/{id}/activities:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   get:
 *     tags: [Activities]
 *     operationId: getDealActivities
 *     summary: Activities related to a deal
 *     responses:
 *       200:
 *         description: Paginated activities
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedActivities' }
 *       404:
 *         description: Deal not found or not visible
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get(
  '/:id/activities',
  validate(idParamSchema, 'params'),
  validate(listActivitiesQuery, 'query'),
  asyncHandler(getDealActivities)
);

/**
 * @openapi
 * /deals/{id}/timeline:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   get:
 *     tags: [Timeline]
 *     operationId: getDealTimeline
 *     summary: Audit history of a deal
 *     responses:
 *       200:
 *         description: Timeline entries
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedTimeline' }
 */
router.get('/:id/timeline', validate(idParamSchema, 'params'), validate(paginationQuery, 'query'), asyncHandler(getDealTimeline));

export default router;