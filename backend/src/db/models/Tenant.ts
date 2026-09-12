import mongoose, { Schema, Document } from 'mongoose';

export type TenantStatus =
  | 'pending_review'
  | 'approved_pending_setup'
  | 'active'
  | 'suspended'
  | 'pending_deletion'
  | 'archived';

export interface ITenant extends Document {
  name: string;
  contactEmail?: string | null;
  phone?: string | null;
  status: TenantStatus;
  mailboxLimit: number;
  mailboxCount: number;
  trialStartedAt?: Date | null;
  trialEndsAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TenantSchema = new Schema<ITenant>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    contactEmail: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: [
        'pending_review',
        'approved_pending_setup',
        'active',
        'suspended',
        'pending_deletion',
        'archived',
      ],
      default: 'approved_pending_setup',
      index: true,
    },
    mailboxLimit: {
      type: Number,
      required: true,
      default: 50,
      min: 1,
    },
    mailboxCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    trialStartedAt: {
      type: Date,
      default: null,
    },
    trialEndsAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'tenants',
  }
);

TenantSchema.index({ status: 1, name: 1 });

export const TenantModel = mongoose.model<ITenant>('Tenant', TenantSchema);
