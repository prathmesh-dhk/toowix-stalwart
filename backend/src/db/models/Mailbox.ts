import mongoose, { Schema, Document, Types } from 'mongoose';

export type MailboxStatus = 'active' | 'suspended';

export interface IMailboxSecurityProfile {
  twoFactorEnabled: boolean; // voluntary for mailbox users
  twoFactorSecret?: string;
  temporaryPasswordHash?: string;
  mustChangePassword?: boolean;
  tempPasswordExpiresAt?: Date;
}

export interface IMailboxAlias {
  _id: Types.ObjectId;
  localPart: string;
  domainId: Types.ObjectId;
  domainName: string;
  address: string;
  description?: string | null;
  createdAt: Date;
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
  aliases: IMailboxAlias[];
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

const MailboxAliasSchema = new Schema<IMailboxAlias>(
  {
    localPart: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    domainId: {
      type: Schema.Types.ObjectId,
      ref: 'Domain',
      required: true,
    },
    domainName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      trim: true,
      default: null,
    },
    createdAt: {
      type: Date,
      default: () => new Date(),
    },
  },
  { _id: true }
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
    aliases: {
      type: [MailboxAliasSchema],
      default: [],
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
MailboxSchema.index({ 'aliases.address': 1 });

export const MailboxModel = mongoose.model<IMailbox>('Mailbox', MailboxSchema);
