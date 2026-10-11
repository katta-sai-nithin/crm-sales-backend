import mongoose from 'mongoose';
import {
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_VALUES,
  ACTIVITY_STATUSES,
  ACTIVITY_STATUS_VALUES,
  ACTIVITY_RELATED_ENTITY_TYPES,
  ACTIVITY_RELATED_ENTITY_VALUES,
} from '../constants/activity.js';

const { Schema } = mongoose;

/**
 * Sales activity / follow-up.
 *
 * `status` is only ever persisted as PENDING or COMPLETED. The OVERDUE state is
 * *derived*: an activity that is still PENDING and whose dueDate has passed is
 * reported as OVERDUE by the read queries (see ActivityService.resolveStatus)
 * and is never resurrected once it has been completed.
 */
const activitySchema = new Schema(
  {
    type: {
      type: String,
      enum: {
        values: ACTIVITY_TYPE_VALUES,
        message: 'Type must be one of: {VALUE}',
      },
      required: [true, 'Activity type is required'],
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
      minlength: [2, 'Title must be at least 2 characters'],
      maxlength: 160,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 4000,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Assigned user is required'],
      index: true,
    },
    dueDate: {
      type: Date,
      default: null,
      index: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: {
        values: ACTIVITY_STATUS_VALUES,
        message: 'Status must be one of: {VALUE}',
      },
      default: ACTIVITY_STATUSES.PENDING,
      index: true,
    },
    relatedEntityType: {
      type: String,
      enum: {
        values: ACTIVITY_RELATED_ENTITY_VALUES,
        message: 'Related entity type must be one of: {VALUE}',
      },
      required: [true, 'Related entity type is required'],
    },
    relatedEntityId: {
      type: Schema.Types.ObjectId,
      required: [true, 'Related entity id is required'],
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

/**
 * Index strategy (see README § Indexing):
 *  - `{ assignedTo, status, dueDate }` powers the "my tasks" list and the
 *    pending / overdue dashboards.
 *  - `{ relatedEntityType, relatedEntityId, createdAt }` powers
 *    `GET /customers/:id/activities` and `GET /deals/:id/activities`.
 *  - `{ type, createdAt }` supports type-filtered activity reports.
 */
activitySchema.index({ assignedTo: 1, status: 1, dueDate: 1 });
activitySchema.index({ relatedEntityType: 1, relatedEntityId: 1, createdAt: -1 });
activitySchema.index({ type: 1, createdAt: -1 });
activitySchema.index({ status: 1, dueDate: 1 });
activitySchema.index({ title: 'text', description: 'text' });

activitySchema.virtual('id').get(function getId() {
  return this._id ? this._id.toString() : undefined;
});

activitySchema.virtual('relatedEntityLabel').get(function relatedEntityLabel() {
  return `${this.relatedEntityType}:${this.relatedEntityId}`;
});

activitySchema.virtual('isOverdue').get(function isOverdue() {
  return this.status !== ACTIVITY_STATUSES.COMPLETED && this.dueDate && this.dueDate < new Date();
});

/**
 * A completed activity must always carry a completion timestamp and can never be
 * marked as overdue again.
 */
activitySchema.pre('save', function preSave() {
  if (this.status === ACTIVITY_STATUSES.COMPLETED && !this.completedAt) {
    this.completedAt = new Date();
  }
});

export const Activity = mongoose.models.Activity || mongoose.model('Activity', activitySchema);

export { ACTIVITY_TYPES, ACTIVITY_RELATED_ENTITY_TYPES };
export default Activity;