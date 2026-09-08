import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../../src/app';
import { connectDatabase, disconnectDatabase } from '../../src/db/connection';
import {
  createTestSuperAdmin,
  createTestTenant,
  createTestDomain,
  createTestTenantAdmin,
} from '../setup/factories';
import { TenantModel, DomainModel, AdminUserModel, MailboxModel, AuditLogModel } from '../../src/db/models';
import { stalwartClient } from '../../src/stalwart/client';

let mongoServer: MongoMemoryServer;

describe('Tenant Lifecycle & Immutable Audit Trail Integration', () => {
  let superAdmin: any;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    // Mock Stalwart client methods
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([]);
    vi.spyOn(stalwartClient, 'createDomain').mockResolvedValue({ id: 'dom-mock-id', name: 'lifecycle.test' });
    vi.spyOn(stalwartClient, 'createAccount').mockResolvedValue({ id: 'acc-mock-id', name: 'user1' });
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
    vi.clearAllMocks();

    superAdmin = await createTestSuperAdmin({ email: 'super@toowix.com' });
  });

  it('performs full tenant lifecycle: creation -> suspension -> reactivation with verified audit events', async () => {
    vi.spyOn(stalwartClient, 'createDomain').mockResolvedValue({ id: 'dom-mock-id', name: 'lifecycle.test' });

    // 1. Super Admin creates a tenant directly
    const createRes = await request(app)
      .post('/api/platform/tenants')
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({
        name: 'Lifecycle Corp',
        domain: 'lifecycle.test',
        mailboxLimit: 25,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.name).toBe('Lifecycle Corp');
    const tenantId = createRes.body.id;

    // Verify audit log for creation
    const createAudit = await AuditLogModel.findOne({ action: 'TENANT_CREATED', tenantId });
    expect(createAudit).not.toBeNull();
    expect(createAudit?.actorEmail).toBe('super@toowix.com');

    // 2. Super Admin suspends the tenant
    const suspendRes = await request(app)
      .post(`/api/platform/tenants/${tenantId}/suspend`)
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({});

    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.success).toBe(true);

    const suspendedTenant = await TenantModel.findById(tenantId);
    expect(suspendedTenant?.status).toBe('suspended');

    const suspendedDomain = await DomainModel.findOne({ tenantId });
    expect(suspendedDomain?.status).toBe('suspended');

    // Verify audit log for suspension
    const suspendAudit = await AuditLogModel.findOne({ action: 'TENANT_SUSPENDED', tenantId });
    expect(suspendAudit).not.toBeNull();

    // 3. Super Admin reactivates the tenant
    const reactivateRes = await request(app)
      .post(`/api/platform/tenants/${tenantId}/reactivate`)
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({});

    expect(reactivateRes.status).toBe(200);
    expect(reactivateRes.body.success).toBe(true);

    const reactivatedTenant = await TenantModel.findById(tenantId);
    expect(reactivatedTenant?.status).toBe('active');

    const reactivatedDomain = await DomainModel.findOne({ tenantId });
    expect(reactivatedDomain?.status).toBe('active');

    // Verify audit log for reactivation
    const reactivateAudit = await AuditLogModel.findOne({ action: 'TENANT_REACTIVATED', tenantId });
    expect(reactivateAudit).not.toBeNull();
  });

  it('enforces quota boundary: rejects lowering mailboxLimit below existing mailboxCount', async () => {
    const tenant = await createTestTenant({
      name: 'Boundary Corp',
      mailboxLimit: 20,
      mailboxCount: 15,
      status: 'active',
    });

    // Attempt to lower quota below 15 -> must be rejected
    const invalidRes = await request(app)
      .patch(`/api/platform/tenants/${tenant._id}/mailbox-limit`)
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({ mailboxLimit: 10 });

    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.error).toBe('QUOTA_BELOW_USAGE');

    // Quota should remain untouched
    const unchangedTenant = await TenantModel.findById(tenant._id);
    expect(unchangedTenant?.mailboxLimit).toBe(20);

    // Increasing quota should succeed
    const validRes = await request(app)
      .patch(`/api/platform/tenants/${tenant._id}/mailbox-limit`)
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({ mailboxLimit: 30 });

    expect(validRes.status).toBe(200);
    expect(validRes.body.tenant.mailboxLimit).toBe(30);

    const updatedTenant = await TenantModel.findById(tenant._id);
    expect(updatedTenant?.mailboxLimit).toBe(30);
  });

  it('guarantees audit log immutability: returns 404 for modification or deletion attempts', async () => {
    const tenant = await createTestTenant({ name: 'Audit Corp' });
    const log = await AuditLogModel.create({
      actorId: superAdmin.id,
      actorRole: 'SUPER_ADMIN',
      actorEmail: superAdmin.email,
      actorIp: '127.0.0.1',
      tenantId: tenant._id,
      action: 'CRITICAL_SECURITY_EVENT',
      resource: 'SYSTEM',
      status: 'SUCCESS',
      metadata: { detail: 'Immutable record' },
      timestamp: new Date(),
    });

    // Attempt DELETE
    const deleteRes = await request(app)
      .delete(`/api/audit-logs/${log._id}`)
      .set('Authorization', `Bearer ${superAdmin.token}`);

    expect([404, 405]).toContain(deleteRes.status);

    // Attempt PATCH
    const patchRes = await request(app)
      .patch(`/api/audit-logs/${log._id}`)
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({ action: 'TAMPERED_EVENT' });

    expect([404, 405]).toContain(patchRes.status);

    // Verify record in database remains exactly as created
    const pristineLog = await AuditLogModel.findById(log._id);
    expect(pristineLog?.action).toBe('CRITICAL_SECURITY_EVENT');
  });

  it('allows Super Admin to query and filter audit logs, and Tenant Admin to query only their own', async () => {
    const tenant1 = await createTestTenant({ name: 'Tenant One' });
    const tenant2 = await createTestTenant({ name: 'Tenant Two' });

    const tenantAdmin1 = await createTestTenantAdmin(tenant1._id, { email: 'admin1@one.test' });

    // Insert audit records
    await AuditLogModel.create([
      {
        actorRole: 'TENANT_ADMIN',
        actorEmail: tenantAdmin1.email,
        tenantId: tenant1._id,
        action: 'TENANT1_ACTION',
        resource: 'MAILBOX',
        status: 'SUCCESS',
        timestamp: new Date(),
      },
      {
        actorRole: 'SUPER_ADMIN',
        actorEmail: superAdmin.email,
        tenantId: tenant2._id,
        action: 'TENANT2_ACTION',
        resource: 'MAILBOX',
        status: 'SUCCESS',
        timestamp: new Date(),
      },
    ]);

    // Super Admin queries all logs
    const superQueryRes = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${superAdmin.token}`);

    expect(superQueryRes.status).toBe(200);
    expect(superQueryRes.body.logs.length).toBeGreaterThanOrEqual(2);

    // Tenant Admin queries logs -> should ONLY see Tenant 1 logs
    const tenantQueryRes = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${tenantAdmin1.token}`);

    expect(tenantQueryRes.status).toBe(200);
    expect(tenantQueryRes.body.logs.every((l: any) => l.tenant_id === tenant1._id.toString())).toBe(true);
    expect(tenantQueryRes.body.logs.some((l: any) => l.action === 'TENANT2_ACTION')).toBe(false);
  });
});
