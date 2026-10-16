import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  AdminUserModel,
  TenantModel,
  DomainModel,
  MailboxModel,
  AuditLogModel,
} from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';

const TEST_MONGO_URI = 'mongodb://127.0.0.1:27017/toowix_import_domain_test';

describe('Stalwart Domain & Mailbox Import Feature', () => {
  let superAdminToken: string;
  let superAdminId: string;
  let tenantA: any;
  let tenantB: any;

  beforeAll(async () => {
    await connectDatabase({ uri: TEST_MONGO_URI });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await AdminUserModel.deleteMany({});
    await MailboxModel.deleteMany({});
    await AuditLogModel.deleteMany({});

    // Super Admin setup
    const superAdmin = await AdminUserModel.create({
      email: 'superadmin@toowix.test',
      passwordHash: 'argon2id$mocked',
      role: 'SUPER_ADMIN',
      status: 'active',
      twoFactorEnabled: true,
    });
    superAdminId = superAdmin._id.toString();
    superAdminToken = generateOidcToken({
      id: superAdminId,
      email: superAdmin.email,
      role: 'SUPER_ADMIN',
    });

    // Tenants setup
    tenantA = await TenantModel.create({
      name: 'Tenant Alpha',
      mailboxLimit: 5,
      mailboxCount: 0,
      status: 'active',
    });

    tenantB = await TenantModel.create({
      name: 'Tenant Beta',
      mailboxLimit: 10,
      mailboxCount: 0,
      status: 'active',
    });
  });

  describe('GET /api/platform/tenants/unmanaged-domains', () => {
    it('returns only unclaimed Stalwart domains and filters by search query', async () => {
      // Mock Stalwart domains
      vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([
        { id: 'dom-1', name: 'alpha.com', isEnabled: true },
        { id: 'dom-2', name: 'beta.org', isEnabled: true },
        { id: 'dom-3', name: 'charlie.net', isEnabled: false },
      ] as any);

      // Claim alpha.com in MongoDB
      await DomainModel.create({
        tenantId: tenantA._id,
        domainName: 'alpha.com',
        stalwartDomainId: 'dom-1',
        status: 'active',
        dnsStatus: 'active',
      });

      // 1. Unfiltered request should return beta.org and charlie.net (alpha.com excluded)
      const res1 = await request(app)
        .get('/api/platform/tenants/unmanaged-domains')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res1.status).toBe(200);
      expect(res1.body.domains).toHaveLength(2);
      expect(res1.body.domains).toEqual([
        { domainName: 'beta.org', stalwartDomainId: 'dom-2' },
        { domainName: 'charlie.net', stalwartDomainId: 'dom-3' },
      ]);

      // 2. Query filter for "charlie"
      const res2 = await request(app)
        .get('/api/platform/tenants/unmanaged-domains?q=charlie')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res2.status).toBe(200);
      expect(res2.body.domains).toHaveLength(1);
      expect(res2.body.domains[0].domainName).toBe('charlie.net');
    });
  });

  describe('POST /api/platform/tenants/:id/domains/import', () => {
    it('imports an unclaimed domain along with its mailboxes, setting primary, updating quota and logging audit', async () => {
      vi.spyOn(stalwartClient, 'getDomain').mockImplementation(async (id: string) => {
        if (id === 'dom-beta') {
          return {
            id: 'dom-beta',
            name: 'beta.org',
            isEnabled: true,
            dnsZoneFile: 'beta.org. IN TXT "v=spf1 ~all"',
          } as any;
        }
        return null;
      });

      vi.spyOn(stalwartClient, 'getActiveDkimKeys').mockResolvedValue([
        { selector: 'v1-rsa', publicKey: 'MIIBIjANBgkqhki...' } as any,
      ]);

      vi.spyOn(stalwartClient, 'listAccounts').mockResolvedValue([
        {
          id: 'acc-1',
          name: 'ceo',
          domainId: 'dom-beta',
          emailAddress: 'ceo@beta.org',
          description: 'Chief Executive',
        },
        {
          id: 'acc-2',
          name: 'support',
          domainId: 'dom-beta',
          emailAddress: 'support@beta.org',
          description: 'Support Desk',
        },
      ] as any);

      const res = await request(app)
        .post(`/api/platform/tenants/${tenantA._id}/domains/import`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ domainIds: ['dom-beta'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toHaveLength(1);
      expect(res.body.success[0]).toEqual({
        domainName: 'beta.org',
        stalwartDomainId: 'dom-beta',
        mailboxesImported: 2,
      });

      // Verify DomainModel doc
      const domainDoc = await DomainModel.findOne({ domainName: 'beta.org' });
      expect(domainDoc).toBeTruthy();
      expect(domainDoc!.tenantId.toString()).toBe(tenantA._id.toString());
      expect(domainDoc!.isPrimary).toBe(true); // First domain becomes primary
      expect(domainDoc!.stalwartDomainId).toBe('dom-beta');
      expect(domainDoc!.status).toBe('active');
      expect(domainDoc!.dnsZoneFile).toBe('beta.org. IN TXT "v=spf1 ~all"');
      expect(domainDoc!.dkimSelector).toBe('v1-rsa');
      expect(domainDoc!.dkimPublicKey).toBe('MIIBIjANBgkqhki...');

      // Verify MailboxModel docs
      const mailboxes = await MailboxModel.find({ tenantId: tenantA._id }).sort({ localPart: 1 });
      expect(mailboxes).toHaveLength(2);
      expect(mailboxes[0].address).toBe('ceo@beta.org');
      expect(mailboxes[0].localPart).toBe('ceo');
      expect(mailboxes[0].displayName).toBe('Chief Executive');
      expect(mailboxes[0].domainName).toBe('beta.org');
      expect(mailboxes[0].stalwartAccountId).toBe('acc-1');

      expect(mailboxes[1].address).toBe('support@beta.org');
      expect(mailboxes[1].localPart).toBe('support');
      expect(mailboxes[1].displayName).toBe('Support Desk');

      // Verify TenantModel quota increment
      const updatedTenant = await TenantModel.findById(tenantA._id);
      expect(updatedTenant!.mailboxCount).toBe(2);

      // Verify AuditLog
      const auditLog = await AuditLogModel.findOne({ action: 'DOMAIN_IMPORTED', tenantId: tenantA._id });
      expect(auditLog).toBeTruthy();
      expect(auditLog!.metadata.domainName).toBe('beta.org');
      expect(auditLog!.metadata.mailboxesImported).toBe(2);
      expect(auditLog!.metadata.isPrimary).toBe(true);
    });

    it('rejects re-importing an already claimed domain', async () => {
      // Claim gamma.com
      await DomainModel.create({
        tenantId: tenantA._id,
        domainName: 'gamma.com',
        stalwartDomainId: 'dom-gamma',
        status: 'active',
        dnsStatus: 'active',
      });

      vi.spyOn(stalwartClient, 'getDomain').mockResolvedValue({
        id: 'dom-gamma',
        name: 'gamma.com',
        isEnabled: true,
      } as any);

      const res = await request(app)
        .post(`/api/platform/tenants/${tenantB._id}/domains/import`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ domainIds: ['dom-gamma'] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('IMPORT_FAILED');
      expect(res.body.details.errors[0].message).toBe('Domain already claimed by a tenant');
    });

    it('skips duplicate accounts during mailbox import without failing the domain import', async () => {
      vi.spyOn(stalwartClient, 'getDomain').mockResolvedValue({
        id: 'dom-delta',
        name: 'delta.io',
        isEnabled: true,
      } as any);

      // Pre-claim one mailbox in MongoDB
      await MailboxModel.create({
        tenantId: tenantB._id,
        domainId: new mongoose.Types.ObjectId(),
        domainName: 'other.io',
        localPart: 'taken',
        address: 'taken@delta.io',
        status: 'active',
      });

      vi.spyOn(stalwartClient, 'listAccounts').mockResolvedValue([
        {
          id: 'acc-taken',
          name: 'taken',
          domainId: 'dom-delta',
          emailAddress: 'taken@delta.io',
        },
        {
          id: 'acc-free',
          name: 'free',
          domainId: 'dom-delta',
          emailAddress: 'free@delta.io',
        },
      ] as any);

      const res = await request(app)
        .post(`/api/platform/tenants/${tenantA._id}/domains/import`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ domainIds: ['dom-delta'] });

      expect(res.status).toBe(200);
      expect(res.body.success[0].mailboxesImported).toBe(1);

      // Verify only 'free@delta.io' was created for tenantA
      const tenantAMailboxes = await MailboxModel.find({ tenantId: tenantA._id });
      expect(tenantAMailboxes).toHaveLength(1);
      expect(tenantAMailboxes[0].address).toBe('free@delta.io');
    });

    it('expands tenant mailboxLimit if imported mailboxes exceed existing limit', async () => {
      // tenantA starts with mailboxLimit = 5
      expect(tenantA.mailboxLimit).toBe(5);

      vi.spyOn(stalwartClient, 'getDomain').mockResolvedValue({
        id: 'dom-huge',
        name: 'hugecorp.com',
        isEnabled: true,
      } as any);

      // 8 accounts in Stalwart
      const mockAccounts = Array.from({ length: 8 }, (_, i) => ({
        id: `acc-${i}`,
        name: `user${i}`,
        domainId: 'dom-huge',
        emailAddress: `user${i}@hugecorp.com`,
      }));

      vi.spyOn(stalwartClient, 'listAccounts').mockResolvedValue(mockAccounts as any);

      const res = await request(app)
        .post(`/api/platform/tenants/${tenantA._id}/domains/import`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ domainIds: ['dom-huge'] });

      expect(res.status).toBe(200);
      expect(res.body.success[0].mailboxesImported).toBe(8);

      const updatedTenant = await TenantModel.findById(tenantA._id);
      expect(updatedTenant!.mailboxCount).toBe(8);
      expect(updatedTenant!.mailboxLimit).toBe(8); // Bumped to prevent quota lock
    });
  });
});
