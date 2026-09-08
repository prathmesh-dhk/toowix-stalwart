import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IActivationToken extends Document {
  tenantId: Types.ObjectId;
  tokenHash: string;
  contactEmail: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
}

const ActivationTokenSchema = new Schema<IActivationToken>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    contactEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expireAfterSeconds: 0 }, // MongoDB TTL index for automatic expiration
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'activation_tokens',
  }
);

export const ActivationTokenModel = mongoose.model<IActivationToken>(
  'ActivationToken',
  ActivationTokenSchema
);
