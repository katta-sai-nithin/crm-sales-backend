import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import config from '../config/env.js';
import { ROLES, ROLE_VALUES } from '../constants/roles.js';

const { Schema } = mongoose;

/**
 * Optional lightweight team membership model.
 *
 * Documented assumption: a "team" is defined by a manager-to-reports
 * relationship. `members` holds the Sales Executives (and nested managers) that
 * belong to the manager's book of business. An empty array means the manager's
 * book contains only their own records. Admins are not members of any team and
 * are therefore never team-scoped.
 */
const teamSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Team name is required'],
      trim: true,
      maxlength: 120,
    },
    members: [
      {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  { timestamps: true, _id: true }
);

const userSchema = new Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [120, 'Name must be at most 120 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please provide a valid email address'],
    },
    phone: {
      type: String,
      trim: true,
      default: '',
      match: [/^[+]?[0-9\s()-]{7,20}$/, 'Please provide a valid phone number'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required'],
      select: false,
    },
    role: {
      type: String,
      enum: {
        values: ROLE_VALUES,
        message: 'Role must be one of: {VALUE}',
      },
      default: ROLES.SALES_EXECUTIVE,
      required: [true, 'Role is required'],
    },
    isActive: {
      type: Boolean,
      default: true,
      required: true,
    },
    team: {
      type: Schema.Types.ObjectId,
      ref: 'Team',
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ name: 'text', email: 'text' });

userSchema.virtual('id').get(function getId() {
  return this._id ? this._id.toString() : undefined;
});

/**
 * Hash a plain-text password with bcrypt.
 */
userSchema.statics.hashPassword = function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, config.bcrypt.saltRounds);
};

/**
 * Compare a plain-text password against the stored hash.
 */
userSchema.methods.comparePassword = function comparePassword(plainPassword) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(plainPassword, this.passwordHash);
};

/**
 * Ensure that password hashes never leak through a query that forgot to opt in
 * to the `+passwordHash` projection.
 */
userSchema.pre('save', function preSave() {
  if (this.isModified('email') && this.email) {
    this.email = this.email.trim().toLowerCase();
  }
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);
export const Team = mongoose.models.Team || mongoose.model('Team', teamSchema);

export default User;