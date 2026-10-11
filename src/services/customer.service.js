import { Customer } from '../models/Customer.js';
import { Deal } from '../models/Deal.js';
import { Activity } from '../models/Activity.js';
import { ROLES } from '../constants/roles.js';
import { CUSTOMER_ORIGINS } from '../constants/customer.js';
import { ApiError } from '../utils/ApiError.js';
import { toObjectId } from '../utils/objectId.js';
import { buildSearchRegex } from '../utils/sanitize.js';
import { executePaginatedQuery } from '../utils/query.js';
import { buildScopeFilter, ScopeType } from './accessScope.service.js';
import { timelineService } from './timeline.service.js';
import { TIMELINE_ACTIONS, TIMELINE_ENTITY_TYPES } from '../constants/timeline.js';
import { userService } from './user.service.js';
import { deriveActivityStatus } from './activity.service.js';

const CUSTOMER_POPULATE = [
  { path: 'assignedTo', select: 'id name email role isActive' },
  { path: 'originalLead', select: 'id name email source status' },
];

class CustomerService {
  async buildListFilter(query, actor) {
    const scope = await buildScopeFilter(actor, ScopeType.CUSTOMER);
    const and = [];

    if (query.status) and.push({ status: { $in: [].concat(query.status) } });
    if (query.origin) and.push({ origin: { $in: [].concat(query.origin) } });
    if (query.assignedTo) and.push({ assignedTo: toObjectId(query.assignedTo) });
    if (query.originalLead) and.push({ originalLead: toObjectId(query.originalLead) });

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

    return { $and: [scope, ...(and.length ? [{ $and: and }] : [])] };
  }

  async list(query, actor) {
    const filter = await this.buildListFilter(query, actor);
    const sort = { [query.sortBy || 'createdAt']: query.sortOrder === 'asc' ? 1 : -1, _id: -1 };
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    return executePaginatedQuery(Customer, {
      filter,
      sort,
      page,
      limit,
      skip,
      populate: CUSTOMER_POPULATE,
    });
  }

  async getVisible(id, actor) {
    const customer = await Customer.findById(toObjectId(id)).populate(CUSTOMER_POPULATE);
    if (!customer) throw ApiError.notFound('Customer not found');

    const visible = await buildScopeFilter(actor, ScopeType.CUSTOMER);
    if (Object.keys(visible).length) {
      const scoped = await Customer.findOne({ _id: customer._id, ...visible }).select('_id').lean();
      if (!scoped) throw ApiError.notFound('Customer not found');
    }

    return customer;
  }

  /**
   * Create a customer manually.
   *
   * Difference from a converted customer (see README § Business rules):
   *  - origin = MANUAL, `originalLead` is null;
   *  - creation is allowed for ADMIN and SALES_MANAGER only. A Sales Executive
   *    may still create a customer, but only from their own converted lead
   *    inventory - which is not a valid flow, so the role is rejected.
   */
  async create(payload, actor, context = {}, { session = null } = {}) {
    if (actor.role === ROLES.SALES_EXECUTIVE) {
      throw ApiError.forbidden(
        'Sales Executives cannot create customers directly; convert a qualified lead instead'
      );
    }

    let assignedTo = null;
    if (payload.assignedTo) {
      const assignee = await userService.assertAssignable(payload.assignedTo, actor);
      assignedTo = assignee._id;
    } else {
      assignedTo = actor._id;
    }

    const customer = await Customer.create(
      [
        {
          name: payload.name,
          email: payload.email,
          phone: payload.phone ?? '',
          company: payload.company ?? '',
          address: payload.address ?? '',
          notes: payload.notes ?? '',
          status: payload.status ?? 'ACTIVE',
          origin: CUSTOMER_ORIGINS.MANUAL,
          originalLead: null,
          assignedTo,
        },
      ],
      session ? { session } : {}
    );

    const created = customer[0];

    await timelineService.record(
      {
        action: TIMELINE_ACTIONS.CUSTOMER_CREATED,
        entityType: TIMELINE_ENTITY_TYPES.CUSTOMER,
        entityId: created._id,
        entityLabel: created.name,
        performedBy: actor._id,
        newValue: created,
        metadata: { origin: CUSTOMER_ORIGINS.MANUAL },
        ip: context.ip,
      },
      { session }
    );

    return created.populate(CUSTOMER_POPULATE);
  }

  async update(id, payload, actor, context = {}) {
    const customer = await this.getVisible(id, actor);

    if (actor.role === ROLES.SALES_EXECUTIVE) {
      const allowed = ['notes'];
      const attempted = Object.keys(payload).filter((key) => !allowed.includes(key));
      if (attempted.length) {
        throw ApiError.forbidden(
          `Sales Executives may only update: ${allowed.join(', ')}`
        );
      }
    }

    const before = customer.toObject();
    const allowedFields = ['name', 'email', 'phone', 'company', 'address', 'status', 'notes'];
    let changed = false;

    for (const field of allowedFields) {
      if (payload[field] !== undefined) {
        customer[field] = payload[field];
        changed = true;
      }
    }

    if (!changed) throw ApiError.badRequest('No updatable fields were provided');

    await customer.save();

    await timelineService.recordChanges({
      action: TIMELINE_ACTIONS.CUSTOMER_UPDATED,
      entityType: TIMELINE_ENTITY_TYPES.CUSTOMER,
      entityId: customer._id,
      entityLabel: customer.name,
      performedBy: actor._id,
      before,
      after: customer.toObject(),
      metadata: {},
      ip: context.ip,
    });

    return customer.populate(CUSTOMER_POPULATE);
  }

  /**
   * Reassign a customer (ADMIN and managers only).
   */
  async assign(id, assignedTo, actor, context = {}) {
    if (actor.role === ROLES.SALES_EXECUTIVE) {
      throw ApiError.forbidden('Sales Executives cannot reassign customers');
    }
    const customer = await this.getVisible(id, actor);
    const previous = customer.assignedTo ? String(customer.assignedTo._id ?? customer.assignedTo) : null;

    let next = null;
    if (assignedTo) {
      const assignee = await userService.assertAssignable(assignedTo, actor);
      next = String(assignee._id);
    }
    if (previous === next) throw ApiError.unprocessable('The customer is already assigned to that user');

    customer.assignedTo = next;
    await customer.save();

    await timelineService.record({
      action: TIMELINE_ACTIONS.CUSTOMER_ASSIGNED,
      entityType: TIMELINE_ENTITY_TYPES.CUSTOMER,
      entityId: customer._id,
      entityLabel: customer.name,
      performedBy: actor._id,
      previousValue: { assignedTo: previous },
      newValue: { assignedTo: next },
      ip: context.ip,
    });

    return customer.populate(CUSTOMER_POPULATE);
  }

  /**
   * Delete a customer.
   *
   * A customer that owns deals or has activities is never deleted: those records
   * would be orphaned. The caller must handle them explicitly first.
   */
  async remove(id, actor, context = {}) {
    if (actor.role === ROLES.SALES_EXECUTIVE) {
      throw ApiError.forbidden('Sales Executives cannot delete customers');
    }

    const customer = await this.getVisible(id, actor);
    const customerId = customer._id;

    const [dealCount, activityCount] = await Promise.all([
      Deal.countDocuments({ customer: customerId }),
      Activity.countDocuments({ relatedEntityType: 'CUSTOMER', relatedEntityId: customerId }),
    ]);

    if (dealCount > 0 || activityCount > 0) {
      throw ApiError.unprocessable(
        'This customer still has associated deals or activities and cannot be deleted',
        { details: { deals: dealCount, activities: activityCount } }
      );
    }

    if (customer.originalLead) {
      const { Lead } = await import('../models/Lead.js');
      await Lead.updateOne(
        { _id: customer.originalLead, convertedCustomer: customerId },
        { $set: { convertedCustomer: null, convertedAt: null } }
      );
    }

    const snapshot = customer.toObject();
    await customer.deleteOne();

    await timelineService.record({
      action: TIMELINE_ACTIONS.CUSTOMER_DELETED,
      entityType: TIMELINE_ENTITY_TYPES.CUSTOMER,
      entityId: customer._id,
      entityLabel: customer.name,
      performedBy: actor._id,
      previousValue: snapshot,
      ip: context.ip,
    });

    return { id: String(customer._id) };
  }

  async listDeals(customerId, query, actor) {
    await this.getVisible(customerId, actor);

    const filter = { customer: toObjectId(customerId) };
    if (query.stage) filter.stage = { $in: [].concat(query.stage) };
    if (query.minValue !== undefined) filter.dealValue = { $gte: query.minValue };
    if (query.maxValue !== undefined) {
      filter.dealValue = { ...(filter.dealValue || {}), $lte: query.maxValue };
    }

    const sort = { [query.sortBy || 'createdAt']: query.sortOrder === 'asc' ? 1 : -1, _id: -1 };
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const result = await executePaginatedQuery(Deal, {
      filter,
      sort,
      page,
      limit,
      skip,
      populate: [{ path: 'assignedTo', select: 'id name email role' }],
    });

    return result;
  }

  async listActivities(customerId, query, actor) {
    await this.getVisible(customerId, actor);

    const filter = { relatedEntityType: 'CUSTOMER', relatedEntityId: toObjectId(customerId) };
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

  async getById(id) {
    const customer = await Customer.findById(toObjectId(id));
    if (!customer) throw ApiError.notFound('Customer not found');
    return customer;
  }
}

export const customerService = new CustomerService();
export default customerService;