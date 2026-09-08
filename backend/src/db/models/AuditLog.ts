import mongoose, { Schema, Document, Types } from 'mongoose';

export type AuditStatus = 'SUCCESS' | 'FAILED';

export interface IAuditLog extends Document {
  actorId?: Types.ObjectId | string | null;
  actorRole: string;
  actorEmail?: string | null;
  actorIp?: string | null;
  tenantId?: Types.ObjectId | null;
  action: string;
  resource: string;
  resourceId?: string | null;
  status: AuditStatus;
  metadata: Record<string, any>;
  timestamp: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId: {
      type: Schema.Types.Mixed,
      default: null,
      index: true,
    },
    actorRole: {
      type: String,
      required: true,
      index: true,
    },
    actorEmail: {
      type: String,
      default: null,
      lowercase: true,
      trim: true,
    },
    actorIp: {
      type: String,
      default: null,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    resource: {
      type: String,
      required: true,
      index: true,
    },
    resourceId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ['SUCCESS', 'FAILED'],
      required: true,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
    collection: 'audit_logs',
  }
);

AuditLogSchema.index({ tenantId: 1, timestamp: -1 });
AuditLogSchema.index({ action: 1, timestamp: -1 });

export const AuditLogModel = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
