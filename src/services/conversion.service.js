import mongoose from 'mongoose';
import { Lead } from '../models/Lead.js';
import { Customer } from '../models/Customer.js';
import { Deal } from '../models/Deal.js';
import { LEAD_STATUSES } from '../constants/lead.js';
import { CUSTOMER_ORIGINS } from '../constants/customer.js';
import { DEAL_STAGES } from '../constants/deal.js';
import { ApiError } from '../utils/ApiError.js';
import { toObjectId } from '../utils/objectId.js';
import { calculateExpectedRevenue, roundMoney } from '../utils/money.js';
import logger from '../config/logger.js';
import { timelineService } from './timeline.service.js';
import { TIMELINE_ACTIONS, TIMELINE_ENTITY_TYPES } from '../constants/timeline.js';
import { userService } from './user.service.js';
import { leadService } from './lead.service.js';

/**
 * Transaction support detection.
 *
 * MongoDB only supports multi-document transactions on a replica set or a
 * sharded cluster. When the deployment does not support them we refuse to run the
 * conversion rather than silently performing a non-atomic write.
 */
let transactionSupport;

export async function supportsTransactions() {
  if (transactionSupport !== undefined) return transactionSupport;
  try {
    const admin = mongoose.connection.db.admin();
    const info = await admin.command({ hello: 1 });
    transactionSupport = Boolean(info.setName) || info.msg === 'isdbgrid';
  } catch (error) {
    logger.warn(`Unable to determine transaction support: ${error.message}`);
    transactionSupport = false;
  }
  if (!transactionSupport) {
    logger.warn(
      'MongoDB transactions are not supported by this deployment (standalone server?). ' +
        'Lead conversion will be rejected. Use a replica set or a sharded cluster.'
    );
  }
  return transactionSupport;
}

/**
 * Run `work` inside a transaction, retrying transient transaction errors.
 */
export async function runInTransaction(work, { maxRetries = 3 } = {}) {
  const session = await mongoose.startSession();
  try {
    let attempt = 0;
    for (;;) {
      try {
        let result;
        await session.withTransaction(
          async () => {
            result = await work(session);
          },
          {
            readConcern: { level: 'snapshot' },
            writeConcern: { w: 'majority' },
            readPreference: 'primary',
          }
        );
        return result;
      } catch (error) {
        // Transient errors (write conflicts, transient transaction errors) are safe
        // to retry because the whole transaction is rolled back before the retry.
        const transient =
          error?.hasErrorLabel?.('TransientTransactionError') || error?.code === 251;
        attempt += 1;
        if (!transient || attempt >= maxRetries) throw error;
        logger.warn(`Retrying transaction after transient error (attempt ${attempt})`);
      }
    }
  } finally {
    await session.endSession();
  }
}

/**
 * Lead conversion: QUALIFIED lead -> Customer + initial Deal.
 *
 * Concurrency control strategy (three layers):
 *  1. A conditional atomic update (`findOneAndUpdate` with
 *     `{ _id, status: QUALIFIED, convertedCustomer: null }`) is the single point
 *     of truth. Exactly one concurrent request can win; the losers get 409.
 *  2. A unique partial index on `customers.originalLead` makes a second customer
 *     for the same lead impossible at the storage layer.
 *  3. The whole operation runs in a MongoDB transaction so a failure in any step
 *     leaves no orphaned customer or deal behind.
 *
 * The conditional update is performed FIRST inside the transaction: that way a
 * losing concurrent transaction fails its update (and therefore the whole
 * transaction) instead of failing later with a non-descriptive error.
 */
export const convertLead = async (leadId, payload, actor, context = {}) => {
  const leadObjectId = toObjectId(leadId);
  if (!leadObjectId) throw ApiError.badRequest('Invalid lead id');

  if (!(await supportsTransactions())) {
    throw ApiError.serviceUnavailable(
      'Lead conversion requires MongoDB transactions, which this deployment does not support. ' +
        'Run MongoDB as a replica set or use a sharded cluster.'
    );
  }

  // --- Pre-flight validation (no writes) -----------------------------------
  const lead = await Lead.findById(leadObjectId);
  if (!lead) throw ApiError.notFound('Lead not found');

  // Visibility: the actor must be able to see (and therefore convert) the lead.
  await leadService.getVisible(leadId, actor);

  if (lead.convertedCustomer || lead.status === LEAD_STATUSES.CONVERTED) {
    throw ApiError.conflict('This lead has already been converted into a customer');
  }

  if (lead.status !== LEAD_STATUSES.QUALIFIED) {
    throw ApiError.unprocessable(
      `Only a QUALIFIED lead can be converted. This lead is in status ${lead.status}.`,
      { details: { currentStatus: lead.status, requiredStatus: LEAD_STATUSES.QUALIFIED } }
    );
  }

  const assigneeId = payload.assignedTo
    ? (await userService.assertAssignable(payload.assignedTo, actor))._id
    : lead.assignedTo || actor._id;

  if (!assigneeId) {
    throw ApiError.unprocessable(
      'A converted deal must have an owner. Assign the lead before converting it.'
    );
  }

  const stage = payload.stage || DEAL_STAGES.QUALIFICATION;
  const closingDate = new Date(payload.expectedClosingDate);
  if (Number.isNaN(closingDate.getTime())) {
    throw ApiError.badRequest('expectedClosingDate must be a valid date');
  }
  if (closingDate.getTime() < Date.now()) {
    throw ApiError.unprocessable('expectedClosingDate must be a future date for a newly created deal');
  }

  const dealValue = roundMoney(payload.dealValue);

  // --- Atomic, transactional write ----------------------------------------
  const result = await runInTransaction(async (session) => {
    // 1. Claim the lead atomically. This is the concurrency gate.
    const claimed = await Lead.findOneAndUpdate(
      {
        _id: leadObjectId,
        status: LEAD_STATUSES.QUALIFIED,
        convertedCustomer: null,
      },
      {
        $set: {
          status: LEAD_STATUSES.CONVERTED,
          convertedAt: new Date(),
          // Customer / deal ids are attached after they are created below.
        },
      },
      { returnDocument: 'after', session }
    );

    if (!claimed) {
      // Someone else converted this lead between the read and the write.
      throw ApiError.conflict(
        'This lead has already been converted by another request'
      );
    }

    // 2. Create the customer, referencing its original lead.
    const [customer] = await Customer.create(
      [
        {
          name: lead.name,
          email: lead.email,
          phone: lead.phone,
          company: lead.company,
          address: '',
          originalLead: lead._id,
          assignedTo: assigneeId,
          status: 'ACTIVE',
          origin: CUSTOMER_ORIGINS.CONVERTED,
        },
      ],
      { session }
    );

    // 3. Create the initial deal, referencing both the customer and the lead.
    const [deal] = await Deal.create(
      [
        {
          name: payload.dealName,
          lead: lead._id,
          customer: customer._id,
          assignedTo: assigneeId,
          dealValue,
          probability: payload.probability,
          expectedRevenue: calculateExpectedRevenue(dealValue, payload.probability),
          expectedClosingDate: closingDate,
          stage,
          description: payload.description || '',
          lostReason: '',
          createdBy: actor._id,
          closedAt: null,
        },
      ],
      { session }
    );

    // 4. Link the customer and deal back onto the lead.
    await Lead.updateOne(
      { _id: lead._id },
      { $set: { convertedCustomer: customer._id, convertedDeal: deal._id } },
      { session }
    );

    // 5. Audit entries, committed inside the same transaction.
    await timelineService.record(
      {
        action: TIMELINE_ACTIONS.CUSTOMER_CREATED,
        entityType: TIMELINE_ENTITY_TYPES.CUSTOMER,
        entityId: customer._id,
        entityLabel: customer.name,
        performedBy: actor._id,
        newValue: customer,
        metadata: { origin: CUSTOMER_ORIGINS.CONVERTED, lead: String(lead._id) },
        ip: context.ip,
      },
      { session }
    );

    await timelineService.record(
      {
        action: TIMELINE_ACTIONS.DEAL_CREATED,
        entityType: TIMELINE_ENTITY_TYPES.DEAL,
        entityId: deal._id,
        entityLabel: deal.name,
        performedBy: actor._id,
        newValue: deal,
        metadata: { customer: String(customer._id), stage: deal.stage },
        ip: context.ip,
      },
      { session }
    );

    await timelineService.record(
      {
        action: TIMELINE_ACTIONS.LEAD_CONVERTED,
        entityType: TIMELINE_ENTITY_TYPES.LEAD,
        entityId: lead._id,
        entityLabel: lead.name,
        performedBy: actor._id,
        previousValue: { status: LEAD_STATUSES.QUALIFIED, convertedCustomer: null },
        newValue: { status: LEAD_STATUSES.CONVERTED },
        metadata: { customer: String(customer._id), deal: String(deal._id), dealValue },
        ip: context.ip,
      },
      { session }
    );

    await timelineService.record(
      {
        action: TIMELINE_ACTIONS.LEAD_STATUS_CHANGED,
        entityType: TIMELINE_ENTITY_TYPES.LEAD,
        entityId: lead._id,
        entityLabel: lead.name,
        performedBy: actor._id,
        previousValue: { status: LEAD_STATUSES.QUALIFIED },
        newValue: { status: LEAD_STATUSES.CONVERTED },
        metadata: { source: 'conversion' },
        ip: context.ip,
      },
      { session }
    );

    return { customer, deal, lead: claimed };
  });

  const [createdCustomer, createdDeal, updatedLead] = await Promise.all([
    Customer.findById(result.customer._id).populate('assignedTo', 'id name email role'),
    Deal.findById(result.deal._id).populate([
      { path: 'customer', select: 'id name email company' },
      { path: 'lead', select: 'id name email status' },
      { path: 'assignedTo', select: 'id name email role' },
    ]),
    // Re-read so the response reflects the final state, including the customer
    // and deal back-references written at the end of the transaction.
    Lead.findById(result.lead._id),
  ]);

  return { customer: createdCustomer, deal: createdDeal, lead: updatedLead };
};