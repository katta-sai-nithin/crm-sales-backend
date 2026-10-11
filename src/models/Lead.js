import mongoose from 'mongoose';
import { LEAD_SOURCES, LEAD_SOURCE_VALUES } from '../constants/lead.js';
import { LEAD_STATUSES, LEAD_STATUS_VALUES } from '../constants/lead.js';
import { LEAD_PRIORITIES, LEAD_PRIORITY_VALUES } from '../constants/lead.js';

const { Schema } = mongoose;

const leadSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: 120,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    phone: {
      type: String,
      trim: true,
      default: '',
      match: [/^[+]?[0-9\s()-]{7,20}$/, 'Please provide a valid phone number'],
    },
    company: {
      type: String,
      trim: true,
      default: '',
      maxlength: 160,
    },
    source: {
      type: String,
      enum: {
        values: LEAD_SOURCE_VALUES,
        message: 'Source must be one of: {VALUE}',
      },
      default: LEAD_SOURCES.OTHER,
    },
    status: {
      type: String,
      enum: {
        values: LEAD_STATUS_VALUES,
        message: 'Status must be one of: {VALUE}',
      },
      default: LEAD_STATUSES.NEW,
      index: true,
    },
    priority: {
      type: String,
      enum: {
        values: LEAD_PRIORITY_VALUES,
        message: 'Priority must be one of: {VALUE}',
      },
      default: LEAD_PRIORITIES.MEDIUM,
      index: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 4000,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    convertedCustomer: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      default: null,
    },
    convertedAt: {
      type: Date,
      default: null,
    },
    convertedDeal: {
      type: Schema.Types.ObjectId,
      ref: 'Deal',
      default: null,
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
 *  - `{ status, createdAt }` powers the default "hot pipeline" dashboard query.
 *  - `{ assignedTo, status }` powers the Sales Executive scoped lead list.
 *  - `{ status, priority, source, createdAt }` supports combined status/priority/
 *    source filters used by the list endpoint and the conversion report.
 */
leadSchema.index({ status: 1, createdAt: -1 });
leadSchema.index({ assignedTo: 1, status: 1, createdAt: -1 });
leadSchema.index({ status: 1, priority: 1, source: 1, createdAt: -1 });
leadSchema.index({ createdBy: 1, createdAt: -1 });
leadSchema.index({ email: 1 });
leadSchema.index({ name: 'text', company: 'text', email: 'text' });

leadSchema.virtual('id').get(function getId() {
  return this._id ? this._id.toString() : undefined;
});

leadSchema.virtual('isConverted').get(function isConverted() {
  return this.status === LEAD_STATUSES.CONVERTED;
});

export const Lead = mongoose.models.Lead || mongoose.model('Lead', leadSchema);

export default Lead;