import mongoose, { Schema, Document, Types } from 'mongoose';

export type DomainDeletionRequestStatus = 'pending' | 'approved' | 'rejected';

export interface IDomainDeletionRequest extends Document {
  domainId: Types.ObjectId;
  tenantId: Types.ObjectId;
  domainName: string;
  status: DomainDeletionRequestStatus;
  reason?: string | null;
  requestedBy: Types.ObjectId;
  requestedByEmail: string;
  reviewedBy?: Types.ObjectId | null;
  reviewedByEmail?: string | null;
  reviewedAt?: Date | null;
  rejectionReason?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DomainDeletionRequestSchema = new Schema<IDomainDeletionRequest>(
  {
    domainId: {
      type: Schema.Types.ObjectId,
      ref: 'Domain',
      required: true,
      index: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    domainName: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      required: true,
      index: true,
    },
    reason: {
      type: String,
      trim: true,
      default: null,
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      required: true,
    },
    requestedByEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      default: null,
    },
    reviewedByEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index to quickly find pending requests for a specific domain
DomainDeletionRequestSchema.index({ domainId: 1, status: 1 });

export const DomainDeletionRequestModel =
  mongoose.models.DomainDeletionRequest ||
  mongoose.model<IDomainDeletionRequest>('DomainDeletionRequest', DomainDeletionRequestSchema);
