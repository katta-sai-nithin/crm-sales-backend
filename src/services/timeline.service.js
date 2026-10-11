import mongoose from 'mongoose';
import { Timeline } from '../models/Timeline.js';
import { TIMELINE_SAFE_FIELDS } from '../constants/timeline.js';
import { idOf } from '../utils/sanitize.js';
import { executePaginatedQuery } from '../utils/query.js';

/**
 * Append-only audit trail writer.
 *
 * Every method accepts an optional `session` so that business writes and their
 * corresponding audit entries are committed inside the same MongoDB transaction.
 */
class TimelineService {
  /**
   * Reduce a value to a safe, JSON serialisable snapshot.
   * Only allow-listed fields are kept, which guarantees that a password, a token
   * or any other secret can never be persisted in the audit trail.
   */
  sanitizeValue(value) {
    if (value === null || value === undefined) return null;
    const source = typeof value === 'object' && typeof value.toObject === 'function' ? value.toObject() : value;

    if (source === null || typeof source !== 'object' || Array.isArray(source)) return null;

    const safe = {};
    for (const field of TIMELINE_SAFE_FIELDS) {
      if (!(field in source)) continue;
      const fieldValue = source[field];
      if (fieldValue === undefined) continue;
      safe[field] = idOf(fieldValue);
      if (safe[field] === null) delete safe[field];
    }
    return Object.keys(safe).length ? safe : null;
  }

  /**
   * Redact metadata: only JSON-safe primitive values survive.
   */
  sanitizeMetadata(metadata = {}) {
    if (!metadata || typeof metadata !== 'object') return {};
    const safe = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (/password|token|secret|hash|authorization/i.test(key)) continue;
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        safe[key] = typeof value === 'string' ? value.slice(0, 500) : value;
      } else {
        const asId = idOf(value);
        if (asId) safe[key] = asId;
      }
    }
    return safe;
  }

  /**
   * Record a single timeline event.
   */
  async record(
    {
      action,
      entityType,
      entityId,
      entityLabel = '',
      performedBy = null,
      previousValue = null,
      newValue = null,
      metadata = {},
      ip = '',
    },
    { session = null } = {}
  ) {
    if (!action || !entityType || !entityId) {
      // Never throw from the audit path: an invalid audit entry must not break the
      // business operation that produced it.
      return null;
    }

    const document = {
      action,
      entityType,
      entityId,
      entityLabel: String(entityLabel || '').slice(0, 200),
      performedBy: performedBy ? idOf(performedBy) : null,
      previousValue: this.sanitizeValue(previousValue),
      newValue: this.sanitizeValue(newValue),
      metadata: this.sanitizeMetadata(metadata),
      ip: String(ip || '').slice(0, 64),
    };

    const created = await Timeline.create([document], session ? { session } : {});
    return created[0];
  }

  /**
   * Convenience helper that diffs two snapshots and records only the fields that
   * actually changed.
   */
  async recordChanges(
    { action, entityType, entityId, entityLabel, performedBy, before, after, metadata, ip },
    { session = null } = {}
  ) {
    const previousSnapshot = this.sanitizeValue(before) || {};
    const newSnapshot = this.sanitizeValue(after) || {};

    const previousValue = {};
    const newValue = {};
    for (const field of TIMELINE_SAFE_FIELDS) {
      const beforeValue = previousSnapshot[field];
      const afterValue = newSnapshot[field];
      if (afterValue === undefined) continue;
      if (String(beforeValue ?? '') !== String(afterValue ?? '')) {
        if (beforeValue !== undefined) previousValue[field] = beforeValue;
        newValue[field] = afterValue;
      }
    }

    if (!Object.keys(newValue).length) return null;

    return this.record(
      {
        action,
        entityType,
        entityId,
        entityLabel,
        performedBy,
        previousValue: Object.keys(previousValue).length ? previousValue : null,
        newValue,
        metadata,
        ip,
      },
      { session }
    );
  }

  /**
   * Read the timeline of a specific entity (paged).
   */
  async list({ entityType, entityId, limit, skip, action, sort }) {
    const filter = { entityType, entityId: new mongoose.Types.ObjectId(String(entityId)) };
    if (action) filter.action = action;

    const { records, pagination } = await executePaginatedQuery(Timeline, {
      filter,
      sort: sort || { createdAt: -1, _id: -1 },
      page: (skip ?? 0) / (limit || 1) + 1,
      limit,
      skip,
    });

    return { records, totalRecords: pagination.totalRecords };
  }
}

export const timelineService = new TimelineService();
export default timelineService;