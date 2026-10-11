import mongoose from 'mongoose';
import { TIMELINE_ENTITY_VALUES, TIMELINE_ACTIONS } from '../constants/timeline.js';

const { Schema } = mongoose;

/**
 * Append-only audit trail.
 *
 * The public API exposes only a read endpoint for timeline entries; there is no
 * update or delete route, so the audit history can never be rewritten through the
 * application. Pre- and post- values are restricted to a safe field allowlist by
 * the TimelineService so that no secret can ever be written here.
 */
const timelineSchema = new Schema(
  {
    action: {
      type: String,
      enum: {
        values: Object.values(TIMELINE_ACTIONS),
        message: 'Unsupported timeline action',
      },
      required: [true, 'Action is required'],
    },
    entityType: {
      type: String,
      enum: {
        values: TIMELINE_ENTITY_VALUES,
        message: 'Entity type must be one of: {VALUE}',
      },
      required: [true, 'Entity type is required'],
    },
    entityId: {
      type: Schema.Types.ObjectId,
      required: [true, 'Entity id is required'],
    },
    entityLabel: {
      type: String,
      default: '',
      maxlength: 200,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    previousValue: {
      type: Schema.Types.Mixed,
      default: null,
    },
    newValue: {
      type: Schema.Types.Mixed,
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    ip: {
      type: String,
      default: '',
      maxlength: 64,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

/**
 * Index strategy (see README § Indexing):
 *  - `{ entityType, entityId, createdAt }` is the exact access pattern of
 *    `GET /api/v1/timeline/:entityType/:entityId`.
 *  - `{ createdAt }` supports chronological reverse-chronological audit export.
 */
timelineSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });
timelineSchema.index({ performedBy: 1, createdAt: -1 });
timelineSchema.index({ action: 1, createdAt: -1 });
timelineSchema.index({ createdAt: -1 });

timelineSchema.virtual('id').get(function getId() {
  return this._id ? this._id.toString() : undefined;
});

export const Timeline = mongoose.models.Timeline || mongoose.model('Timeline', timelineSchema);

export default Timeline;