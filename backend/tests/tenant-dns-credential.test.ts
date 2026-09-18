import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel, DomainModel, AdminUserModel, TenantDnsCredentialModel } from '../src/db/models';
import { goDaddyClient } from '../src/godaddy/client';
import { GoDaddyAuthError } from '../src/godaddy/errors';
import {
  listTenantDnsCredentials,
  saveTenantDnsCredential,
  deleteTenantDnsCredential,
  getDecryptedTenantDnsCredential,
} from '../src/services/tenant-dns-credential.service';
import { connectDnsProviderCredential } from '../src/services/domain-activation.service';

let mongoServer: MongoMemoryServer;
const GODADDY_CRED = { apiKey: 'key', apiSecret: 'secret' } as const;

describe('tenant-dns-credential.service', () => {
  let tenantId: string;
  let adminUserId: string;
  const actor = { id: '', email: 'owner@acme.com', role: 'TENANT_ADMIN' };

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri(), autoIndex: true });
    process.env.GODADDY_CREDENTIAL_ENCRYPTION_KEY = 'test-only-godaddy-encryption-key-32b';
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await AdminUserModel.deleteMany({});
    await TenantDnsCredentialModel.deleteMany({});

    const tenant = await TenantModel.create({ name: 'Acme Corp', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantId = tenant._id.toString();

    const adminUser = await AdminUserModel.create({
      email: 'owner@acme.com',
      passwordHash: 'dummy',
      role: 'TENANT_ADMIN',
      tenantId: tenant._id,
      status: 'active',
      twoFactorEnabled: false,
    });
    adminUserId = adminUser._id.toString();
    actor.id = adminUserId;
  });

  describe('saveTenantDnsCredential', () => {
    it('saves unverified when the tenant has no domains yet', async () => {
      const result = await saveTenantDnsCredential(tenantId, 'godaddy', GODADDY_CRED, actor);

      expect(result.verified).toBe(false);
      expect(result.verifiedProviderDomain).toBeNull();

      const row = await TenantDnsCredentialModel.findOne({ tenantId, provider: 'godaddy' });
      expect(row).not.toBeNull();
      expect(row!.verified).toBe(false);
    });

    it('verifies against an existing domain when the tenant has one', async () => {
      await DomainModel.create({ tenantId, domainName: 'acme.com', status: 'active', dnsStatus: 'not_started', isPrimary: true });
      vi.spyOn(goDaddyClient, 'verifyCredential').mockResolvedValue({ domain: 'acme.com', domainId: 1, status: 'ACTIVE' });

      const result = await saveTenantDnsCredential(tenantId, 'godaddy', GODADDY_CRED, actor);

      expect(result.verified).toBe(true);
      expect(result.verifiedProviderDomain).toBe('acme.com');
    });

    it('propagates a provider auth error instead of saving a bad credential', async () => {
      await DomainModel.create({ tenantId, domainName: 'acme.com', status: 'active', dnsStatus: 'not_started', isPrimary: true });
      vi.spyOn(goDaddyClient, 'verifyCredential').mockRejectedValue(new GoDaddyAuthError());

      await expect(saveTenantDnsCredential(tenantId, 'godaddy', GODADDY_CRED, actor)).rejects.toThrow(GoDaddyAuthError);

      const row = await TenantDnsCredentialModel.findOne({ tenantId, provider: 'godaddy' });
      expect(row).toBeNull();
    });

    it('replaces an existing saved credential for the same provider in place', async () => {
      await saveTenantDnsCredential(tenantId, 'godaddy', GODADDY_CRED, actor);
      const firstRow = await TenantDnsCredentialModel.findOne({ tenantId, provider: 'godaddy' });

      const newCred = { apiKey: 'new-key', apiSecret: 'new-secret' } as const;
      await saveTenantDnsCredential(tenantId, 'godaddy', newCred, actor);

      const rows = await TenantDnsCredentialModel.find({ tenantId, provider: 'godaddy' });
      expect(rows).toHaveLength(1);
      expect(rows[0]._id.toString()).toBe(firstRow!._id.toString());

      const decrypted = await getDecryptedTenantDnsCredential(tenantId, 'godaddy');
      expect(decrypted).toEqual(newCred);
    });
  });

  describe('listTenantDnsCredentials', () => {
    it('excludes revoked credentials', async () => {
      await saveTenantDnsCredential(tenantId, 'godaddy', GODADDY_CRED, actor);
      await saveTenantDnsCredential(tenantId, 'cloudflare', { token: 'cf-token' }, actor);
      await deleteTenantDnsCredential(tenantId, 'godaddy', actor);

      const list = await listTenantDnsCredentials(tenantId);

      expect(list).toHaveLength(1);
      expect(list[0].provider).toBe('cloudflare');
    });
  });

  describe('deleteTenantDnsCredential', () => {
    it('soft-revokes: clears the secret but keeps the row for the audit trail', async () => {
      await saveTenantDnsCredential(tenantId, 'godaddy', GODADDY_CRED, actor);

      const deleted = await deleteTenantDnsCredential(tenantId, 'godaddy', actor);
      expect(deleted).toBe(true);

      const row = await TenantDnsCredentialModel.findOne({ tenantId, provider: 'godaddy' }).select('+credentialEncrypted');
      expect(row).not.toBeNull();
      expect(row!.revokedAt).not.toBeNull();
      expect(row!.credentialEncrypted).toBeNull();

      const decrypted = await getDecryptedTenantDnsCredential(tenantId, 'godaddy');
      expect(decrypted).toBeNull();
    });

    it('returns false when there is nothing to revoke', async () => {
      const deleted = await deleteTenantDnsCredential(tenantId, 'hostinger', actor);
      expect(deleted).toBe(false);
    });

    it('allows saving a fresh credential again after revoking (reuses the same document)', async () => {
      await saveTenantDnsCredential(tenantId, 'godaddy', GODADDY_CRED, actor);
      await deleteTenantDnsCredential(tenantId, 'godaddy', actor);

      const result = await saveTenantDnsCredential(tenantId, 'godaddy', GODADDY_CRED, actor);
      expect(result.verified).toBe(false);

      const list = await listTenantDnsCredentials(tenantId);
      expect(list).toHaveLength(1);
      expect(list[0].provider).toBe('godaddy');
    });
  });

  describe('connectDnsProviderCredential integration (saveForFuture)', () => {
    it('saves to the tenant vault when saveForFuture is true, reusing the verify already performed', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'acme.com', status: 'active', dnsStatus: 'not_started', isPrimary: true });
      const verifySpy = vi.spyOn(goDaddyClient, 'verifyCredential').mockResolvedValue({ domain: 'acme.com', domainId: 1, status: 'ACTIVE' });

      await connectDnsProviderCredential(domain._id.toString(), tenantId, 'godaddy', GODADDY_CRED, actor, true);

      expect(verifySpy).toHaveBeenCalledTimes(1); // not called a second time for the vault save
      const vaultRow = await TenantDnsCredentialModel.findOne({ tenantId, provider: 'godaddy' });
      expect(vaultRow).not.toBeNull();
      expect(vaultRow!.verified).toBe(true);
      expect(vaultRow!.verifiedProviderDomain).toBe('acme.com');
    });

    it('does not touch the tenant vault when saveForFuture is false/omitted', async () => {
      const domain = await DomainModel.create({ tenantId, domainName: 'acme.com', status: 'active', dnsStatus: 'not_started', isPrimary: true });
      vi.spyOn(goDaddyClient, 'verifyCredential').mockResolvedValue({ domain: 'acme.com', domainId: 1, status: 'ACTIVE' });

      await connectDnsProviderCredential(domain._id.toString(), tenantId, 'godaddy', GODADDY_CRED, actor);

      const vaultRow = await TenantDnsCredentialModel.findOne({ tenantId, provider: 'godaddy' });
      expect(vaultRow).toBeNull();
    });
  });
});
