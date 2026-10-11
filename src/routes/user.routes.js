
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';
import { validate } from '../middleware/validate.js';
import { ROLES } from '../constants/roles.js';
import {
  createUserSchema,
  updateUserSchema,
  listUsersQuery,
  idParamSchema,
  setUserStatusSchema,
} from '../validators/auth.validator.js';
import {
  listUsers,
  createUser,
  getUser,
  updateUser,
  setUserStatus,
  deleteUser,
  listAssignableUsers,
  getMyProfile,
} from '../controllers/user.controller.js';

const router = Router();

router.use(asyncHandler(authenticate));

/**
 * @openapi
 * /users/me:
 *   get:
 *     tags: [Users]
 *     operationId: getMyProfile
 *     summary: Return the authenticated user's own profile
 *     responses:
 *       200:
 *         description: Profile
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/User' }
 *       401:
 *         description: Unauthenticated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/me', asyncHandler(getMyProfile));

/**
 * @openapi
 * /users:
 *   get:
 *     tags: [Users]
 *     operationId: listUsers
 *     summary: List users (ADMIN, SALES_MANAGER)
 *     description: Sales Managers never see ADMIN accounts.
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - in: query
 *         name: role
 *         schema: { $ref: '#/components/schemas/Role' }
 *       - in: query
 *         name: isActive
 *         schema: { type: boolean }
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/DateFromParam'
 *       - $ref: '#/components/parameters/DateToParam'
 *     responses:
 *       200:
 *         description: Paginated list of users
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedUsers' }
 *       403:
 *         description: Sales Executives are not allowed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   post:
 *     tags: [Users]
 *     operationId: createUser
 *     summary: Create a user (ADMIN)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, role]
 *             properties:
 *               name: { type: string, example: 'Jane Doe' }
 *               email: { type: string, format: email }
 *               phone: { type: string }
 *               password: { type: string, minLength: 8 }
 *               role: { $ref: '#/components/schemas/Role' }
 *               team: { type: string, example: '65f0c1a2b3c4d5e6f7a8b9c0' }
 *     responses:
 *       201:
 *         description: User created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/User' }
 *       403:
 *         description: Administrator role required
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Email already in use
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get(
  '/',
  authorize(ROLES.ADMIN, ROLES.SALES_MANAGER),
  validate(listUsersQuery, 'query'),
  asyncHandler(listUsers)
);

router.post('/', authorize(ROLES.ADMIN), validate(createUserSchema, 'body'), asyncHandler(createUser));

/**
 * @openapi
 * /users/assignable:
 *   get:
 *     tags: [Users]
 *     operationId: listAssignableUsers
 *     summary: List active users that can receive assignments
 *     description: Sales Managers receive only themselves and their own team.
 *     responses:
 *       200:
 *         description: Assignable users
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: array
 *                       items: { $ref: '#/components/schemas/User' }
 *       403:
 *         description: Not allowed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get(
  '/assignable',
  authorize(ROLES.ADMIN, ROLES.SALES_MANAGER),
  asyncHandler(listAssignableUsers)
);

/**
 * @openapi
 * /users/{id}:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   get:
 *     tags: [Users]
 *     operationId: getUserById
 *     summary: Get a user by id
 *     responses:
 *       200:
 *         description: User
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/User' }
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   patch:
 *     tags: [Users]
 *     operationId: updateUser
 *     summary: Update a user (ADMIN)
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
 *               role: { $ref: '#/components/schemas/Role' }
 *               team: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: User updated
 *       400:
 *         description: Validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Administrator role required
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Role change would remove the last administrator
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     tags: [Users]
 *     operationId: deleteUser
 *     summary: Delete a user (ADMIN)
 *     description: Refused while the user still owns leads, customers, deals or activities.
 *     responses:
 *       204:
 *         description: User deleted
 *       403:
 *         description: Administrator role required
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: User still owns CRM records
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get(
  '/:id',
  authorize(ROLES.ADMIN, ROLES.SALES_MANAGER),
  validate(idParamSchema, 'params'),
  asyncHandler(getUser)
);

router.patch(
  '/:id',
  authorize(ROLES.ADMIN),
  validate(idParamSchema, 'params'),
  validate(updateUserSchema, 'body'),
  asyncHandler(updateUser)
);

router.delete(
  '/:id',
  authorize(ROLES.ADMIN),
  validate(idParamSchema, 'params'),
  asyncHandler(deleteUser)
);

/**
 * @openapi
 * /users/{id}/status:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   patch:
 *     tags: [Users]
 *     operationId: setUserActiveStatus
 *     summary: Activate or deactivate an account (ADMIN)
 *     description: |
 *       Deactivating immediately blocks authentication and revokes all refresh
 *       sessions. Ownership of existing records is **not** transferred
 *       automatically; the response reports how many records would become
 *       unassigned.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [isActive]
 *             properties:
 *               isActive: { type: boolean }
 *     responses:
 *       200:
 *         description: Status updated
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
 *                         user: { $ref: '#/components/schemas/User' }
 *                         orphanedRecords:
 *                           type: object
 *                           properties:
 *                             leads: { type: integer }
 *                             customers: { type: integer }
 *                             deals: { type: integer }
 *                             activities: { type: integer }
 *       422:
 *         description: Business rule violation
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch(
  '/:id/status',
  authorize(ROLES.ADMIN),
  validate(idParamSchema, 'params'),
  validate(setUserStatusSchema, 'body'),
  asyncHandler(setUserStatus)
);

export default router;