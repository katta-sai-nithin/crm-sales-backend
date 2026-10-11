import { Deal } from '../models/Deal.js';
import { Customer } from '../models/Customer.js';
import { Lead } from '../models/Lead.js';
import { Activity } from '../models/Activity.js';
import { ROLES } from '../constants/roles.js';
import { DEAL_STAGES, DEAL_STAGE_TRANSITIONS, OPEN_DEAL_STAGES } from '../constants/deal.js';
import { ApiError } from '../utils/ApiError.js';
import { toObjectId } from '../utils/objectId.js';
import { buildSearchRegex } from '../utils/sanitize.js';
import { executePaginatedQuery } from '../utils/query.js';
import { deriveActivityStatus } from './activity.service.js';
import { calculateExpectedRevenue, roundMoney } from '../utils/money.js';
import { buildScopeFilter, ScopeType } from './accessScope.service.js';
import { timelineService } from './timeline.service.js';
import { TIMELINE_ACTIONS, TIMELINE_ENTITY_TYPES } from '../constants/timeline.js';
import { userService } from './user.service.js';

const DEAL_POPULATE = [
  { path: 'customer', select: 'id name email company status' },
  { path: 'lead', select: 'id name email status' },
  { path: 'assignedTo', select: 'id name email role isActive' },
  { path: 'createdBy', select: 'id name email role' },
];

/**
 * Deal service.
 *
 * Financial rules:
 *  - `dealValue` must be > 0;
 *  - `probability` is an integer 0-100;
 *  - `expectedRevenue` is always recomputed server side as
 *    dealValue x probability / 100, rounded to 2 decimals (currency: see
 *    `MONEY` in src/constants/deal.js);
 *  - `closedAt` is maintained by the service, never by the client;
 *  - an active deal must have a closing date that has not passed.
 */
class DealService {
  async buildListFilter(query, actor) {
    const scope = await buildScopeFilter(actor, ScopeType.DEAL);
    const and = [];

    if (query.stage) and.push({ stage: { $in: [].concat(query.stage) } });
    if (query.assignedTo) and.push({ assignedTo: toObjectId(query.assignedTo) });
    if (query.customer) and.push({ customer: toObjectId(query.customer) });
    if (query.lead) and.push({ lead: toObjectId(query.lead) });

    const valueFilter = {};
    if (query.minValue !== undefined) valueFilter.$gte = query.minValue;
    if (query.maxValue !== undefined) valueFilter.$lte = query.maxValue;
    if (Object.keys(valueFilter).length) and.push({ dealValue: valueFilter });

    if (query.closingFrom || query.closingTo) {
      const range = {};
      if (query.closingFrom) range.$gte = new Date(query.closingFrom);
      if (query.closingTo) range.$lte = new Date(query.closingTo);
      and.push({ expectedClosingDate: range });
    }

    if (query.dateFrom || query.dateTo) {
      const range = {};
      if (query.dateFrom) range.$gte = new Date(query.dateFrom);
      if (query.dateTo) range.$lte = new Date(query.dateTo);
      and.push({ createdAt: range });
    }

    if (query.search) {
      const regex = buildSearchRegex(query.search);
      if (regex) and.push({ $or: [{ name: regex }, { description: regex }] });
    }

    return { $and: [scope, ...(and.length ? [{ $and: and }] : [])] };
  }

  async list(query, actor) {
    const filter = await this.buildListFilter(query, actor);
    const sort = { [query.sortBy || 'createdAt']: query.sortOrder === 'asc' ? 1 : -1, _id: -1 };
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    return executePaginatedQuery(Deal, {
      filter,
      sort,
      page,
      limit,
      skip,
      populate: DEAL_POPULATE,
    });
  }

  async getVisible(id, actor) {
    const deal = await Deal.findById(toObjectId(id)).populate(DEAL_POPULATE);
    if (!deal) throw ApiError.notFound('Deal not found');

    const visible = await buildScopeFilter(actor, ScopeType.DEAL);
    if (Object.keys(visible).length) {
      const scoped = await Deal.findOne({ _id: deal._id, ...visible }).select('_id').lean();
      if (!scoped) throw ApiError.notFound('Deal not found');
    }
    return deal;
  }

  async create(payload, actor, context = {}, { session = null, lead = null } = {}) {
    const customer = await Customer.findById(toObjectId(payload.customer));
    if (!customer) throw ApiError.badRequest('The referenced customer does not exist');

    const assigneeId = payload.assignedTo
      ? (await userService.assertAssignable(payload.assignedTo, actor))._id
      : customer.assignedTo || actor._id;

    this.assertClosingDateForStage(payload.expectedClosingDate, payload.stage ?? DEAL_STAGES.QUALIFICATION);

    if (payload.stage === DEAL_STAGES.LOST && !payload.lostReason) {
      throw ApiError.unprocessable('lostReason is required when creating a deal in the LOST stage');
    }

    const dealValue = roundMoney(payload.dealValue);

    const created = await Deal.create(
      [
        {
          name: payload.name,
          customer: customer._id,
          lead: lead ? lead._id : null,
          assignedTo: assigneeId,
          dealValue,
          probability: payload.probability,
          expectedRevenue: calculateExpectedRevenue(dealValue, payload.probability),
          expectedClosingDate: payload.expectedClosingDate,
          stage: payload.stage ?? DEAL_STAGES.QUALIFICATION,
          description: payload.description ?? '',
          lostReason: payload.lostReason ?? '',
          // Server controlled.
          createdBy: actor._id,
          closedAt: [DEAL_STAGES.WON, DEAL_STAGES.LOST].includes(payload.stage) ? new Date() : null,
        },
      ],
      session ? { session } : {}
    );

    const deal = created[0];

    await timelineService.record(
      {
        action: TIMELINE_ACTIONS.DEAL_CREATED,
        entityType: TIMELINE_ENTITY_TYPES.DEAL,
        entityId: deal._id,
        entityLabel: deal.name,
        performedBy: actor._id,
        newValue: deal,
        metadata: { stage: deal.stage, customer: String(customer._id) },
        ip: context.ip,
      },
      { session }
    );

    return deal.populate(DEAL_POPULATE);
  }

  async update(id, payload, actor, context = {}) {
    const deal = await this.getVisible(id, actor);

    if (deal.stage === DEAL_STAGES.WON || deal.stage === DEAL_STAGES.LOST) {
      throw ApiError.unprocessable(
        `A closed deal (${deal.stage}) cannot be modified. Use POST /api/v1/deals/${deal.id}/reopen first.`
      );
    }

    const before = deal.toObject();
    let changed = false;

    if (payload.name !== undefined) {
      deal.name = payload.name;
      changed = true;
    }
    if (payload.description !== undefined) {
      deal.description = payload.description;
      changed = true;
    }
    if (payload.dealValue !== undefined) {
      this.assertClosingDateForStage(
        payload.expectedClosingDate ?? deal.expectedClosingDate,
        deal.stage
      );
      deal.dealValue = roundMoney(payload.dealValue);
      changed = true;
    }
    if (payload.probability !== undefined) {
      deal.probability = payload.probability;
      changed = true;
    }
    if (payload.expectedClosingDate !== undefined) {
      this.assertClosingDateForStage(payload.expectedClosingDate, deal.stage);
      deal.expectedClosingDate = payload.expectedClosingDate;
      changed = true;
    }

    if (!changed) throw ApiError.badRequest('No updatable fields were provided');

    // expectedRevenue is recomputed by the model pre-validate hook.
    deal.expectedRevenue = calculateExpectedRevenue(deal.dealValue, deal.probability);
    await deal.save();

    await timelineService.recordChanges({
      action: TIMELINE_ACTIONS.DEAL_UPDATED,
      entityType: TIMELINE_ENTITY_TYPES.DEAL,
      entityId: deal._id,
      entityLabel: deal.name,
      performedBy: actor._id,
      before,
      after: deal.toObject(),
      metadata: {},
      ip: context.ip,
    });

    return deal.populate(DEAL_POPULATE);
  }

  /**
   * Move a deal to another stage.
   */
  async updateStage(id, payload, actor, context = {}) {
    const { stage, lostReason, expectedClosingDate } = payload;
    const deal = await this.getVisible(id, actor);
    const currentStage = deal.stage;

    if (stage === currentStage) {
      throw ApiError.unprocessable(`Deal is already in stage ${stage}`);
    }

    if (deal.stage === DEAL_STAGES.WON || deal.stage === DEAL_STAGES.LOST) {
      throw ApiError.unprocessable(
        'A closed deal cannot return to an active stage. Use POST /api/v1/deals/:id/reopen instead.',
        { details: { currentStage, requestedStage: stage } }
      );
    }

    const allowed = DEAL_STAGE_TRANSITIONS[currentStage] || [];
    if (!allowed.includes(stage)) {
      throw ApiError.unprocessable(`Invalid deal stage transition from ${currentStage} to ${stage}`, {
        details: { from: currentStage, to: stage, allowed },
      });
    }

    const closingDate = expectedClosingDate ?? deal.expectedClosingDate;
    this.assertClosingDateForStage(closingDate, stage);

    if (stage === DEAL_STAGES.LOST && !lostReason && !deal.lostReason) {
      throw ApiError.unprocessable('lostReason is required when a deal is marked as LOST');
    }

    if (stage === DEAL_STAGES.WON) {
      // A won deal must carry complete, valid commercial information.
      if (!deal.dealValue || deal.dealValue <= 0) {
        throw ApiError.unprocessable('A won deal must have a deal value greater than zero');
      }
      if (deal.probability < 0 || deal.probability > 100) {
        throw ApiError.unprocessable('A won deal must have a valid probability between 0 and 100');
      }
      // Winning is a certainty: normalise the probability server side.
      deal.probability = 100;
      deal.lostReason = '';
    }

    if (stage === DEAL_STAGES.LOST) {
      deal.lostReason = lostReason ?? deal.lostReason;
      deal.closedAt = new Date();
    }

    if (stage === DEAL_STAGES.WON) {
      deal.closedAt = new Date();
    }

    if (OPEN_DEAL_STAGES.includes(stage)) {
      deal.closedAt = null;
      if (stage !== DEAL_STAGES.LOST) deal.lostReason = '';
    }

    if (expectedClosingDate) deal.expectedClosingDate = closingDate;

    deal.stage = stage;
    deal.expectedRevenue = calculateExpectedRevenue(deal.dealValue, deal.probability);
    await deal.save();

    const action =
      stage === DEAL_STAGES.WON
        ? TIMELINE_ACTIONS.DEAL_WON
        : stage === DEAL_STAGES.LOST
          ? TIMELINE_ACTIONS.DEAL_LOST
          : TIMELINE_ACTIONS.DEAL_STAGE_CHANGED;

    await timelineService.record({
      action,
      entityType: TIMELINE_ENTITY_TYPES.DEAL,
      entityId: deal._id,
      entityLabel: deal.name,
      performedBy: actor._id,
      previousValue: { stage: currentStage, probability: beforeProbability(deal, currentStage) },
      newValue: { stage, probability: deal.probability },
      metadata: {
        ...(lostReason ? { lostReason } : {}),
        ...(deal.lostReason && stage === DEAL_STAGES.LOST ? { lostReason: deal.lostReason } : {}),
      },
      ip: context.ip,
    });

    return deal.populate(DEAL_POPULATE);
  }

  /**
   * Explicit, separately authorised reopen of a closed deal.
   */
  async reopen(id, payload, actor, context = {}) {
    if (actor.role === ROLES.SALES_EXECUTIVE) {
      throw ApiError.forbidden('Only an administrator or a sales manager can reopen a closed deal');
    }

    const deal = await this.getVisible(id, actor);
    if (deal.stage !== DEAL_STAGES.WON && deal.stage !== DEAL_STAGES.LOST) {
      throw ApiError.unprocessable('Only a closed deal (WON or LOST) can be reopened');
    }

    const previousStage = deal.stage;
    const previousProbability = deal.probability;

    deal.stage = payload.stage;
    deal.closedAt = null;
    deal.lostReason = '';
    if (previousStage === DEAL_STAGES.WON && deal.probability === 100) {
      deal.probability = 50;
    }
    deal.expectedRevenue = calculateExpectedRevenue(deal.dealValue, deal.probability);
    await deal.save();

    await timelineService.record({
      action: TIMELINE_ACTIONS.DEAL_REOPENED,
      entityType: TIMELINE_ENTITY_TYPES.DEAL,
      entityId: deal._id,
      entityLabel: deal.name,
      performedBy: actor._id,
      previousValue: { stage: previousStage, probability: previousProbability },
      newValue: { stage: deal.stage, probability: deal.probability },
      metadata: { reason: payload.reason },
      ip: context.ip,
    });

    return deal.populate(DEAL_POPULATE);
  }

  async assign(id, assignedTo, actor, context = {}, { reason } = {}) {
    const deal = await this.getVisible(id, actor);

    if (deal.stage === DEAL_STAGES.WON || deal.stage === DEAL_STAGES.LOST) {
      throw ApiError.unprocessable('A closed deal cannot be reassigned');
    }

    const previous = deal.assignedTo ? String(deal.assignedTo._id ?? deal.assignedTo) : null;

    let next = null;
    if (assignedTo) {
      const assignee = await userService.assertAssignable(assignedTo, actor);
      next = String(assignee._id);
    } else if (actor.role === ROLES.SALES_EXECUTIVE) {
      throw ApiError.forbidden('Sales Executives may only assign deals to themselves');
    }

    if (previous === next) throw ApiError.unprocessable('The deal is already assigned to that user');

    deal.assignedTo = next;
    await deal.save();

    await timelineService.record({
      action: TIMELINE_ACTIONS.DEAL_ASSIGNED,
      entityType: TIMELINE_ENTITY_TYPES.DEAL,
      entityId: deal._id,
      entityLabel: deal.name,
      performedBy: actor._id,
      previousValue: { assignedTo: previous },
      newValue: { assignedTo: next },
      metadata: reason ? { reason } : {},
      ip: context.ip,
    });

    return deal.populate(DEAL_POPULATE);
  }

  async remove(id, actor, context = {}) {
    if (actor.role === ROLES.SALES_EXECUTIVE) {
      throw ApiError.forbidden('Sales Executives cannot delete deals');
    }

    const deal = await this.getVisible(id, actor);
    const activityCount = await Activity.countDocuments({
      relatedEntityType: 'DEAL',
      relatedEntityId: deal._id,
    });

    if (activityCount > 0) {
      throw ApiError.unprocessable('This deal still has associated activities and cannot be deleted', {
        details: { activities: activityCount },
      });
    }

    const snapshot = deal.toObject();
    await deal.deleteOne();

    if (deal.lead) {
      await Lead.updateOne({ _id: deal.lead }, { $set: { convertedDeal: null } });
    }

    await timelineService.record({
      action: TIMELINE_ACTIONS.DEAL_DELETED,
      entityType: TIMELINE_ENTITY_TYPES.DEAL,
      entityId: deal._id,
      entityLabel: deal.name,
      performedBy: actor._id,
      previousValue: snapshot,
      ip: context.ip,
    });

    return { id: String(deal._id) };
  }

  async listActivities(dealId, query, actor) {
    await this.getVisible(dealId, actor);

    const filter = { relatedEntityType: 'DEAL', relatedEntityId: toObjectId(dealId) };
    if (query.type) filter.type = { $in: [].concat(query.type) };
    if (query.status) filter.status = { $in: [].concat(query.status) };
    if (query.assignedTo) filter.assignedTo = toObjectId(query.assignedTo);

    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const result = await executePaginatedQuery(Activity, {
      filter,
      sort: { createdAt: -1, _id: -1 },
      page,
      limit,
      skip,
      populate: [{ path: 'assignedTo', select: 'id name email role' }],
    });

    return {
      records: result.records.map((record) => ({ ...record, derivedStatus: deriveActivityStatus(record) })),
      pagination: result.pagination,
    };
  }

  /**
   * An active deal must have a closing date in the future.
   * Closed deals keep whatever closing date they had.
   */
  assertClosingDateForStage(closingDate, stage) {
    if (!closingDate) throw ApiError.badRequest('expectedClosingDate is required');
    const date = new Date(closingDate);
    if (Number.isNaN(date.getTime())) throw ApiError.badRequest('expectedClosingDate must be a valid date');
    if (OPEN_DEAL_STAGES.includes(stage) && date.getTime() < Date.now()) {
      throw ApiError.unprocessable(
        'expectedClosingDate must be a future date for an active deal'
      );
    }
  }

  async getById(id) {
    const deal = await Deal.findById(toObjectId(id));
    if (!deal) throw ApiError.notFound('Deal not found');
    return deal;
  }
}

/**
 * Recover the probability a deal had before a stage change for the audit entry.
 */
function beforeProbability(deal, stage) {
  if (stage === DEAL_STAGES.WON) return 100;
  return deal.probability;
}

export const dealService = new DealService();
export default dealService;