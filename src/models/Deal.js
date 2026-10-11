import mongoose from 'mongoose';
import { DEAL_STAGES, DEAL_STAGE_VALUES, MONEY } from '../constants/deal.js';
import { calculateExpectedRevenue, roundMoney } from '../utils/money.js';

const { Schema } = mongoose;

const dealSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Deal name is required'],
      trim: true,
      minlength: [2, 'Deal name must be at least 2 characters'],
      maxlength: 160,
    },
    lead: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
      index: true,
    },
    customer: {
      type: Schema.Types.ObjectId,
      ref: 'Customer',
      required: [true, 'Customer is required'],
      index: true,
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Assigned user is required'],
      index: true,
    },
    dealValue: {
      type: Number,
      required: [true, 'Deal value is required'],
      min: [0.01, 'Deal value must be greater than zero'],
      max: [MONEY.maxAmount, `Deal value must not exceed ${MONEY.maxAmount}`],
    },
    probability: {
      type: Number,
      required: [true, 'Probability is required'],
      min: [0, 'Probability must be between 0 and 100'],
      max: [100, 'Probability must be between 0 and 100'],
    },
    expectedRevenue: {
      type: Number,
      required: true,
      min: 0,
    },
    currency: {
      type: String,
      default: MONEY.currency,
      uppercase: true,
      trim: true,
      maxlength: 3,
    },
    expectedClosingDate: {
      type: Date,
      required: [true, 'Expected closing date is required'],
      index: true,
    },
    stage: {
      type: String,
      enum: {
        values: DEAL_STAGE_VALUES,
        message: 'Stage must be one of: {VALUE}',
      },
      default: DEAL_STAGES.QUALIFICATION,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 4000,
    },
    lostReason: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1000,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    closedAt: {
      type: Date,
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
 * `expectedRevenue` is a server-controlled field: it is always recomputed from
 * `dealValue * probability / 100` before every save, so a client can never inject
 * an inconsistent forecast value.
 */
dealSchema.pre('validate', function preValidate() {
  if (this.isModified('dealValue') || this.isModified('probability') || this.isNew) {
    if (this.dealValue !== undefined && this.probability !== undefined) {
      this.dealValue = roundMoney(this.dealValue);
      this.expectedRevenue = calculateExpectedRevenue(this.dealValue, this.probability);
    }
  }

  if (this.stage === DEAL_STAGES.LOST && !this.lostReason) {
    this.invalidate('lostReason', 'A lostReason is required when a deal is marked as LOST');
  }
  if (this.stage === DEAL_STAGES.WON && !this.closedAt) {
    this.closedAt = new Date();
  }
  if (this.stage !== DEAL_STAGES.WON && this.stage !== DEAL_STAGES.LOST) {
    // An open deal must not carry a closing timestamp.
    if (!this.isModified('closedAt')) this.closedAt = null;
  }
});

/**
 * Index strategy (see README § Indexing):
 *  - `{ stage, expectedClosingDate }` powers the pipeline report and the open
 *    deals forecast.
 *  - `{ customer, createdAt }` powers `GET /customers/:id/deals`.
 *  - `{ assignedTo, stage, createdAt }` powers the Sales Executive scoped deal
 *    list and team performance aggregation.
 */
dealSchema.index({ stage: 1, expectedClosingDate: 1 });
dealSchema.index({ customer: 1, createdAt: -1 });
dealSchema.index({ assignedTo: 1, stage: 1, createdAt: -1 });
dealSchema.index({ createdBy: 1, createdAt: -1 });
dealSchema.index({ stage: 1, createdAt: -1 });
dealSchema.index({ name: 'text' });

dealSchema.virtual('id').get(function getId() {
  return this._id ? this._id.toString() : undefined;
});

dealSchema.virtual('isClosed').get(function isClosed() {
  return this.stage === DEAL_STAGES.WON || this.stage === DEAL_STAGES.LOST;
});

/**
 * Static helper: does this lead already have a deal?
 */
dealSchema.statics.existsForLead = async function existsForLead(leadId) {
  if (!leadId) return null;
  return this.exists({ lead: leadId, stage: { $ne: DEAL_STAGES.LOST } });
};

export const Deal = mongoose.models.Deal || mongoose.model('Deal', dealSchema);

export default Deal;