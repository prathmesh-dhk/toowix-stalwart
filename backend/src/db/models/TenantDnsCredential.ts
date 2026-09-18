import mongoose, { Schema, Document, Types } from 'mongoose';
import { DnsProviderName } from './DomainDnsCredential';

/**
 * A tenant-wide, reusable DNS provider credential ("saved API key" vault) —
 * distinct from DomainDnsCredential, which is per-domain and deleted once
 * that domain activates. This one persists across domains: a tenant saves a
 * GoDaddy/Hostinger/Cloudflare credential once here, then reuses it for
 * every future domain instead of re-entering it, independent of any single
 * domain's activation lifecycle. One document per (tenantId, provider);
 * "deleting" a saved key clears `credentialEncrypted` and sets `revokedAt`
 * rather than removing the document, so the fact a key once existed stays
 * visible in the audit trail without keeping the secret around. Re-saving a
 * revoked (or existing) provider's credential reuses the same document.
 */
export interface ITenantDnsCredential extends Document {
  tenantId: Types.ObjectId;
  provider: DnsProviderName;
  credentialEncrypted?: string | null;
  verified: boolean;
  verifiedProviderDomain?: string | null;
  connectedAt?: Date | null;
  connectedBy?: Types.ObjectId | null;
  lastUsedAt?: Date | null;
  revokedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TenantDnsCredentialSchema = new Schema<ITenantDnsCredential>(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ['godaddy', 'hostinger', 'cloudflare'],
      required: true,
    },
    credentialEncrypted: {
      type: String,
      default: null,
      select: false,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    verifiedProviderDomain: {
      type: String,
      default: null,
    },
    connectedAt: {
      type: Date,
      default: null,
    },
    connectedBy: {
      type: Schema.Types.ObjectId,
      ref: 'AdminUser',
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    collection: 'tenant_dns_credentials',
  }
);

TenantDnsCredentialSchema.index({ tenantId: 1, provider: 1 }, { unique: true });

export const TenantDnsCredentialModel = mongoose.model<ITenantDnsCredential>(
  'TenantDnsCredential',
  TenantDnsCredentialSchema
);
