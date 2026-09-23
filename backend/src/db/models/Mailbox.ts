import mongoose, { Schema, Document, Types } from 'mongoose';

export type MailboxStatus = 'active' | 'suspended';

export interface IMailboxSecurityProfile {
  twoFactorEnabled: boolean; // voluntary for mailbox users
  twoFactorSecret?: string;
  temporaryPasswordHash?: string;
  mustChangePassword?: boolean;
  tempPasswordExpiresAt?: Date;
}

export interface IMailbox extends Document {
  tenantId: Types.ObjectId;
  domainId: Types.ObjectId;
  localPart: string;
  address: string;
  displayName?: string | null;
  status: MailboxStatus;
  stalwartAccountId?: string;
  security: IMailboxSecurityProfile;
  domainName?: string;
  storageBytes?: number;
  createdAt: Date;
  updatedAt: Date;
}

const MailboxSecurityProfileSchema = new Schema<IMailboxSecurityProfile>(
  {
    twoFactorEnabled: {
      type: Boolean,
      default: false,
    },
    twoFactorSecret: {
      type: String,
      default: null,
    },
    temporaryPasswordHash: {
      type: String,
      default: null,
    },
    mustChangePassword: {
      type: Boolean,
      default: false,
    },
    tempPasswordExpiresAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const MailboxSchema = new Schema<IMailbox>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    domainId: {
      type: Schema.Types.ObjectId,
      ref: 'Domain',
      required: true,
      index: true,
    },
    localPart: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    address: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    displayName: {
      type: String,
      default: null,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'suspended'],
      default: 'active',
      index: true,
    },
    stalwartAccountId: {
      type: String,
      default: null,
    },
    security: {
      type: MailboxSecurityProfileSchema,
      default: () => ({
        twoFactorEnabled: false,
        mustChangePassword: false,
      }),
    },
  },
  {
    timestamps: true,
    collection: 'mailboxes',
  }
);

// Compound unique indexes
MailboxSchema.index({ tenantId: 1, localPart: 1 }, { unique: true });
MailboxSchema.index({ domainId: 1, localPart: 1 }, { unique: true });
MailboxSchema.index({ tenantId: 1, status: 1 });

export const MailboxModel = mongoose.model<IMailbox>('Mailbox', MailboxSchema);
