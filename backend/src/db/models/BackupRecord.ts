import mongoose, { Schema, Document } from 'mongoose';

export type BackupStorageType = 'local' | 's3';
export type BackupStatus = 'completed' | 'failed';

export interface IBackupRecord extends Document {
  id: string;
  filename: string;
  sizeBytes: number;
  checksumSha256: string;
  encrypted: boolean;
  storageType: BackupStorageType;
  s3Key?: string;
  status: BackupStatus;
  documentCounts: {
    tenants: number;
    domains: number;
    mailboxes: number;
    admins: number;
    auditLogs: number;
  };
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const BackupRecordSchema = new Schema<IBackupRecord>(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    filename: {
      type: String,
      required: true,
    },
    sizeBytes: {
      type: Number,
      required: true,
      default: 0,
    },
    checksumSha256: {
      type: String,
      required: true,
    },
    encrypted: {
      type: Boolean,
      default: true,
    },
    storageType: {
      type: String,
      enum: ['local', 's3'],
      default: 'local',
    },
    s3Key: {
      type: String,
    },
    status: {
      type: String,
      enum: ['completed', 'failed'],
      default: 'completed',
    },
    documentCounts: {
      tenants: { type: Number, default: 0 },
      domains: { type: Number, default: 0 },
      mailboxes: { type: Number, default: 0 },
      admins: { type: Number, default: 0 },
      auditLogs: { type: Number, default: 0 },
    },
    createdBy: {
      type: String,
      required: true,
      default: 'system',
    },
  },
  {
    timestamps: true,
    collection: 'backup_records',
  }
);

BackupRecordSchema.index({ createdAt: -1 });

export const BackupRecordModel = mongoose.model<IBackupRecord>('BackupRecord', BackupRecordSchema);
