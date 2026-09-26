import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
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
import { reconciliationService } from '../src/services/reconciliation.service';

let mongoServer: MongoMemoryServer;

describe('Gap 2: Stalwart Entity Drift 1-Click Auto-Repair Integration', () => {
  let superAdminToken: string;
  let tenantId: string;
  let domainId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    const superAdmin = await AdminUserModel.create({
      email: 'superadmin-repair@toowix.com',
      passwordHash: 'dummy',
      role: 'SUPER_ADMIN',
    });

    superAdminToken = generateOidcToken({
      id: superAdmin._id.toString(),
      email: superAdmin.email,
      role: 'SUPER_ADMIN',
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await MailboxModel.deleteMany({});
    await AuditLogModel.deleteMany({});
    vi.restoreAllMocks();
  });

  it('should detect drift and automatically restore missing domain and mailbox in Stalwart', async () => {
    // 1. Create a tenant, domain, and mailbox in MongoDB
    const tenant = await TenantModel.create({
      name: 'Acme Drift Corp',
      status: 'active',
      mailboxCount: 0, // Mismatched intentionally to test quota repair too
      mailboxLimit: 10,
    });
    tenantId = tenant._id.toString();

    const domain = await DomainModel.create({
      tenantId: tenant._id,
      domainName: 'acme-drift.com',
      status: 'active',
      dnsStatus: 'active',
    });
    domainId = domain._id.toString();

    const mailbox = await MailboxModel.create({
      tenantId: tenant._id,
      domainId: domain._id,
      address: 'support@acme-drift.com',
      localPart: 'support',
      domain: 'acme-drift.com',
      passwordHash: 'dummy',
      status: 'active',
      storageQuotaBytes: 1073741824,
    });

    // 2. Mock Stalwart as having NO domains and NO accounts (simulating drift/wiped state)
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([]);
    vi.spyOn(stalwartClient, 'listAccounts').mockResolvedValue([]);

    const createDomainSpy = vi
      .spyOn(stalwartClient, 'createDomain')
      .mockResolvedValue({ id: 'st_dom_123', name: 'acme-drift.com' } as any);

    const createAccountSpy = vi
      .spyOn(stalwartClient, 'createAccount')
      .mockResolvedValue({ id: 'st_acc_456', name: 'support' } as any);

    // Verify drift exists before repair
    const preDrift = await reconciliationService.checkDrift();
    expect(preDrift.synchronized).toBe(false);
    expect(preDrift.drift.missingInStalwartDomains).toContain('acme-drift.com');
    expect(preDrift.drift.missingInStalwartMailboxes).toContain('support@acme-drift.com');
    expect(preDrift.drift.quotaDiscrepancies.length).toBe(1);

    // 3. Execute repairEntityDrift
    const repairResult = await reconciliationService.repairEntityDrift();

    expect(repairResult.restoredDomains).toContain('acme-drift.com');
    expect(repairResult.restoredMailboxes).toContain('support@acme-drift.com');
    expect(repairResult.quotaRepairedCount).toBe(1);
    expect(createDomainSpy).toHaveBeenCalledWith(
      'acme-drift.com',
      expect.stringContaining('Reconciliation Service')
    );
    expect(createAccountSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'support',
        domainId: 'st_dom_123',
      })
    );

    // 4. Verify MongoDB docs were updated with new Stalwart IDs
    const updatedDomain = await DomainModel.findById(domainId);
    expect(updatedDomain?.stalwartDomainId).toBe('st_dom_123');

    const updatedMailbox = await MailboxModel.findById(mailbox._id);
    expect(updatedMailbox?.stalwartAccountId).toBe('st_acc_456');

    const updatedTenant = await TenantModel.findById(tenantId);
    expect(updatedTenant?.mailboxCount).toBe(1);

    // 5. Verify Audit Logs were created
    const auditLogs = await AuditLogModel.find({
      action: { $in: ['STALWART_DRIFT_DOMAIN_RESTORED', 'STALWART_DRIFT_MAILBOX_RESTORED'] },
    });
    expect(auditLogs.length).toBe(2);
  });

  it('should invoke POST /api/system/reconciliation/auto-repair and return 200 for Super Admin', async () => {
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([]);
    vi.spyOn(stalwartClient, 'listAccounts').mockResolvedValue([]);

    const res = await request(app)
      .post('/api/system/reconciliation/auto-repair')
      .set('Authorization', `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain('Entity drift auto-repair complete');
    expect(Array.isArray(res.body.restoredDomains)).toBe(true);
    expect(Array.isArray(res.body.restoredMailboxes)).toBe(true);
  });

  it('should reject POST /api/system/reconciliation/auto-repair for non-super-admin', async () => {
    const res = await request(app).post('/api/system/reconciliation/auto-repair');
    expect(res.status).toBe(401);
  });
});
