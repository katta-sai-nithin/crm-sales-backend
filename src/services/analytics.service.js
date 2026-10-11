import { Lead } from '../models/Lead.js';
import { Customer } from '../models/Customer.js';
import { Deal } from '../models/Deal.js';
import { Activity } from '../models/Activity.js';
import { User } from '../models/User.js';
import { ROLES } from '../constants/roles.js';
import { LEAD_STATUSES } from '../constants/lead.js';
import { DEAL_STAGES, OPEN_DEAL_STAGES, MONEY } from '../constants/deal.js';
import { ACTIVITY_STATUSES } from '../constants/activity.js';
import { ApiError } from '../utils/ApiError.js';
import { toObjectId } from '../utils/objectId.js';
import { buildScopeFilter, ScopeType, buildVisibleIdSet } from './accessScope.service.js';
import { userService } from './user.service.js';

const round2 = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

/**
 * Analytics service.
 *
 * Scope rules:
 *  - ADMIN           -> system wide metrics.
 *  - SALES_MANAGER   -> their own book of business plus their team.
 *  - SALES_EXECUTIVE -> only records assigned to them.
 *
 * Everything is computed with MongoDB aggregation pipelines (a fixed number of
 * round-trips, no loading documents into Node).
 */
class AnalyticsService {
  /**
   * Translate a scope filter into aggregation `$match` stages.
   */
  async scopeMatch(actor, scopeType) {
    const scope = await buildScopeFilter(actor, scopeType);
    return Object.keys(scope).length ? [{ $match: scope }] : [];
  }

  async dateRangeStages(query, field = 'createdAt') {
    if (!query?.dateFrom && !query?.dateTo) return [];
    const range = {};
    if (query.dateFrom) range.$gte = new Date(query.dateFrom);
    if (query.dateTo) range.$lte = new Date(query.dateTo);
    return [{ $match: { [field]: range } }];
  }

  /**
   * GET /api/v1/analytics/dashboard
   */
  async dashboard(query, actor) {
    const leadStages = await this.scopeMatch(actor, ScopeType.LEAD);
    const customerStages = await this.scopeMatch(actor, ScopeType.CUSTOMER);
    const dealStages = await this.scopeMatch(actor, ScopeType.DEAL);
    const activityStages = await this.scopeMatch(actor, ScopeType.ACTIVITY);

    const dateStages = await this.dateRangeStages(query);

    const [leadAgg] = await Lead.aggregate([
      ...leadStages,
      ...dateStages,
      {
        $group: {
          _id: null,
          totalLeads: { $sum: 1 },
          newLeads: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.NEW] }, 1, 0] } },
          contactedLeads: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.CONTACTED] }, 1, 0] } },
          qualifiedLeads: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.QUALIFIED] }, 1, 0] } },
          convertedLeads: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.CONVERTED] }, 1, 0] } },
          lostLeads: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.LOST] }, 1, 0] } },
          unqualifiedLeads: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.UNQUALIFIED] }, 1, 0] } },
        },
      },
    ]);

    const [customerAgg] = await Customer.aggregate([
      ...customerStages,
      ...dateStages,
      { $group: { _id: null, totalCustomers: { $sum: 1 } } },
    ]);

    const [dealAgg] = await Deal.aggregate([
      ...dealStages,
      ...dateStages,
      {
        $group: {
          _id: null,
          totalDeals: { $sum: 1 },
          openDeals: { $sum: { $cond: [{ $in: ['$stage', OPEN_DEAL_STAGES] }, 1, 0] } },
          wonDeals: { $sum: { $cond: [{ $eq: ['$stage', DEAL_STAGES.WON] }, 1, 0] } },
          lostDeals: { $sum: { $cond: [{ $eq: ['$stage', DEAL_STAGES.LOST] }, 1, 0] } },
          totalDealValue: { $sum: '$dealValue' },
          wonRevenue: { $sum: { $cond: [{ $eq: ['$stage', DEAL_STAGES.WON] }, '$dealValue', 0] } },
          openExpectedRevenue: {
            $sum: { $cond: [{ $in: ['$stage', OPEN_DEAL_STAGES] }, '$expectedRevenue', 0] },
          },
          totalExpectedRevenue: { $sum: '$expectedRevenue' },
          averageDealValue: { $avg: '$dealValue' },
          averageProbability: { $avg: '$probability' },
        },
      },
    ]);

    const now = new Date();
    const [activityAgg] = await Activity.aggregate([
      ...activityStages,
      ...dateStages,
      {
        $group: {
          _id: null,
          totalActivities: { $sum: 1 },
          pendingActivities: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ['$status', ACTIVITY_STATUSES.COMPLETED] },
                    { $or: [{ $eq: [{ $type: '$dueDate' }, 'missing'] }, { $gte: ['$dueDate', now] }] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          overdueActivities: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$status', ACTIVITY_STATUSES.COMPLETED] }, { $lt: ['$dueDate', now] }] },
                1,
                0,
              ],
            },
          },
          completedActivities: { $sum: { $cond: [{ $eq: ['$status', ACTIVITY_STATUSES.COMPLETED] }, 1, 0] } },
        },
      },
    ]);

    const leads = leadAgg || {
      totalLeads: 0,
      newLeads: 0,
      contactedLeads: 0,
      qualifiedLeads: 0,
      convertedLeads: 0,
      lostLeads: 0,
      unqualifiedLeads: 0,
    };
    const customers = customerAgg || { totalCustomers: 0 };
    const deals = dealAgg || {
      totalDeals: 0,
      openDeals: 0,
      wonDeals: 0,
      lostDeals: 0,
      totalDealValue: 0,
      wonRevenue: 0,
      openExpectedRevenue: 0,
      totalExpectedRevenue: 0,
      averageDealValue: 0,
      averageProbability: 0,
    };
    const activities = activityAgg || {
      totalActivities: 0,
      pendingActivities: 0,
      overdueActivities: 0,
      completedActivities: 0,
    };

    // Conversion rate definition:
    //   converted leads / eligible leads x 100
    // An "eligible" lead is one that reached at least the QUALIFIED stage, i.e.
    // it is currently QUALIFIED, CONVERTED, LOST or UNQUALIFIED (anything that
    // already went past the CONTACTED step).
    const eligibleLeads =
      leads.qualifiedLeads + leads.convertedLeads + leads.lostLeads + leads.unqualifiedLeads;

    return {
      scope: actor.role,
      currency: MONEY.currency,
      leads: {
        total: leads.totalLeads,
        new: leads.newLeads,
        contacted: leads.contactedLeads,
        qualified: leads.qualifiedLeads,
        converted: leads.convertedLeads,
        unqualified: leads.unqualifiedLeads,
        lost: leads.lostLeads,
        eligible: eligibleLeads,
        conversionRate: computeConversionRate(leads.convertedLeads, eligibleLeads),
      },
      customers: { total: customers.totalCustomers },
      deals: {
        total: deals.totalDeals,
        open: deals.openDeals,
        won: deals.wonDeals,
        lost: deals.lostDeals,
        totalValue: round2(deals.totalDealValue || 0),
        wonRevenue: round2(deals.wonRevenue || 0),
        openExpectedRevenue: round2(deals.openExpectedRevenue || 0),
        weightedPipeline: round2(deals.totalExpectedRevenue || 0),
        averageDealValue: round2(deals.averageDealValue || 0),
        averageProbability: round2(deals.averageProbability || 0),
        winRate: computeConversionRate(deals.wonDeals, deals.wonDeals + deals.lostDeals),
      },
      activities: {
        total: activities.totalActivities,
        pending: activities.pendingActivities,
        overdue: activities.overdueActivities,
        completed: activities.completedActivities,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * GET /api/v1/analytics/pipeline
   */
  async pipeline(query, actor) {
    const scope = await buildScopeFilter(actor, ScopeType.DEAL);
    const dateStages = await this.dateRangeStages(query);

    const rows = await Deal.aggregate([
      ...(Object.keys(scope).length ? [{ $match: scope }] : []),
      ...dateStages,
      {
        $group: {
          _id: '$stage',
          count: { $sum: 1 },
          totalValue: { $sum: '$dealValue' },
          expectedRevenue: { $sum: '$expectedRevenue' },
          averageValue: { $avg: '$dealValue' },
          averageProbability: { $avg: '$probability' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const byStage = new Map(rows.map((row) => [row._id, row]));
    const stages = Object.values(DEAL_STAGES).map((stage) => {
      const row = byStage.get(stage);
      return {
        stage,
        count: row?.count ?? 0,
        totalValue: round2(row?.totalValue ?? 0),
        expectedRevenue: round2(row?.expectedRevenue ?? 0),
        averageValue: round2(row?.averageValue ?? 0),
        averageProbability: round2(row?.averageProbability ?? 0),
        isOpen: OPEN_DEAL_STAGES.includes(stage),
      };
    });

    const openStages = stages.filter((stage) => stage.isOpen);

    return {
      currency: MONEY.currency,
      stages,
      totals: {
        dealCount: stages.reduce((sum, stage) => sum + stage.count, 0),
        totalValue: round2(stages.reduce((sum, stage) => sum + stage.totalValue, 0)),
        openDealCount: openStages.reduce((sum, stage) => sum + stage.count, 0),
        openTotalValue: round2(openStages.reduce((sum, stage) => sum + stage.totalValue, 0)),
        openExpectedRevenue: round2(openStages.reduce((sum, stage) => sum + stage.expectedRevenue, 0)),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * GET /api/v1/analytics/team-performance
   *
   * ADMIN: may pass ?team=<id> to select one team, otherwise all teams are
   * reported. SALES_MANAGER: always restricted to their own team.
   * SALES_EXECUTIVE: not permitted (403).
   */
  async teamPerformance(query, actor) {
    if (actor.role === ROLES.SALES_EXECUTIVE) {
      throw ApiError.forbidden('Team performance is only available to administrators and sales managers');
    }

    const userFilter = { isActive: true, role: { $in: [ROLES.SALES_MANAGER, ROLES.SALES_EXECUTIVE] } };
    if (actor.role === ROLES.SALES_MANAGER) {
      // Aggregation pipelines are not cast by Mongoose, so the ids are converted
      // to real ObjectIds here.
      userFilter._id = {
        $in: (await userService.getTeamScopeIds(actor))
          .map((id) => toObjectId(id))
          .filter(Boolean),
      };
    } else if (query.team) {
      userFilter.team = toObjectId(query.team);
    }

    const rows = await User.aggregate([
      { $match: userFilter },
      {
        $lookup: {
          from: 'leads',
          let: { userId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$assignedTo', '$$userId'] } } },
            {
              $group: {
                _id: null,
                assignedLeads: { $sum: 1 },
                convertedLeads: {
                  $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.CONVERTED] }, 1, 0] },
                },
                qualifiedLeads: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.QUALIFIED] }, 1, 0] } },
              },
            },
          ],
          as: 'leadStats',
        },
      },
      {
        $lookup: {
          from: 'deals',
          let: { userId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$assignedTo', '$$userId'] } } },
            {
              $group: {
                _id: null,
                openDeals: {
                  $sum: { $cond: [{ $in: ['$stage', OPEN_DEAL_STAGES] }, 1, 0] },
                },
                wonDeals: { $sum: { $cond: [{ $eq: ['$stage', DEAL_STAGES.WON] }, 1, 0] } },
                lostDeals: { $sum: { $cond: [{ $eq: ['$stage', DEAL_STAGES.LOST] }, 1, 0] } },
                wonRevenue: { $sum: { $cond: [{ $eq: ['$stage', DEAL_STAGES.WON] }, '$dealValue', 0] } },
                openExpectedRevenue: {
                  $sum: { $cond: [{ $in: ['$stage', OPEN_DEAL_STAGES] }, '$expectedRevenue', 0] },
                },
              },
            },
          ],
          as: 'dealStats',
        },
      },
      {
        $lookup: {
          from: 'activities',
          let: { userId: '$_id' },
          pipeline: [
            { $match: { $expr: { $eq: ['$assignedTo', '$$userId'] } } },
            {
              $group: {
                _id: null,
                pendingActivities: {
                  $sum: { $cond: [{ $ne: ['$status', ACTIVITY_STATUSES.COMPLETED] }, 1, 0] },
                },
                completedActivities: { $sum: { $cond: [{ $eq: ['$status', ACTIVITY_STATUSES.COMPLETED] }, 1, 0] } },
              },
            },
          ],
          as: 'activityStats',
        },
      },
      { $unwind: { path: '$leadStats', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$dealStats', preserveNullAndEmptyArrays: true } },
      { $unwind: { path: '$activityStats', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          name: 1,
          email: 1,
          role: 1,
          team: 1,
          assignedLeads: { $ifNull: ['$leadStats.assignedLeads', 0] },
          convertedLeads: { $ifNull: ['$leadStats.convertedLeads', 0] },
          qualifiedLeads: { $ifNull: ['$leadStats.qualifiedLeads', 0] },
          openDeals: { $ifNull: ['$dealStats.openDeals', 0] },
          wonDeals: { $ifNull: ['$dealStats.wonDeals', 0] },
          lostDeals: { $ifNull: ['$dealStats.lostDeals', 0] },
          wonRevenue: { $round: [{ $ifNull: ['$dealStats.wonRevenue', 0] }, 2] },
          openExpectedRevenue: { $round: [{ $ifNull: ['$dealStats.openExpectedRevenue', 0] }, 2] },
          pendingActivities: { $ifNull: ['$activityStats.pendingActivities', 0] },
          completedActivities: { $ifNull: ['$activityStats.completedActivities', 0] },
        },
      },
      { $sort: { wonRevenue: -1, name: 1 } },
    ]);

    const team = rows.map((row) => ({
      userId: String(row._id),
      name: row.name,
      email: row.email,
      role: row.role,
      team: row.team ? String(row.team) : null,
      assignedLeads: row.assignedLeads,
      convertedLeads: row.convertedLeads,
      qualifiedLeads: row.qualifiedLeads,
      openDeals: row.openDeals,
      wonDeals: row.wonDeals,
      lostDeals: row.lostDeals,
      wonRevenue: round2(row.wonRevenue),
      openExpectedRevenue: round2(row.openExpectedRevenue),
      pendingActivities: row.pendingActivities,
      completedActivities: row.completedActivities,
      leadConversionRate: computeConversionRate(row.convertedLeads, row.assignedLeads),
      dealWinRate: computeConversionRate(row.wonDeals, row.wonDeals + row.lostDeals),
    }));

    const totals = team.reduce(
      (acc, member) => {
        acc.assignedLeads += member.assignedLeads;
        acc.convertedLeads += member.convertedLeads;
        acc.openDeals += member.openDeals;
        acc.wonDeals += member.wonDeals;
        acc.lostDeals += member.lostDeals;
        acc.wonRevenue = round2(acc.wonRevenue + member.wonRevenue);
        acc.openExpectedRevenue = round2(acc.openExpectedRevenue + member.openExpectedRevenue);
        acc.pendingActivities += member.pendingActivities;
        return acc;
      },
      {
        assignedLeads: 0,
        convertedLeads: 0,
        openDeals: 0,
        wonDeals: 0,
        lostDeals: 0,
        wonRevenue: 0,
        openExpectedRevenue: 0,
        pendingActivities: 0,
      }
    );

    return {
      currency: MONEY.currency,
      scope: actor.role,
      memberCount: team.length,
      team,
      totals: {
        ...totals,
        leadConversionRate: computeConversionRate(totals.convertedLeads, totals.assignedLeads),
        dealWinRate: computeConversionRate(totals.wonDeals, totals.wonDeals + totals.lostDeals),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Lead source performance - a small extra report used by the dashboard UI.
   */
  async leadSources(query, actor) {
    const scope = await buildScopeFilter(actor, ScopeType.LEAD);
    const dateStages = await this.dateRangeStages(query);

    const rows = await Lead.aggregate([
      ...(Object.keys(scope).length ? [{ $match: scope }] : []),
      ...dateStages,
      {
        $group: {
          _id: '$source',
          total: { $sum: 1 },
          qualified: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.QUALIFIED] }, 1, 0] } },
          converted: { $sum: { $cond: [{ $eq: ['$status', LEAD_STATUSES.CONVERTED] }, 1, 0] } },
        },
      },
      { $sort: { total: -1 } },
    ]);

    return rows.map((row) => ({
      source: row._id,
      total: row.total,
      qualified: row.qualified,
      converted: row.converted,
      conversionRate: computeConversionRate(row.converted, row.total),
    }));
  }

  /**
   * Ids a Sales Executive may see - used by the activity service to validate
   * related entities in one call.
   */
  static async visibleIds(actor) {
    return buildVisibleIdSet(actor);
  }
}

/**
 * Conversion / win rate in percent, safe for a zero denominator.
 */
export function computeConversionRate(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round(((Number(numerator) / Number(denominator)) * 100 + Number.EPSILON) * 100) / 100;
}

export const analyticsService = new AnalyticsService();
export default analyticsService;