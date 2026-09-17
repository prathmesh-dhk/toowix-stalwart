import mongoose, { Schema, Document } from 'mongoose';

/**
 * Backs brute-force rate limiting (login attempts, registration attempts)
 * with MongoDB instead of an in-memory Map — an in-memory store resets on
 * every backend restart/redeploy and doesn't work at all across multiple
 * replicas, silently giving an attacker a fresh attempt budget either way.
 */
export interface IRateLimitEntry extends Document {
  key: string;
  count: number;
  resetAt: Date;
}

const RateLimitEntrySchema = new Schema<IRateLimitEntry>(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    count: {
      type: Number,
      required: true,
      default: 1,
    },
    resetAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }, // MongoDB TTL index for automatic cleanup
    },
  },
  {
    timestamps: false,
    collection: 'rate_limit_entries',
  }
);

export const RateLimitEntryModel = mongoose.model<IRateLimitEntry>('RateLimitEntry', RateLimitEntrySchema);
