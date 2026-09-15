import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel, DomainModel, DomainDnsCredentialModel, AdminUserModel } from '../src/db/models';
import { stalwartClient } from '../src/stalwart/client';
import { goDaddyClient } from '../src/godaddy/client';
import { GoDaddyDomainNotManagedError, GoDaddyAuthError } from '../src/godaddy/errors';
import {
  connectGoDaddyCredential,
  activateDomain,
  retryVerify,
  DomainActivationError,
} from '../src/services/domain-activation.service';

vi.mock('dns/promises', () => ({
  resolveMx: vi.fn(),
  resolveTxt: vi.fn(),
}));

import { resolveMx, resolveTxt } from 'dns/promises';

let mongoServer: MongoMemoryServer;

const DKIM_KEYS = [
  { id: 'k1', domainId: 'stalwart-dom-1', selector: 'v1-rsa-20260101', algorithm: 'Dkim1RsaSha256' as const, publicKey: 'RSA_PUB_KEY', stage: 'active' },
  { id: 'k2', domainId: 'stalwart-dom-1', selector: 'v1-ed25519-20260101', algorithm: 'Dkim1Ed25519Sha256' as const, publicKey: 'ED25519_PUB_KEY', stage: 'active' },
];

describe('domain-activation.service', () => {
  let tenantId: string;
  let domainId: string;
  let adminUserId: string;
  const actor = { id: '', email: 'super@toowix.com', role: 'SUPER_ADMIN' };

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
    await DomainDnsCredentialModel.deleteMany({});
    await AdminUserModel.deleteMany({});

    const tenant = await TenantModel.create({ name: 'Acme Corp', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantId = tenant._id.toString();

    const domain = await DomainModel.create({
      tenantId: tenant._id,
      domainName: 'acme.com',
      stalwartDomainId: null,
      status: 'active',
      dnsStatus: 'not_started',
      isPrimary: true,
    });
    domainId = domain._id.toString();

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

    vi.mocked(resolveMx).mockReset();
    vi.mocked(resolveTxt).mockReset();
  });

  describe('connectGoDaddyCredential', () => {
    it('stores an encrypted credential after verifying it manages the domain', async () => {
      vi.spyOn(goDaddyClient, 'verifyCredential').mockResolvedValue({ domain: 'acme.com', domainId: 1, status: 'ACTIVE' });

      const result = await connectGoDaddyCredential(domainId, tenantId, 'key123', 'secret456', {
        id: adminUserId,
        email: 'owner@acme.com',
        role: 'TENANT_ADMIN',
      });

      expect(result.verifiedGoDaddyDomain).toBe('acme.com');
      const cred = await DomainDnsCredentialModel.findOne({ domainId }).select('+godaddyApiKeyEncrypted +godaddyApiSecretEncrypted');
      expect(cred).not.toBeNull();
      expect(cred!.godaddyApiKeyEncrypted).not.toContain('key123'); // encrypted, not plaintext
    });

    it('propagates GoDaddyDomainNotManagedError without storing a credential', async () => {
      vi.spyOn(goDaddyClient, 'verifyCredential').mockRejectedValue(new GoDaddyDomainNotManagedError('acme.com'));

      await expect(
        connectGoDaddyCredential(domainId, tenantId, 'key', 'secret', { id: adminUserId, email: 'x', role: 'TENANT_ADMIN' })
      ).rejects.toThrow(GoDaddyDomainNotManagedError);

      const cred = await DomainDnsCredentialModel.findOne({ domainId });
      expect(cred).toBeNull();
    });

    it('throws NOT_FOUND for a domain belonging to a different tenant', async () => {
      const otherTenant = await TenantModel.create({ name: 'Other', status: 'active', mailboxLimit: 10, mailboxCount: 0 });
      await expect(
        connectGoDaddyCredential(domainId, otherTenant._id.toString(), 'key', 'secret', {
          id: adminUserId,
          email: 'x',
          role: 'TENANT_ADMIN',
        })
      ).rejects.toThrow(DomainActivationError);
    });
  });

  describe('activateDomain', () => {
    beforeEach(async () => {
      vi.spyOn(goDaddyClient, 'verifyCredential').mockResolvedValue({ domain: 'acme.com', domainId: 1, status: 'ACTIVE' });
      await connectGoDaddyCredential(domainId, tenantId, 'key', 'secret', { id: adminUserId, email: 'x', role: 'TENANT_ADMIN' });

      vi.spyOn(stalwartClient, 'createDomain').mockResolvedValue({ id: 'stalwart-dom-1', name: 'acme.com' });
      vi.spyOn(stalwartClient, 'getActiveDkimKeys').mockResolvedValue(DKIM_KEYS);
    });

    it('throws GODADDY_CREDENTIAL_MISSING if no credential is connected yet', async () => {
      const domain = await DomainModel.create({
        tenantId,
        domainName: 'nocred.com',
        status: 'active',
        dnsStatus: 'not_started',
        isPrimary: false,
      });
      await expect(activateDomain(domain._id.toString(), actor)).rejects.toThrow(DomainActivationError);
    });

    it('goes conflict -> stores dnsConflicts -> does not create any records when MX already exists elsewhere', async () => {
      vi.spyOn(goDaddyClient, 'listDnsRecords').mockImplementation(async (_k, _s, _d, type, name) => {
        if (type === 'MX' && name === '@') {
          return [{ type: 'MX', name: '@', data: 'mail.otherprovider.com', priority: 10 } as any];
        }
        return [];
      });
      const createSpy = vi.spyOn(goDaddyClient, 'createDnsRecords').mockResolvedValue(undefined);

      const result = await activateDomain(domainId, actor);

      expect(result.dnsStatus).toBe('conflict');
      expect(result.dnsConflicts?.length).toBeGreaterThan(0);
      expect(result.dnsConflicts?.[0].foundValue).toBe('mail.otherprovider.com');
      expect(createSpy).not.toHaveBeenCalled();

      // Credential must NOT be purged on conflict — needed for retry.
      const cred = await DomainDnsCredentialModel.findOne({ domainId });
      expect(cred).not.toBeNull();
    });

    it('creates records and marks active immediately when DNS already resolves correctly', async () => {
      vi.spyOn(goDaddyClient, 'listDnsRecords').mockResolvedValue([]);
      const createSpy = vi.spyOn(goDaddyClient, 'createDnsRecords').mockResolvedValue(undefined);

      vi.mocked(resolveMx).mockResolvedValue([{ exchange: 'mail.toowix.com', priority: 10 }] as any);
      vi.mocked(resolveTxt).mockImplementation(async (fqdn: string) => {
        if (fqdn === 'acme.com') return [['v=spf1 mx include:_spf.toowix.com ~all']];
        if (fqdn === '_dmarc.acme.com') return [['v=DMARC1; p=none; rua=mailto:dmarc-reports@acme.com']];
        if (fqdn.includes('_domainkey')) {
          const isRsa = fqdn.startsWith('v1-rsa');
          return [[`v=DKIM1; k=${isRsa ? 'rsa' : 'ed25519'}; p=${isRsa ? 'RSA_PUB_KEY' : 'ED25519_PUB_KEY'}`]];
        }
        return [[]] as any;
      });

      const result = await activateDomain(domainId, actor);

      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(result.dnsStatus).toBe('active');
      expect(result.activatedAt).toBeTruthy();
      expect(result.stalwartDomainId).toBe('stalwart-dom-1');

      // Primary domain activating for the first time starts the trial.
      const tenant = await TenantModel.findById(tenantId);
      expect(tenant?.trialStartedAt).toBeTruthy();
      expect(tenant?.trialEndsAt).toBeTruthy();

      // Credential is purged once activation succeeds.
      const cred = await DomainDnsCredentialModel.findOne({ domainId });
      expect(cred).toBeNull();
    });

    it('leaves dnsStatus activating when DNS has not propagated yet', async () => {
      vi.spyOn(goDaddyClient, 'listDnsRecords').mockResolvedValue([]);
      vi.spyOn(goDaddyClient, 'createDnsRecords').mockResolvedValue(undefined);
      vi.mocked(resolveMx).mockRejectedValue(new Error('ENOTFOUND'));
      vi.mocked(resolveTxt).mockRejectedValue(new Error('ENOTFOUND'));

      const result = await activateDomain(domainId, actor);

      expect(result.dnsStatus).toBe('activating');
      expect(result.dnsVerificationStartedAt).toBeTruthy();

      const tenant = await TenantModel.findById(tenantId);
      expect(tenant?.trialStartedAt).toBeFalsy();

      // Credential must survive so the sweep/retry can use it later.
      const cred = await DomainDnsCredentialModel.findOne({ domainId });
      expect(cred).not.toBeNull();
    });

    it('rejects re-activating a domain that is already active', async () => {
      const domain = await DomainModel.findById(domainId);
      domain!.dnsStatus = 'active';
      await domain!.save();

      await expect(activateDomain(domainId, actor)).rejects.toThrow(DomainActivationError);
    });
  });

  describe('retryVerify', () => {
    beforeEach(async () => {
      vi.spyOn(goDaddyClient, 'verifyCredential').mockResolvedValue({ domain: 'acme.com', domainId: 1, status: 'ACTIVE' });
      await connectGoDaddyCredential(domainId, tenantId, 'key', 'secret', { id: adminUserId, email: 'x', role: 'TENANT_ADMIN' });
      vi.spyOn(stalwartClient, 'createDomain').mockResolvedValue({ id: 'stalwart-dom-1', name: 'acme.com' });
      vi.spyOn(stalwartClient, 'getActiveDkimKeys').mockResolvedValue(DKIM_KEYS);
    });

    it('rejects retry from not_started', async () => {
      await expect(retryVerify(domainId, actor)).rejects.toThrow(DomainActivationError);
    });

    it('re-checks conflicts and proceeds once resolved, then verifies', async () => {
      // First activation attempt hits a conflict.
      vi.spyOn(goDaddyClient, 'listDnsRecords').mockResolvedValueOnce([
        { type: 'MX', name: '@', data: 'mail.otherprovider.com', priority: 10 } as any,
      ]).mockResolvedValue([]);
      vi.spyOn(goDaddyClient, 'createDnsRecords').mockResolvedValue(undefined);

      const first = await activateDomain(domainId, actor);
      expect(first.dnsStatus).toBe('conflict');

      // Customer fixes their DNS; retry now finds no conflicts.
      vi.mocked(resolveMx).mockResolvedValue([{ exchange: 'mail.toowix.com', priority: 10 }] as any);
      vi.mocked(resolveTxt).mockImplementation(async (fqdn: string) => {
        if (fqdn === 'acme.com') return [['v=spf1 mx include:_spf.toowix.com ~all']];
        if (fqdn === '_dmarc.acme.com') return [['v=DMARC1; p=none; rua=mailto:dmarc-reports@acme.com']];
        if (fqdn.includes('_domainkey')) {
          const isRsa = fqdn.startsWith('v1-rsa');
          return [[`v=DKIM1; k=${isRsa ? 'rsa' : 'ed25519'}; p=${isRsa ? 'RSA_PUB_KEY' : 'ED25519_PUB_KEY'}`]];
        }
        return [[]] as any;
      });

      const second = await retryVerify(domainId, actor);
      expect(second.dnsStatus).toBe('active');
    });
  });
});
