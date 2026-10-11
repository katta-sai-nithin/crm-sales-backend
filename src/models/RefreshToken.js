import mongoose from 'mongoose';
import crypto from 'node:crypto';

const { Schema } = mongoose;

/**
 * Refresh token session store.
 *
 * Only a SHA-256 hash of the refresh token is persisted, never the token itself,
 * so a database leak cannot be replayed against the API. Each token belongs to a
 * "family" (chain) that is revoked as a whole when a reused token is detected.
 */
const refreshTokenSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      select: false,
    },
    familyId: {
      type: String,
      required: true,
      index: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedReason: {
      type: String,
      default: null,
    },
    replacedByTokenHash: {
      type: String,
      default: null,
      select: false,
    },
    userAgent: {
      type: String,
      default: '',
      maxlength: 300,
    },
    ip: {
      type: String,
      default: '',
      maxlength: 64,
    },
  },
  { timestamps: true }
);

refreshTokenSchema.index({ tokenHash: 1 });
refreshTokenSchema.index({ user: 1, revokedAt: 1 });
// TTL index: expired sessions are removed automatically by MongoDB.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * SHA-256 hashing is appropriate here because the input already has full
 * 256 bits of entropy; a slow KDF is not required for high entropy tokens.
 */
refreshTokenSchema.statics.hashToken = function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
};

refreshTokenSchema.methods.isActive = function isActive() {
  return !this.revokedAt && this.expiresAt.getTime() > Date.now();
};

export const RefreshToken =
  mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema);

export default RefreshToken;