import mongoose, { Schema, Document, Types } from 'mongoose';

export type DomainStatus = 'active' | 'suspended';

export interface IDomain extends Document {
  tenantId: Types.ObjectId;
  domainName: string;
  stalwartDomainId?: string | null;
  status: DomainStatus;
  createdAt: Date;
  updatedAt: Date;
}

const DomainSchema = new Schema<IDomain>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      unique: true, // HARD RULE: 1 tenant = exactly 1 domain
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
  },
  {
    timestamps: true,
    collection: 'domains',
  }
);

export const DomainModel = mongoose.model<IDomain>('Domain', DomainSchema);
