import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../constants/roles.js';
import { idParamSchema } from '../validators/common.validator.js';
import {
  createLeadSchema,
  updateLeadSchema,
  updateLeadStatusSchema,
  assignLeadSchema,
  listLeadsQuery,
  convertLeadSchema,
} from '../validators/crm.validator.js';
import {
  createLead,
  listLeads,
  getLead,
  updateLead,
  updateLeadStatus,
  assignLead,
  deleteLead,
  convertLeadHandler,
  getLeadTimeline,
} from '../controllers/lead.controller.js';

const router = Router();

router.use(asyncHandler(authenticate));

/**
 * @openapi
 * /leads:
 *   post:
 *     tags: [Leads]
 *     operationId: createLead
 *     summary: Create a lead
 *     description: |
 *       Sales Executives are auto-assigned to the lead they create. Managers own
 *       what they capture by default and may assign within their team. Admins may
 *       assign to any active sales user or leave the lead unassigned.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email]
 *             properties:
 *               name: { type: string, example: 'Acme Corp' }
 *               email: { type: string, format: email, example: 'buyer@acme.com' }
 *               phone: { type: string, example: '+1 555 0100' }
 *               company: { type: string, example: 'Acme Corp' }
 *               source: { $ref: '#/components/schemas/LeadSource' }
 *               priority: { $ref: '#/components/schemas/LeadPriority' }
 *               assignedTo: { type: string, nullable: true }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Lead created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Lead' }
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Not allowed to assign to the requested user
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Invalid assignee (inactive user or wrong role)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   get:
 *     tags: [Leads]
 *     operationId: listLeads
 *     summary: List leads with search, filters, sorting and pagination
 *     description: |
 *       Visibility is role scoped:
 *        * ADMIN - all leads
 *        * SALES_MANAGER - leads assigned to the manager or their team
 *        * SALES_EXECUTIVE - leads assigned to the executive
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/DateFromParam'
 *       - $ref: '#/components/parameters/DateToParam'
 *       - in: query
 *         name: status
 *         description: Comma separated lead statuses
 *         schema: { type: string, example: 'NEW,CONTACTED' }
 *       - in: query
 *         name: priority
 *         schema: { type: string, example: 'HIGH' }
 *       - in: query
 *         name: source
 *         schema: { type: string, example: 'WEBSITE' }
 *       - in: query
 *         name: assignedTo
 *         schema: { type: string }
 *       - in: query
 *         name: createdBy
 *         schema: { type: string }
 *       - in: query
 *         name: unassigned
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: Paginated leads
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedLeads' }
 *       400:
 *         description: Invalid filter
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/', authorize(ROLES.ADMIN, ROLES.SALES_MANAGER, ROLES.SALES_EXECUTIVE), validate(createLeadSchema, 'body'), asyncHandler(createLead));

router.get('/', validate(listLeadsQuery, 'query'), asyncHandler(listLeads));

/**
 * @openapi
 * /leads/{id}:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   get:
 *     tags: [Leads]
 *     operationId: getLeadById
 *     summary: Get a lead
 *     responses:
 *       200:
 *         description: Lead
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Lead' }
 *       404:
 *         description: Lead not found or not visible to the caller
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   patch:
 *     tags: [Leads]
 *     operationId: updateLead
 *     summary: Update lead fields
 *     description: |
 *       Only contact / descriptive fields can be updated. `status`, `assignedTo`,
 *       `createdBy` and `convertedCustomer` are server controlled and can only be
 *       changed through their dedicated endpoints.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               company: { type: string }
 *               source: { $ref: '#/components/schemas/LeadSource' }
 *               priority: { $ref: '#/components/schemas/LeadPriority' }
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Lead updated
 *       400:
 *         description: Validation error or unknown field
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Converted leads cannot be edited
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     tags: [Leads]
 *     operationId: deleteLead
 *     summary: Delete a lead (ADMIN, SALES_MANAGER)
 *     description: Sales Executives may not delete leads; converted leads may never be deleted.
 *     responses:
 *       204:
 *         description: Lead deleted
 *       403:
 *         description: Not permitted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Converted lead cannot be deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/:id', validate(idParamSchema, 'params'), asyncHandler(getLead));

router.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateLeadSchema, 'body'),
  asyncHandler(updateLead)
);

router.delete(
  '/:id',
  authorize(ROLES.ADMIN, ROLES.SALES_MANAGER),
  validate(idParamSchema, 'params'),
  asyncHandler(deleteLead)
);

/**
 * @openapi
 * /leads/{id}/status:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   patch:
 *     tags: [Leads]
 *     operationId: updateLeadStatus
 *     summary: Change the status of a lead
 *     description: |
 *       Allowed transitions:
 *        * NEW -> CONTACTED | QUALIFIED | UNQUALIFIED | LOST
 *        * CONTACTED -> QUALIFIED | UNQUALIFIED | LOST
 *        * QUALIFIED -> CONVERTED (conversion endpoint only) | LOST
 *        * UNQUALIFIED -> CONTACTED | QUALIFIED | LOST
 *        * LOST -> CONTACTED | QUALIFIED
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { $ref: '#/components/schemas/LeadStatus' }
 *               reason: { type: string }
 *     responses:
 *       200:
 *         description: Status updated
 *       422:
 *         description: Invalid status transition
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch(
  '/:id/status',
  validate(idParamSchema, 'params'),
  validate(updateLeadStatusSchema, 'body'),
  asyncHandler(updateLeadStatus)
);

/**
 * @openapi
 * /leads/{id}/assignment:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   patch:
 *     tags: [Leads]
 *     operationId: assignLead
 *     summary: Assign or reassign a lead
 *     description: |
 *       * ADMIN - any active SALES_MANAGER / SALES_EXECUTIVE
 *       * SALES_MANAGER - themselves or a member of their own team
 *       * SALES_EXECUTIVE - themselves only; never another user
 *       Send `assignedTo: null` to unassign (ADMIN / manager only).
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
 *         description: Assignment updated (recorded on the timeline)
 *       403:
 *         description: Assignment outside your authority
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Assignee inactive, wrong role, or already assigned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch(
  '/:id/assignment',
  validate(idParamSchema, 'params'),
  validate(assignLeadSchema, 'body'),
  asyncHandler(assignLead)
);

/**
 * @openapi
 * /leads/{id}/convert:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   post:
 *     tags: [Leads]
 *     operationId: convertLead
 *     summary: Convert a QUALIFIED lead into a Customer and an initial Deal
 *     description: |
 *       The whole operation runs inside a MongoDB transaction (the deployment must
 *       be a replica set or a sharded cluster - otherwise the endpoint returns
 *       503). Concurrency is controlled by a conditional atomic update on the
 *       lead plus a unique index on `customers.originalLead`, so a lead can never
 *       be converted twice even under parallel requests.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [dealName, dealValue, probability, expectedClosingDate]
 *             properties:
 *               dealName: { type: string, example: 'Acme - Annual Platform Licence' }
 *               dealValue: { type: number, example: 25000 }
 *               probability: { type: integer, minimum: 0, maximum: 100, example: 60 }
 *               expectedClosingDate: { type: string, format: date-time }
 *               stage: { $ref: '#/components/schemas/DealStage' }
 *               description: { type: string }
 *               assignedTo: { type: string }
 *     responses:
 *       201:
 *         description: Conversion succeeded
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         lead: { $ref: '#/components/schemas/Lead' }
 *                         customer: { $ref: '#/components/schemas/Customer' }
 *                         deal: { $ref: '#/components/schemas/Deal' }
 *       409:
 *         description: Lead already converted (possibly by a concurrent request)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Lead is not QUALIFIED
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       503:
 *         description: Transactions are not supported by this MongoDB deployment
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/:id/convert',
  validate(idParamSchema, 'params'),
  validate(convertLeadSchema, 'body'),
  asyncHandler(convertLeadHandler)
);

/**
 * @openapi
 * /leads/{id}/timeline:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   get:
 *     tags: [Timeline]
 *     operationId: getLeadTimeline
 *     summary: Audit history of a lead
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *     responses:
 *       200:
 *         description: Timeline entries (append-only)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedTimeline' }
 *       404:
 *         description: Lead not found or not visible
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/:id/timeline', validate(idParamSchema, 'params'), asyncHandler(getLeadTimeline));

export default router;