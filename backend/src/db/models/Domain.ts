import mongoose, { Schema, Document, Types } from 'mongoose';

export type DomainStatus = 'active' | 'suspended';

export interface IDomain extends Document {
  tenantId: Types.ObjectId;
  domainName: string;
  stalwartDomainId?: string | null;
  status: DomainStatus;
  mailboxLimit: number;
  employeeCount: number;
  isPrimary?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const DomainSchema = new Schema<IDomain>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    domainName: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    stalwartDomainId: {
      type: String,
      default: null,
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      index: true,
    },
    mailboxLimit: {
      type: Number,
      required: true,
      default: 10,
    },
    employeeCount: {
      type: Number,
      default: 10,
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    collection: 'domains',
  }
);

DomainSchema.index({ tenantId: 1, domainName: 1 });

export const DomainModel = mongoose.model<IDomain>('Domain', DomainSchema);
