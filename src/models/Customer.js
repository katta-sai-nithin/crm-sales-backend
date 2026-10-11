import mongoose from 'mongoose';
import { CUSTOMER_STATUSES, CUSTOMER_STATUS_VALUES } from '../constants/customer.js';
import { CUSTOMER_ORIGINS, CUSTOMER_ORIGIN_VALUES } from '../constants/customer.js';

const { Schema } = mongoose;

const customerSchema = new Schema(
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
    address: {
      type: String,
      trim: true,
      default: '',
      maxlength: 400,
    },
    originalLead: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
      index: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: {
        values: CUSTOMER_STATUS_VALUES,
        message: 'Status must be one of: {VALUE}',
      },
      default: CUSTOMER_STATUSES.ACTIVE,
      index: true,
    },
    origin: {
      type: String,
      enum: {
        values: CUSTOMER_ORIGIN_VALUES,
        message: 'Origin must be one of: {VALUE}',
      },
      default: CUSTOMER_ORIGINS.MANUAL,
    },
    notes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 4000,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

/**
 * A customer created through lead conversion must always be linked back to its
 * originating lead, and a lead may only ever produce one customer. The unique
 * sparse index on `originalLead` enforces the "convert once" rule at the database
 * level, which protects against concurrent conversion requests.
 */
customerSchema.index(
  { originalLead: 1 },
  { unique: true, partialFilterExpression: { originalLead: { $type: 'objectId' } }, name: 'uniq_customer_per_lead' }
);
customerSchema.index({ assignedTo: 1, status: 1, createdAt: -1 });
customerSchema.index({ createdAt: -1 });
customerSchema.index({ email: 1 });
customerSchema.index({ name: 'text', company: 'text', email: 'text' });

customerSchema.virtual('id').get(function getId() {
  return this._id ? this._id.toString() : undefined;
});

export const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);

export default Customer;