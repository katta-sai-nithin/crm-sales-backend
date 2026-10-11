import { Activity } from '../models/Activity.js';
import { Lead } from '../models/Lead.js';
import { Customer } from '../models/Customer.js';
import { Deal } from '../models/Deal.js';
import { User } from '../models/User.js';
import { ROLES } from '../constants/roles.js';
import {
  ACTIVITY_STATUSES,
  ACTIVITY_RELATED_ENTITY_TYPES,
  ACTIVITY_TYPES_REQUIRING_DUE_DATE,
} from '../constants/activity.js';
import { ApiError } from '../utils/ApiError.js';
import { toObjectId } from '../utils/objectId.js';
import { buildSearchRegex } from '../utils/sanitize.js';
import { executePaginatedQuery } from '../utils/query.js';
import { buildScopeFilter, ScopeType } from './accessScope.service.js';
import { timelineService } from './timeline.service.js';
import { TIMELINE_ACTIONS, TIMELINE_ENTITY_TYPES } from '../constants/timeline.js';
import { userService } from './user.service.js';

const ACTIVITY_POPULATE = [
  { path: 'assignedTo', select: 'id name email role isActive' },
  { path: 'createdBy', select: 'id name email role' },
];

const ENTITY_MODELS = {
  LEAD: Lead,
  CUSTOMER: Customer,
  DEAL: Deal,
  USER: User,
};

/**
 * Derive the effective status of an activity.
 *
 * COMPLETED is terminal: a completed activity is never reported as overdue,
 * even long after its due date. OVERDUE is a pure read-time computation, which is
 * why overdue reporting works without any scheduled job.
 */
export function deriveActivityStatus(activity, now = new Date()) {
  if (!activity) return ACTIVITY_STATUSES.PENDING;
  if (activity.status === ACTIVITY_STATUSES.COMPLETED) return ACTIVITY_STATUSES.COMPLETED;
  if (activity.dueDate && new Date(activity.dueDate).getTime() < now.getTime()) {
    return ACTIVITY_STATUSES.OVERDUE;
  }
  return ACTIVITY_STATUSES.PENDING;
}

/**
 * Mongo filter matching activities with a given *derived* status.
 */
export function buildStatusFilter(status, now = new Date()) {
  if (!status) return {};
  const statuses = [].concat(status);
  const or = [];
  for (const value of statuses) {
    if (value === ACTIVITY_STATUSES.COMPLETED) {
      or.push({ status: ACTIVITY_STATUSES.COMPLETED });
    } else if (value === ACTIVITY_STATUSES.OVERDUE) {
      or.push({ status: { $ne: ACTIVITY_STATUSES.COMPLETED }, dueDate: { $ne: null, $lt: now } });
    } else if (value === ACTIVITY_STATUSES.PENDING) {
      or.push({
        status: { $ne: ACTIVITY_STATUSES.COMPLETED },
        $or: [{ dueDate: null }, { dueDate: { $gte: now } }],
      });
    }
  }
  return or.length ? { $or: or } : {};
}

class ActivityService {
  async buildListFilter(query, actor) {
    const scope = await buildScopeFilter(actor, ScopeType.ACTIVITY);
    const and = [];

    if (query.type) and.push({ type: { $in: [].concat(query.type) } });
    if (query.status) and.push(buildStatusFilter(query.status));
    if (query.assignedTo) and.push({ assignedTo: toObjectId(query.assignedTo) });
    if (query.relatedEntityType) and.push({ relatedEntityType: query.relatedEntityType });
    if (query.relatedEntityId) and.push({ relatedEntityId: toObjectId(query.relatedEntityId) });

    if (query.dueFrom || query.dueTo) {
      const range = {};
      if (query.dueFrom) range.$gte = new Date(query.dueFrom);
      if (query.dueTo) range.$lte = new Date(query.dueTo);
      and.push({ dueDate: range });
    }

    if (query.dateFrom || query.dateTo) {
      const range = {};
      if (query.dateFrom) range.$gte = new Date(query.dateFrom);
      if (query.dateTo) range.$lte = new Date(query.dateTo);
      and.push({ createdAt: range });
    }

    if (query.search) {
      const regex = buildSearchRegex(query.search);
      if (regex) and.push({ $or: [{ title: regex }, { description: regex }] });
    }

    return { $and: [scope, ...(and.length ? [{ $and: and }] : [])] };
  }

  async list(query, actor) {
    const filter = await this.buildListFilter(query, actor);
    const sort = { [query.sortBy || 'createdAt']: query.sortOrder === 'asc' ? 1 : -1, _id: -1 };
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const result = await executePaginatedQuery(Activity, {
      filter,
      sort,
      page,
      limit,
      skip,
      populate: ACTIVITY_POPULATE,
    });

    return {
      records: result.records.map((record) => ({
        ...record,
        derivedStatus: deriveActivityStatus(record),
      })),
      pagination: result.pagination,
    };
  }

  async getVisible(id, actor) {
    const activity = await Activity.findById(toObjectId(id)).populate(ACTIVITY_POPULATE);
    if (!activity) throw ApiError.notFound('Activity not found');

    const visible = await buildScopeFilter(actor, ScopeType.ACTIVITY);
    if (Object.keys(visible).length) {
      const scoped = await Activity.findOne({ _id: activity._id, ...visible }).select('_id').lean();
      if (!scoped) throw ApiError.notFound('Activity not found');
    }

    return activity;
  }

  /**
   * Validate that the related entity exists and that the actor may act on it.
   * An activity can never be attached to a record the creator cannot see.
   */
  async assertRelatedEntityAccessible(relatedEntityType, relatedEntityId, actor) {
    const model = ENTITY_MODELS[relatedEntityType];
    if (!model) throw ApiError.badRequest(`Unsupported related entity type: ${relatedEntityType}`);

    const entity = await model.findById(toObjectId(relatedEntityId));
    if (!entity) {
      throw ApiError.badRequest(`The referenced ${relatedEntityType.toLowerCase()} does not exist`);
    }

    if (relatedEntityType === ACTIVITY_RELATED_ENTITY_TYPES.USER) {
      if (actor.role !== ROLES.ADMIN && actor.role !== ROLES.SALES_MANAGER) {
        throw ApiError.forbidden('Only administrators and managers can attach activities to a user');
      }
      if (String(entity._id) !== String(actor._id) && actor.role !== ROLES.ADMIN) {
        // Managers may log activities for their own team.
        const teamIds = await userService.getTeamScopeIds(actor);
        if (!teamIds.map(String).includes(String(entity._id))) {
          throw ApiError.forbidden('You may only attach activities to users in your team');
        }
      }
      return entity;
    }

    const scopeType =
      relatedEntityType === ACTIVITY_RELATED_ENTITY_TYPES.LEAD
        ? ScopeType.LEAD
        : relatedEntityType === ACTIVITY_RELATED_ENTITY_TYPES.CUSTOMER
          ? ScopeType.CUSTOMER
          : ScopeType.DEAL;

    const scope = await buildScopeFilter(actor, scopeType);
    if (Object.keys(scope).length) {
      const scoped = await model.findOne({ _id: entity._id, ...scope }).select('_id').lean();
      if (!scoped) {
        // Do not disclose the existence of records outside the caller's scope.
        throw ApiError.notFound(
          `The referenced ${relatedEntityType.toLowerCase()} does not exist`
        );
      }
    }

    return entity;
  }

  async create(payload, actor, context = {}) {
    const entity = await this.assertRelatedEntityAccessible(
      payload.relatedEntityType,
      payload.relatedEntityId,
      actor
    );

    if (ACTIVITY_TYPES_REQUIRING_DUE_DATE.includes(payload.type) && !payload.dueDate) {
      throw ApiError.badRequest(`dueDate is required for activity type ${payload.type}`);
    }

    const assigneeId = payload.assignedTo
      ? (await userService.assertAssignable(payload.assignedTo, actor))._id
      : entity.assignedTo || actor._id;

    const activity = await Activity.create({
      type: payload.type,
      title: payload.title,
      description: payload.description ?? '',
      assignedTo: assigneeId,
      dueDate: payload.dueDate ?? null,
      relatedEntityType: payload.relatedEntityType,
      relatedEntityId: toObjectId(payload.relatedEntityId),
      createdBy: actor._id,
      status: ACTIVITY_STATUSES.PENDING,
    });

    await timelineService.record({
      action: TIMELINE_ACTIONS.ACTIVITY_CREATED,
      entityType: TIMELINE_ENTITY_TYPES.ACTIVITY,
      entityId: activity._id,
      entityLabel: activity.title,
      performedBy: actor._id,
      newValue: activity,
      metadata: {
        type: activity.type,
        relatedEntityType: activity.relatedEntityType,
        relatedEntityId: String(activity.relatedEntityId),
        dueDate: activity.dueDate,
      },
      ip: context.ip,
    });

    // The activity is also visible on the timeline of the entity it references.
    if (activity.type === 'NOTE' || activity.type === 'REMINDER') {
      await timelineService.record({
        action:
          activity.type === 'NOTE'
            ? TIMELINE_ACTIONS.ACTIVITY_CREATED
            : TIMELINE_ACTIONS.ACTIVITY_CREATED,
        entityType: this.entityTypeToTimelineType(payload.relatedEntityType),
        entityId: toObjectId(payload.relatedEntityId),
        entityLabel: activity.title,
        performedBy: actor._id,
        newValue: { title: activity.title, type: activity.type },
        metadata: { activityId: String(activity._id), note: 'created' },
        ip: context.ip,
      });
    }

    return activity.populate(ACTIVITY_POPULATE);
  }

  async update(id, payload, actor, context = {}) {
    const activity = await this.getVisible(id, actor);

    if (activity.status === ACTIVITY_STATUSES.COMPLETED && payload.dueDate !== undefined) {
      throw ApiError.unprocessable('The due date of a completed activity cannot be changed');
    }

    const before = activity.toObject();
    let changed = false;

    for (const field of ['title', 'description', 'type', 'dueDate']) {
      if (payload[field] !== undefined) {
        activity[field] = payload[field];
        changed = true;
      }
    }

    if (!changed) throw ApiError.badRequest('No updatable fields were provided');

    if (ACTIVITY_TYPES_REQUIRING_DUE_DATE.includes(activity.type) && !activity.dueDate) {
      throw ApiError.badRequest(`dueDate is required for activity type ${activity.type}`);
    }

    await activity.save();

    await timelineService.recordChanges({
      action: TIMELINE_ACTIONS.ACTIVITY_UPDATED,
      entityType: TIMELINE_ENTITY_TYPES.ACTIVITY,
      entityId: activity._id,
      entityLabel: activity.title,
      performedBy: actor._id,
      before,
      after: activity.toObject(),
      metadata: {},
      ip: context.ip,
    });

    return activity.populate(ACTIVITY_POPULATE);
  }

  /**
   * Complete an activity.
   *
   * Rejects: completing an already completed activity, completing an activity
   * that is not visible to the actor, and completing an activity on behalf of
   * somebody else (only an ADMIN / manager may do that).
   */
  async complete(id, actor, context = {}) {
    const activity = await this.getVisible(id, actor);

    if (activity.status === ACTIVITY_STATUSES.COMPLETED) {
      throw ApiError.unprocessable('This activity is already completed');
    }

    if (actor.role === ROLES.SALES_EXECUTIVE && refId(activity.assignedTo) !== String(actor._id)) {
      throw ApiError.forbidden('Sales Executives may only complete their own activities');
    }

    activity.status = ACTIVITY_STATUSES.COMPLETED;
    activity.completedAt = new Date();
    await activity.save();

    await timelineService.record({
      action: TIMELINE_ACTIONS.ACTIVITY_COMPLETED,
      entityType: TIMELINE_ENTITY_TYPES.ACTIVITY,
      entityId: activity._id,
      entityLabel: activity.title,
      performedBy: actor._id,
      previousValue: { status: deriveActivityStatus(beforeStatusDoc(activity)) },
      newValue: { status: ACTIVITY_STATUSES.COMPLETED, completedAt: activity.completedAt },
      metadata: { type: activity.type },
      ip: context.ip,
    });

    await timelineService.record({
      action: TIMELINE_ACTIONS.ACTIVITY_COMPLETED,
      entityType: this.entityTypeToTimelineType(activity.relatedEntityType),
      entityId: activity.relatedEntityId,
      entityLabel: activity.title,
      performedBy: actor._id,
      newValue: { status: ACTIVITY_STATUSES.COMPLETED, completedAt: activity.completedAt },
      metadata: { activityId: String(activity._id), type: activity.type },
      ip: context.ip,
    });

    return activity.populate(ACTIVITY_POPULATE);
  }

  async remove(id, actor, context = {}) {
    const activity = await this.getVisible(id, actor);

    if (actor.role === ROLES.SALES_EXECUTIVE && refId(activity.createdBy) !== String(actor._id)) {
      throw ApiError.forbidden('Sales Executives may only delete activities they created');
    }

    const snapshot = activity.toObject();
    await activity.deleteOne();

    await timelineService.record({
      action: TIMELINE_ACTIONS.ACTIVITY_DELETED,
      entityType: TIMELINE_ENTITY_TYPES.ACTIVITY,
      entityId: activity._id,
      entityLabel: activity.title,
      performedBy: actor._id,
      previousValue: snapshot,
      ip: context.ip,
    });

    return { id: String(activity._id) };
  }

  entityTypeToTimelineType(entityType) {
    switch (entityType) {
      case ACTIVITY_RELATED_ENTITY_TYPES.LEAD:
        return TIMELINE_ENTITY_TYPES.LEAD;
      case ACTIVITY_RELATED_ENTITY_TYPES.CUSTOMER:
        return TIMELINE_ENTITY_TYPES.CUSTOMER;
      case ACTIVITY_RELATED_ENTITY_TYPES.DEAL:
        return TIMELINE_ENTITY_TYPES.DEAL;
      case ACTIVITY_RELATED_ENTITY_TYPES.USER:
      default:
        return TIMELINE_ENTITY_TYPES.USER;
    }
  }

  /**
   * Persist the OVERDUE flag for pending activities whose due date has passed.
   *
   * This job is *maintenance only*: reporting never depends on it (see
   * `buildStatusFilter`). It exists so that a simple `db.activities.find({status:
   * 'OVERDUE'})` in a BI tool returns the right rows.
   */
  async markOverdueActivities({ session = null } = {}) {
    const result = await Activity.updateMany(
      {
        status: ACTIVITY_STATUSES.PENDING,
        dueDate: { $ne: null, $lt: new Date() },
      },
      { $set: { status: ACTIVITY_STATUSES.OVERDUE } },
      session ? { session } : {}
    );
    return result.modifiedCount;
  }
}

/**
 * Resolve a possibly populated reference (ObjectId, document or plain object)
 * into its string id.
 */
export function refId(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') {
    if (value._id) return String(value._id);
    return null;
  }
  return String(value);
}

function beforeStatusDoc(activity) {
  return {
    status: activity.status === ACTIVITY_STATUSES.COMPLETED ? ACTIVITY_STATUSES.COMPLETED : activity.status,
    dueDate: activity.dueDate,
  };
}

export const activityService = new ActivityService();
export default activityService;