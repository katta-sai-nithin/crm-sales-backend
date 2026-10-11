import { Lead } from '../models/Lead.js';
import { ROLES } from '../constants/roles.js';
import { LEAD_STATUSES, LEAD_STATUS_TRANSITIONS, LEAD_STATUS_VALUES } from '../constants/lead.js';
import { ApiError } from '../utils/ApiError.js';
import { toObjectId } from '../utils/objectId.js';
import { buildSearchRegex } from '../utils/sanitize.js';
import { executePaginatedQuery } from '../utils/query.js';
import { buildScopeFilter, ScopeType, isInManagerTeam } from './accessScope.service.js';
import { timelineService } from './timeline.service.js';
import { TIMELINE_ACTIONS, TIMELINE_ENTITY_TYPES } from '../constants/timeline.js';
import { userService } from './user.service.js';

const LEAD_POPULATE = [
  { path: 'assignedTo', select: 'id name email role isActive' },
  { path: 'createdBy', select: 'id name email role' },
  { path: 'convertedCustomer', select: 'id name email company' },
];

/**
 * Lead service: CRUD, visibility scoping, status transitions and assignment.
 *
 * Assignment rules (enforced server side, never trusted from the payload):
 *  - ADMIN           -> any active SALES_MANAGER / SALES_EXECUTIVE.
 *  - SALES_MANAGER   -> themselves or a member of their own team.
 *  - SALES_EXECUTIVE -> nobody else. On create they are auto-assigned to
 *    themselves, which is the only "assignment" they are allowed to perform.
 */
class LeadService {
  /**
   * Build the Mongo filter for a lead list request, combining the visibility
   * scope with all module filters.
   */
  async buildListFilter(query, actor) {
    const scope = await buildScopeFilter(actor, ScopeType.LEAD);
    const filters = [scope];

    const and = [];
    if (query.status) and.push({ status: { $in: [].concat(query.status) } });
    if (query.priority) and.push({ priority: { $in: [].concat(query.priority) } });
    if (query.source) and.push({ source: { $in: [].concat(query.source) } });

    // An executive may only see their own book, so their own filters can never
    // widen the scope beyond it (the scope filter is ANDed with these).
    if (query.assignedTo) {
      and.push({ assignedTo: toObjectId(query.assignedTo) });
    }
    if (query.createdBy) and.push({ createdBy: toObjectId(query.createdBy) });
    if (query.unassigned === true) and.push({ assignedTo: null });
    if (query.unassigned === false) and.push({ assignedTo: { $ne: null } });

    if (query.dateFrom || query.dateTo) {
      const range = {};
      if (query.dateFrom) range.$gte = new Date(query.dateFrom);
      if (query.dateTo) range.$lte = new Date(query.dateTo);
      and.push({ createdAt: range });
    }

    if (query.search) {
      const regex = buildSearchRegex(query.search);
      if (regex) and.push({ $or: [{ name: regex }, { email: regex }, { company: regex }, { phone: regex }] });
    }

    filters.push(and.length ? { $and: and } : {});

    return filters.length === 1 ? filters[0] : { $and: filters.filter((f) => Object.keys(f).length) };
  }

  async list(query, actor) {
    const filter = await this.buildListFilter(query, actor);
    const sort = { [query.sortBy || 'createdAt']: query.sortOrder === 'asc' ? 1 : -1, _id: -1 };
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    return executePaginatedQuery(Lead, {
      filter,
      sort,
      page,
      limit,
      skip,
      populate: LEAD_POPULATE,
    });
  }

  /**
   * Load a lead and assert the actor may see it.
   * Returns 404 (not 403) for invisible records so that the API does not leak
   * the existence of other users' data.
   */
  async getVisible(id, actor) {
    const lead = await Lead.findById(toObjectId(id)).populate(LEAD_POPULATE);
    if (!lead) throw ApiError.notFound('Lead not found');

    const visible = await buildScopeFilter(actor, ScopeType.LEAD);
    const scoped = Object.keys(visible).length
      ? await Lead.findOne({ _id: lead._id, ...visible }).select('_id').lean()
      : lead;

    if (!scoped) throw ApiError.notFound('Lead not found');
    return lead;
  }

  async create(payload, actor, context = {}) {
    const data = await this.buildCreatePayload(payload, actor);

    const lead = await Lead.create(data);

    await timelineService.record({
      action: TIMELINE_ACTIONS.LEAD_CREATED,
      entityType: TIMELINE_ENTITY_TYPES.LEAD,
      entityId: lead._id,
      entityLabel: lead.name,
      performedBy: actor._id,
      newValue: lead,
      metadata: { source: lead.source, priority: lead.priority },
      ip: context.ip,
    });

    if (lead.assignedTo) {
      await timelineService.record({
        action: TIMELINE_ACTIONS.LEAD_ASSIGNED,
        entityType: TIMELINE_ENTITY_TYPES.LEAD,
        entityId: lead._id,
        entityLabel: lead.name,
        performedBy: actor._id,
        previousValue: { assignedTo: null },
        newValue: { assignedTo: lead.assignedTo },
        metadata: { note: 'initial assignment on creation' },
        ip: context.ip,
      });
    }

    return lead.populate(LEAD_POPULATE);
  }

  /**
   * Validate and prepare the create payload, resolving the assignee.
   */
  async buildCreatePayload(payload, actor) {
    const base = {
      name: payload.name,
      email: payload.email,
      phone: payload.phone ?? '',
      company: payload.company ?? '',
      source: payload.source ?? 'OTHER',
      priority: payload.priority ?? 'MEDIUM',
      description: payload.description ?? '',
      // Server-controlled: the creator is always the authenticated user.
      createdBy: actor._id,
      status: LEAD_STATUSES.NEW,
      assignedTo: null,
    };

    const requestedAssignee = payload.assignedTo ?? undefined;

    if (actor.role === ROLES.SALES_EXECUTIVE) {
      // Executives always start with themselves as the owner.
      return { ...base, assignedTo: actor._id };
    }

    if (requestedAssignee) {
      const assignee = await this.assertAssignable(requestedAssignee, actor);
      return { ...base, assignedTo: assignee._id };
    }

    // Managers own what they capture; admins create unassigned leads by default.
    return { ...base, assignedTo: actor.role === ROLES.SALES_MANAGER ? actor._id : null };
  }

  async update(id, payload, actor, context = {}) {
    const lead = await this.getVisible(id, actor);

    if (lead.status === LEAD_STATUSES.CONVERTED) {
      throw ApiError.unprocessable('A converted lead can no longer be edited');
    }

    const before = lead.toObject();
    const allowedFields = ['name', 'email', 'phone', 'company', 'source', 'priority', 'description'];
    const changed = {};

    for (const field of allowedFields) {
      if (payload[field] !== undefined) {
        lead[field] = payload[field];
        changed[field] = { from: before[field], to: payload[field] };
      }
    }

    if (Object.keys(changed).length === 0) {
      throw ApiError.badRequest('No updatable fields were provided');
    }

    await lead.save();

    await timelineService.recordChanges({
      action: changed.priority
        ? TIMELINE_ACTIONS.LEAD_PRIORITY_CHANGED
        : TIMELINE_ACTIONS.LEAD_UPDATED,
      entityType: TIMELINE_ENTITY_TYPES.LEAD,
      entityId: lead._id,
      entityLabel: lead.name,
      performedBy: actor._id,
      before,
      after: lead.toObject(),
      metadata: { changedFields: Object.keys(changed) },
      ip: context.ip,
    });

    return lead.populate(LEAD_POPULATE);
  }

  /**
   * Change a lead's status, enforcing the transition graph.
   */
  async updateStatus(id, status, actor, context = {}, { reason } = {}) {
    const lead = await this.getVisible(id, actor);
    const currentStatus = lead.status;

    if (status === currentStatus) {
      throw ApiError.unprocessable(`Lead is already in status ${status}`);
    }

    if (status === LEAD_STATUSES.CONVERTED) {
      throw ApiError.unprocessable(
        'A lead is marked CONVERTED automatically by the conversion endpoint'
      );
    }

    const allowed = LEAD_STATUS_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(status)) {
      throw ApiError.unprocessable(
        `Invalid lead status transition from ${currentStatus} to ${status}`,
        { details: { from: currentStatus, to: status, allowed } }
      );
    }

    lead.status = status;
    if (status === LEAD_STATUSES.LOST && reason) {
      lead.description = `${lead.description ? `${lead.description}\n` : ''}[LOST] ${reason}`.slice(-4000);
    }

    await lead.save();

    await timelineService.record({
      action: TIMELINE_ACTIONS.LEAD_STATUS_CHANGED,
      entityType: TIMELINE_ENTITY_TYPES.LEAD,
      entityId: lead._id,
      entityLabel: lead.name,
      performedBy: actor._id,
      previousValue: { status: currentStatus },
      newValue: { status },
      metadata: reason ? { reason } : {},
      ip: context.ip,
    });

    return lead.populate(LEAD_POPULATE);
  }

  /**
   * Reassign a lead.
   */
  async assign(id, assignedTo, actor, context = {}, { reason } = {}) {
    const lead = await this.getVisible(id, actor);

    if (lead.status === LEAD_STATUSES.CONVERTED) {
      throw ApiError.unprocessable('A converted lead cannot be reassigned');
    }

    const previousAssignee = lead.assignedTo ? String(lead.assignedTo._id ?? lead.assignedTo) : null;
    let newAssigneeId = null;

    if (assignedTo) {
      const assignee = await this.assertAssignable(assignedTo, actor, { currentAssignee: previousAssignee });
      newAssigneeId = String(assignee._id);
    } else {
      // Unassigning is an ADMIN / manager-only operation.
      if (actor.role === ROLES.SALES_EXECUTIVE) {
        throw ApiError.forbidden('Sales Executives may only assign leads to themselves');
      }
      if (lead.assignedTo && !isInManagerTeam(actor._id, await userService.getTeamScopeIds(actor), previousAssignee)) {
        throw ApiError.forbidden('You may only reassign leads within your own book of business');
      }
    }

    if (previousAssignee === newAssigneeId) {
      throw ApiError.unprocessable('The lead is already assigned to that user');
    }

    lead.assignedTo = newAssigneeId;
    await lead.save();

    await timelineService.record({
      action: previousAssignee ? TIMELINE_ACTIONS.LEAD_REASSIGNED : TIMELINE_ACTIONS.LEAD_ASSIGNED,
      entityType: TIMELINE_ENTITY_TYPES.LEAD,
      entityId: lead._id,
      entityLabel: lead.name,
      performedBy: actor._id,
      previousValue: { assignedTo: previousAssignee },
      newValue: { assignedTo: newAssigneeId },
      metadata: reason ? { reason } : {},
      ip: context.ip,
    });

    return lead.populate(LEAD_POPULATE);
  }

  /**
   * Delete a lead.
   *
   * Admin: any lead that has not been converted.
   * Manager: a lead in their own book.
   * Executive: forbidden - leads should be marked LOST / UNQUALIFIED instead of
   * removed from the audit trail.
   */
  async remove(id, actor, context = {}) {
    if (actor.role === ROLES.SALES_EXECUTIVE) {
      throw ApiError.forbidden('Sales Executives cannot delete leads');
    }

    const lead = await this.getVisible(id, actor);

    if (lead.status === LEAD_STATUSES.CONVERTED) {
      throw ApiError.unprocessable(
        'A converted lead cannot be deleted because it is linked to a customer and a deal'
      );
    }

    const snapshot = lead.toObject();
    await lead.deleteOne();

    await timelineService.record({
      action: TIMELINE_ACTIONS.LEAD_DELETED,
      entityType: TIMELINE_ENTITY_TYPES.LEAD,
      entityId: lead._id,
      entityLabel: lead.name,
      performedBy: actor._id,
      previousValue: snapshot,
      metadata: { status: snapshot.status },
      ip: context.ip,
    });

    return { id: String(lead._id) };
  }

  /**
   * Validate an assignment target.
   *
   * The shared implementation lives in UserService so that leads, customers,
   * deals and activities all enforce exactly the same rule set.
   */
  async assertAssignable(targetId, actor, options = {}) {
    return userService.assertAssignable(targetId, actor, options);
  }

  /**
   * Get a lead without any scope check - used by internal flows (conversion).
   */
  async getById(id) {
    const lead = await Lead.findById(toObjectId(id));
    if (!lead) throw ApiError.notFound('Lead not found');
    return lead;
  }

  static get eligibleStatuses() {
    return [LEAD_STATUSES.QUALIFIED, LEAD_STATUSES.CONVERTED];
  }

  static isEligibleForConversion(lead) {
    return lead.status === LEAD_STATUSES.QUALIFIED && !lead.convertedCustomer;
  }

  static assertValidLeadStatus(status) {
    if (!LEAD_STATUS_VALUES.includes(status)) {
      throw ApiError.badRequest(`Unsupported lead status: ${status}`);
    }
  }
}

export const leadService = new LeadService();
export default leadService;