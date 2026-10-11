import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../constants/roles.js';
import { idParamSchema } from '../validators/common.validator.js';
import {
  createCustomerSchema,
  updateCustomerSchema,
  listCustomersQuery,
  assignCustomerSchema,
} from '../validators/crm.validator.js';
import {
  createCustomer,
  listCustomers,
  getCustomer,
  updateCustomer,
  deleteCustomer,
  assignCustomer,
  getCustomerDeals,
  getCustomerActivities,
  getCustomerTimeline,
} from '../controllers/customer.controller.js';
import { listDealsQuery, listActivitiesQuery } from '../validators/deal.validator.js';

const router = Router();

router.use(asyncHandler(authenticate));

/**
 * @openapi
 * /customers:
 *   post:
 *     tags: [Customers]
 *     operationId: createCustomer
 *     summary: Create a customer manually (ADMIN, SALES_MANAGER)
 *     description: |
 *       A manually created customer has `origin = MANUAL` and no `originalLead`.
 *       A customer produced by lead conversion has `origin = CONVERTED` and always
 *       references its source lead. Sales Executives cannot create customers
 *       directly - they must convert a qualified lead.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email]
 *             properties:
 *               name: { type: string }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               company: { type: string }
 *               address: { type: string }
 *               assignedTo: { type: string, nullable: true }
 *               status: { type: string, enum: [ACTIVE, INACTIVE] }
 *               notes: { type: string }
 *     responses:
 *       201:
 *         description: Customer created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Customer' }
 *       403:
 *         description: Sales Executives may not create customers
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   get:
 *     tags: [Customers]
 *     operationId: listCustomers
 *     summary: List customers
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
 *         schema: { type: string, example: 'ACTIVE' }
 *       - in: query
 *         name: origin
 *         schema: { type: string, example: 'CONVERTED' }
 *       - in: query
 *         name: assignedTo
 *         schema: { type: string }
 *       - in: query
 *         name: originalLead
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Paginated customers
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedCustomers' }
 */
router.post(
  '/',
  authorize(ROLES.ADMIN, ROLES.SALES_MANAGER),
  validate(createCustomerSchema, 'body'),
  asyncHandler(createCustomer)
);

router.get('/', validate(listCustomersQuery, 'query'), asyncHandler(listCustomers));

/**
 * @openapi
 * /customers/{id}:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   get:
 *     tags: [Customers]
 *     operationId: getCustomerById
 *     summary: Get a customer
 *     responses:
 *       200:
 *         description: Customer
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Customer' }
 *       404:
 *         description: Customer not found or not visible
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   patch:
 *     tags: [Customers]
 *     operationId: updateCustomer
 *     summary: Update a customer
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
 *               address: { type: string }
 *               status: { type: string, enum: [ACTIVE, INACTIVE] }
 *               notes: { type: string }
 *     responses:
 *       200:
 *         description: Customer updated
 *       403:
 *         description: Not permitted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     tags: [Customers]
 *     operationId: deleteCustomer
 *     summary: Delete a customer (ADMIN, SALES_MANAGER)
 *     description: Refused while the customer still owns deals or activities.
 *     responses:
 *       204:
 *         description: Customer deleted
 *       422:
 *         description: Customer still has deals or activities
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/:id', validate(idParamSchema, 'params'), asyncHandler(getCustomer));

router.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateCustomerSchema, 'body'),
  asyncHandler(updateCustomer)
);

router.delete(
  '/:id',
  authorize(ROLES.ADMIN, ROLES.SALES_MANAGER),
  validate(idParamSchema, 'params'),
  asyncHandler(deleteCustomer)
);

/**
 * @openapi
 * /customers/{id}/assignment:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   patch:
 *     tags: [Customers]
 *     operationId: assignCustomer
 *     summary: Reassign a customer (ADMIN, SALES_MANAGER)
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
  authorize(ROLES.ADMIN, ROLES.SALES_MANAGER),
  validate(idParamSchema, 'params'),
  validate(assignCustomerSchema, 'body'),
  asyncHandler(assignCustomer)
);

/**
 * @openapi
 * /customers/{id}/deals:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   get:
 *     tags: [Customers]
 *     operationId: getCustomerDeals
 *     summary: Deals belonging to a customer
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - in: query
 *         name: stage
 *         schema: { type: string }
 *       - in: query
 *         name: minValue
 *         schema: { type: number }
 *       - in: query
 *         name: maxValue
 *         schema: { type: number }
 *     responses:
 *       200:
 *         description: Paginated deals
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedDeals' }
 *       404:
 *         description: Customer not found or not visible
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get(
  '/:id/deals',
  validate(idParamSchema, 'params'),
  validate(listDealsQuery, 'query'),
  asyncHandler(getCustomerDeals)
);

/**
 * @openapi
 * /customers/{id}/activities:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   get:
 *     tags: [Activities]
 *     operationId: getCustomerActivities
 *     summary: Activities related to a customer
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, example: 'PENDING,OVERDUE' }
 *     responses:
 *       200:
 *         description: Paginated activities
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedActivities' }
 *       404:
 *         description: Customer not found or not visible
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get(
  '/:id/activities',
  validate(idParamSchema, 'params'),
  validate(listActivitiesQuery, 'query'),
  asyncHandler(getCustomerActivities)
);

/**
 * @openapi
 * /customers/{id}/timeline:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   get:
 *     tags: [Timeline]
 *     operationId: getCustomerTimeline
 *     summary: Audit history of a customer
 *     responses:
 *       200:
 *         description: Timeline entries
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedTimeline' }
 */
router.get('/:id/timeline', validate(idParamSchema, 'params'), asyncHandler(getCustomerTimeline));

export default router;