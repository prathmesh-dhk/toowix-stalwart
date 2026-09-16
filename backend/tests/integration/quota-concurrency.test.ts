import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../../src/app';
import { connectDatabase, disconnectDatabase } from '../../src/db/connection';
import {
  createTestTenant,
  createTestDomain,
  createTestTenantAdmin,
  createTestActiveSubscription,
} from '../setup/factories';
import { TenantModel, DomainModel, AdminUserModel, MailboxModel, AuditLogModel, PlanModel, DomainSubscriptionModel } from '../../src/db/models';
import { stalwartClient } from '../../src/stalwart/client';

let mongoServer: MongoMemoryServer;

describe('Concurrency & Quota Integrity: Race-Condition Defense', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    // Mock Stalwart client methods
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([
      { id: 'stalwart-dom-1', name: 'concurrency.test' },
    ]);
    vi.spyOn(stalwartClient, 'createAccount').mockResolvedValue({
      id: 'acc-1',
      name: 'test-user',
      domainId: 'stalwart-dom-1',
      emailAddress: 'test-user@concurrency.test',
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await AdminUserModel.deleteMany({});
    await MailboxModel.deleteMany({});
    await AuditLogModel.deleteMany({});
    await PlanModel.deleteMany({});
    await DomainSubscriptionModel.deleteMany({});
    vi.clearAllMocks();
  });

  it('50 concurrent mailbox creation requests against 49/50 quota allows exactly 1 to succeed and 49 to fail with 409', async () => {
    // Setup tenant with quota 50, currently at 49
    const tenant = await createTestTenant({
      name: 'High Concurrency Corp',
      mailboxLimit: 50,
      mailboxCount: 49,
      status: 'active',
    });

    const domain = await createTestDomain(tenant._id, {
      domainName: 'concurrency.test',
      stalwartDomainId: 'stalwart-dom-1',
    });
    await createTestActiveSubscription(domain._id, tenant._id);

    const tenantAdmin = await createTestTenantAdmin(tenant._id, {
      email: 'admin@concurrency.test',
    });

    // Mock Stalwart to return unique account ID per call
    let accountCounter = 0;
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([
      { id: 'stalwart-dom-1', name: domain.domainName },
    ]);
    vi.spyOn(stalwartClient, 'createAccount').mockImplementation(async (acc) => {
      accountCounter++;
      return { id: `stalwart-acc-${accountCounter}`, name: acc.name, domainId: acc.domainId, emailAddress: `${acc.name}@${domain.domainName}` };
    });

    // Launch 50 concurrent requests for distinct local parts
    const concurrentRequests = Array.from({ length: 50 }, (_, i) => {
      const localPart = `user${i + 1}`;
      return request(app)
        .post('/api/tenants/me/mailboxes')
        .set('Authorization', `Bearer ${tenantAdmin.token}`)
        .send({
          localPart,
          password: 'Password123!Secure',
        });
    });

    const responses = await Promise.all(concurrentRequests);

    const successful = responses.filter((res) => res.status === 201);
    const conflicts = responses.filter((res) => res.status === 409);

    expect(successful.length).toBe(1);
    expect(conflicts.length).toBe(49);

    // Verify all 49 conflicts have QUOTA_EXCEEDED error code
    conflicts.forEach((res) => {
      expect(res.body.error).toBe('QUOTA_EXCEEDED');
      expect(res.body.message).toContain('Mailbox limit of 50 reached');
    });

    // Verify database state: mailboxCount is exactly 50
    const updatedTenant = await TenantModel.findById(tenant._id);
    expect(updatedTenant?.mailboxCount).toBe(50);

    // Verify exactly 1 mailbox document was inserted into MongoDB
    const mailboxCountInDb = await MailboxModel.countDocuments({ tenantId: tenant._id });
    expect(mailboxCountInDb).toBe(1);
  });

  it('compensates and rolls back reserved quota when Stalwart API fails', async () => {
    const tenant = await createTestTenant({
      name: 'Rollback Corp',
      mailboxLimit: 10,
      mailboxCount: 5,
      status: 'active',
    });

    const rollbackDomain = await createTestDomain(tenant._id, {
      domainName: 'concurrency.test',
      stalwartDomainId: 'stalwart-dom-1',
    });
    await createTestActiveSubscription(rollbackDomain._id, tenant._id);

    const tenantAdmin = await createTestTenantAdmin(tenant._id, {
      email: 'admin@rollback.test',
    });

    // Mock Stalwart failure
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([
      { id: 'stalwart-dom-1', name: 'concurrency.test' },
    ]);
    vi.spyOn(stalwartClient, 'createAccount').mockRejectedValue(
      new Error('Stalwart upstream timeout / connection failure')
    );

    const res = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${tenantAdmin.token}`)
      .send({
        localPart: 'doomeduser',
        password: 'Password123!Secure',
      });

    // Should return 503 Service Unavailable, 502 Bad Gateway, or 500 from upstream Stalwart failure
    expect([500, 502, 503]).toContain(res.status);

    // Quota should have been rolled back to original 5
    const tenantAfter = await TenantModel.findById(tenant._id);
    expect(tenantAfter?.mailboxCount).toBe(5);

    // Mailbox should not be in MongoDB
    const mailbox = await MailboxModel.findOne({
      tenantId: tenant._id,
      localPart: 'doomeduser',
    });
    expect(mailbox).toBeNull();
  });

  it('rejects mailbox creation when tenant status is suspended, regardless of quota', async () => {
    const tenant = await createTestTenant({
      name: 'Suspended Corp',
      mailboxLimit: 100,
      mailboxCount: 5,
      status: 'suspended',
    });

    await createTestDomain(tenant._id, {
      domainName: 'concurrency.test',
      stalwartDomainId: 'stalwart-dom-1',
    });

    const tenantAdmin = await createTestTenantAdmin(tenant._id, {
      email: 'admin@suspended.test',
    });

    const res = await request(app)
      .post('/api/tenants/me/mailboxes')
      .set('Authorization', `Bearer ${tenantAdmin.token}`)
      .send({
        localPart: 'suspendeduser',
        password: 'Password123!Secure',
      });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('TENANT_SUSPENDED');

    // Mailbox count unchanged
    const tenantAfter = await TenantModel.findById(tenant._id);
    expect(tenantAfter?.mailboxCount).toBe(5);
  });
});
