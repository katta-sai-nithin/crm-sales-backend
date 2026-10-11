import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { authenticate } from '../middleware/authenticate.js';
import { validate } from '../middleware/validate.js';
import { idParamSchema } from '../validators/common.validator.js';
import {
  createActivitySchema,
  updateActivitySchema,
  listActivitiesQuery,
  timelineParamsSchema,
  listTimelineQuery,
} from '../validators/deal.validator.js';
import {
  createActivity,
  listActivities,
  getActivity,
  updateActivity,
  completeActivity,
  deleteActivity,
  getEntityTimeline,
} from '../controllers/activity.controller.js';

const router = Router();

router.use(asyncHandler(authenticate));

/**
 * @openapi
 * /activities:
 *   post:
 *     tags: [Activities]
 *     operationId: createActivity
 *     summary: Create an activity / follow-up
 *     description: |
 *       The related entity must exist **and** be visible to the caller, so an
 *       activity can never be attached to somebody else's record. The status is
 *       derived on read: a PENDING activity whose `dueDate` has passed is reported
 *       as `OVERDUE` through the `derivedStatus` field.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, title, relatedEntityType, relatedEntityId]
 *             properties:
 *               type: { $ref: '#/components/schemas/ActivityType' }
 *               title: { type: string, example: 'Discovery call with Acme' }
 *               description: { type: string }
 *               assignedTo: { type: string }
 *               dueDate: { type: string, format: date-time }
 *               relatedEntityType: { $ref: '#/components/schemas/ActivityRelatedEntityType' }
 *               relatedEntityId: { type: string }
 *     responses:
 *       201:
 *         description: Activity created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Activity' }
 *       400:
 *         description: Related entity does not exist / validation error
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Related entity not visible to the caller
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   get:
 *     tags: [Activities]
 *     operationId: listActivities
 *     summary: List activities
 *     parameters:
 *       - $ref: '#/components/parameters/PageParam'
 *       - $ref: '#/components/parameters/LimitParam'
 *       - $ref: '#/components/parameters/SearchParam'
 *       - $ref: '#/components/parameters/SortByParam'
 *       - $ref: '#/components/parameters/SortOrderParam'
 *       - $ref: '#/components/parameters/DateFromParam'
 *       - $ref: '#/components/parameters/DateToParam'
 *       - in: query
 *         name: type
 *         schema: { type: string, example: 'CALL,FOLLOW_UP' }
 *       - in: query
 *         name: status
 *         description: Derived status - PENDING includes only activities whose due date has not passed
 *         schema: { type: string, example: 'OVERDUE' }
 *       - in: query
 *         name: assignedTo
 *         schema: { type: string }
 *       - in: query
 *         name: relatedEntityType
 *         schema: { type: string, enum: [LEAD, CUSTOMER, DEAL, USER] }
 *       - in: query
 *         name: relatedEntityId
 *         schema: { type: string }
 *       - in: query
 *         name: dueFrom
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: dueTo
 *         schema: { type: string, format: date-time }
 *     responses:
 *       200:
 *         description: Paginated activities
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedActivities' }
 */
router.post('/', validate(createActivitySchema, 'body'), asyncHandler(createActivity));

router.get('/', validate(listActivitiesQuery, 'query'), asyncHandler(listActivities));

/**
 * @openapi
 * /activities/{id}:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   get:
 *     tags: [Activities]
 *     operationId: getActivityById
 *     summary: Get an activity
 *     responses:
 *       200:
 *         description: Activity
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data: { $ref: '#/components/schemas/Activity' }
 *       404:
 *         description: Activity not found or not visible
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   patch:
 *     tags: [Activities]
 *     operationId: updateActivity
 *     summary: Update an activity
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               description: { type: string }
 *               type: { $ref: '#/components/schemas/ActivityType' }
 *               dueDate: { type: string, format: date-time, nullable: true }
 *     responses:
 *       200:
 *         description: Activity updated
 *       422:
 *         description: Due date of a completed activity cannot be changed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *   delete:
 *     tags: [Activities]
 *     operationId: deleteActivity
 *     summary: Delete an activity
 *     responses:
 *       204:
 *         description: Activity deleted
 *       403:
 *         description: Not permitted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/:id', validate(idParamSchema, 'params'), asyncHandler(getActivity));

router.patch(
  '/:id',
  validate(idParamSchema, 'params'),
  validate(updateActivitySchema, 'body'),
  asyncHandler(updateActivity)
);

router.delete('/:id', validate(idParamSchema, 'params'), asyncHandler(deleteActivity));

/**
 * @openapi
 * /activities/{id}/complete:
 *   parameters:
 *     - in: path
 *       name: id
 *       required: true
 *       schema: { type: string }
 *   patch:
 *     tags: [Activities]
 *     operationId: completeActivity
 *     summary: Mark an activity as completed
 *     description: Sets `completedAt`. A completed activity is never reported as overdue again.
 *     responses:
 *       200:
 *         description: Activity completed
 *       403:
 *         description: Not your activity
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Activity already completed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/:id/complete', validate(idParamSchema, 'params'), asyncHandler(completeActivity));

export default router;

/**
 * @openapi
 * /timeline/{entityType}/{entityId}:
 *   parameters:
 *     - in: path
 *       name: entityType
 *       required: true
 *       schema: { $ref: '#/components/schemas/TimelineEntityType' }
 *     - in: path
 *       name: entityId
 *       required: true
 *       schema: { type: string }
 *     - $ref: '#/components/parameters/PageParam'
 *     - $ref: '#/components/parameters/LimitParam'
 *   get:
 *     tags: [Timeline]
 *     operationId: getEntityTimeline
 *     summary: Append-only audit history of a CRM record
 *     description: |
 *       Access is enforced against the referenced record: a caller that cannot see
 *       the lead / customer / deal receives 404. There is no update or delete
 *       operation for timeline entries anywhere in the API.
 *     responses:
 *       200:
 *         description: Timeline entries
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/PaginatedTimeline' }
 *       403:
 *         description: Not permitted for this entity type
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Entity not found or not visible
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
export const timelineRouter = Router();
timelineRouter.use(asyncHandler(authenticate));
timelineRouter.get(
  '/:entityType/:entityId',
  validate(timelineParamsSchema, 'params'),
  validate(listTimelineQuery, 'query'),
  asyncHandler(getEntityTimeline)
);