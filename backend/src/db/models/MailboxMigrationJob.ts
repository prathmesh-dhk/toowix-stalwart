import mongoose, { Schema, Document, Types } from 'mongoose';

export type MailboxMigrationJobStatus = 'queued' | 'running' | 'completed' | 'failed';

// Tracks a single "migrate mail then delete the source mailbox" operation
// (see mailbox-migration.service.ts) so the frontend can poll progress while
// stalwartClient.migrateAccountMail works through the source's messages.
export interface IMailboxMigrationJob extends Document {
  tenantId: Types.ObjectId;
  sourceMailboxId: Types.ObjectId;
  sourceAddress: string;
  destinationMailboxId: Types.ObjectId;
  destinationAddress: string;
  status: MailboxMigrationJobStatus;
  totalMessages: number;
  migratedMessages: number;
  failedCount?: number;
  deleteSourceAfter?: boolean;
  error?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const MailboxMigrationJobSchema = new Schema<IMailboxMigrationJob>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    sourceMailboxId: {
      type: Schema.Types.ObjectId,
      ref: 'Mailbox',
      required: true,
    },
    sourceAddress: {
      type: String,
      required: true,
    },
    destinationMailboxId: {
      type: Schema.Types.ObjectId,
      ref: 'Mailbox',
      required: true,
    },
    destinationAddress: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['queued', 'running', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    totalMessages: {
      type: Number,
      default: 0,
      min: 0,
    },
    migratedMessages: {
      type: Number,
      default: 0,
      min: 0,
    },
    failedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    deleteSourceAfter: {
      type: Boolean,
      default: false,
    },
    error: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'mailbox_migration_jobs',
  }
);

export const MailboxMigrationJobModel = mongoose.model<IMailboxMigrationJob>(
  'MailboxMigrationJob',
  MailboxMigrationJobSchema
);
