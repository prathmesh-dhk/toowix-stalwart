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
  MailboxMigrationJobModel,
} from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';
import {
  startMailboxMigration,
  startMigrationAndDelete,
  getMigrationJobStatus,
} from '../src/services/mailbox-migration.service';

let mongoServer: MongoMemoryServer;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Mailbox migrate-then-delete', () => {
  let tenantId: string;
  let otherTenantId: string;
  let tenantAdminToken: string;
  let domainId: string;
  let sourceMailboxId: string;
  let destinationMailboxId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await disconnectDatabase();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      [TenantModel, DomainModel, AdminUserModel, MailboxModel, MailboxMigrationJobModel].map((m) => m.deleteMany({}))
    );

    const tenant = await TenantModel.create({ name: 'Acme Corp', status: 'active', mailboxLimit: 50, mailboxCount: 2 });
    tenantId = tenant._id.toString();
    const otherTenant = await TenantModel.create({ name: 'Rival Inc', status: 'active', mailboxLimit: 10, mailboxCount: 0 });
    otherTenantId = otherTenant._id.toString();

    const domain = await DomainModel.create({ tenantId, domainName: 'acme.test', status: 'active', dnsStatus: 'active' });
    domainId = domain._id.toString();

    const source = await MailboxModel.create({
      tenantId,
      domainId,
      localPart: 'alice',
      address: 'alice@acme.test',
      status: 'active',
      stalwartAccountId: 'acc-source',
    });
    sourceMailboxId = source._id.toString();

    const destination = await MailboxModel.create({
      tenantId,
      domainId,
      localPart: 'bob',
      address: 'bob@acme.test',
      status: 'active',
      stalwartAccountId: 'acc-dest',
    });
    destinationMailboxId = destination._id.toString();

    const admin = await AdminUserModel.create({
      email: 'owner@acme.test',
      passwordHash: 'argon2id$mocked',
      role: 'TENANT_ADMIN',
      tenantId,
      status: 'active',
      twoFactorEnabled: true,
    });
    tenantAdminToken = generateOidcToken({
      id: admin._id.toString(),
      email: admin.email,
      role: 'TENANT_ADMIN',
      tenantId,
      twoFactorEnabled: true,
    });
  });

  describe('startMailboxMigration / startMigrationAndDelete / runMigrationJob', () => {
    it('migrates mail and strictly PRESERVES the source mailbox when deleteSourceAfter is false', async () => {
      vi.spyOn(stalwartClient, 'migrateAccountMail').mockResolvedValue({
        totalMessages: 8,
        migratedMessages: 8,
        failedMessageIds: [],
      });
      const deleteSpy = vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();

      const { jobId } = await startMailboxMigration(
        sourceMailboxId,
        destinationMailboxId,
        tenantId,
        false,
        'admin-1',
        'TENANT_ADMIN'
      );

      let job = await getMigrationJobStatus(jobId, tenantId);
      for (let i = 0; i < 20 && job.status !== 'completed' && job.status !== 'failed'; i++) {
        await wait(25);
        job = await getMigrationJobStatus(jobId, tenantId);
      }

      expect(job.status).toBe('completed');
      expect(job.totalMessages).toBe(8);
      expect(job.migratedMessages).toBe(8);
      expect(job.failedCount).toBe(0);
      expect(job.deleteSourceAfter).toBe(false);
      expect(stalwartClient.migrateAccountMail).toHaveBeenCalledWith(
        'acc-source',
        'acc-dest',
        'Migrated from alice@acme.test',
        expect.any(Function)
      );
      // Source mailbox MUST NOT be deleted
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(await MailboxModel.findById(sourceMailboxId)).not.toBeNull();
      expect(await MailboxModel.findById(destinationMailboxId)).not.toBeNull();
    });

    it('strictly fails and leaves the source mailbox intact if any messages fail to transfer', async () => {
      vi.spyOn(stalwartClient, 'migrateAccountMail').mockResolvedValue({
        totalMessages: 5,
        migratedMessages: 4,
        failedMessageIds: ['msg-fail-1'],
      });
      const deleteSpy = vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();

      const { jobId } = await startMailboxMigration(
        sourceMailboxId,
        destinationMailboxId,
        tenantId,
        false,
        'admin-1',
        'TENANT_ADMIN'
      );

      let job = await getMigrationJobStatus(jobId, tenantId);
      for (let i = 0; i < 20 && job.status !== 'completed' && job.status !== 'failed'; i++) {
        await wait(25);
        job = await getMigrationJobStatus(jobId, tenantId);
      }

      expect(job.status).toBe('failed');
      expect(job.error).toContain('1 failed message');
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(await MailboxModel.findById(sourceMailboxId)).not.toBeNull();
    });

    it('migrates mail then deletes the source mailbox when deleteSourceAfter is true (legacy startMigrationAndDelete)', async () => {
      vi.spyOn(stalwartClient, 'migrateAccountMail').mockResolvedValue({
        totalMessages: 12,
        migratedMessages: 12,
        failedMessageIds: [],
      });
      vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();

      const { jobId } = await startMigrationAndDelete(sourceMailboxId, destinationMailboxId, tenantId, 'admin-1', 'TENANT_ADMIN');

      // The runner is fire-and-forget; poll until it settles.
      let job = await getMigrationJobStatus(jobId, tenantId);
      for (let i = 0; i < 20 && job.status !== 'completed' && job.status !== 'failed'; i++) {
        await wait(25);
        job = await getMigrationJobStatus(jobId, tenantId);
      }

      expect(job.status).toBe('completed');
      expect(job.totalMessages).toBe(12);
      expect(job.migratedMessages).toBe(12);
      expect(stalwartClient.migrateAccountMail).toHaveBeenCalledWith(
        'acc-source',
        'acc-dest',
        'Migrated from alice@acme.test',
        expect.any(Function)
      );
      expect(stalwartClient.deleteAccount).toHaveBeenCalledWith('acc-source');
      expect(await MailboxModel.findById(sourceMailboxId)).toBeNull();
      expect(await MailboxModel.findById(destinationMailboxId)).not.toBeNull();
    });

    it('leaves the source mailbox untouched and marks the job failed when migration errors', async () => {
      vi.spyOn(stalwartClient, 'migrateAccountMail').mockRejectedValue(new Error('Stalwart unreachable'));
      const deleteSpy = vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();

      const { jobId } = await startMigrationAndDelete(sourceMailboxId, destinationMailboxId, tenantId, 'admin-1', 'TENANT_ADMIN');

      let job = await getMigrationJobStatus(jobId, tenantId);
      for (let i = 0; i < 20 && job.status !== 'completed' && job.status !== 'failed'; i++) {
        await wait(25);
        job = await getMigrationJobStatus(jobId, tenantId);
      }

      expect(job.status).toBe('failed');
      expect(job.error).toContain('Stalwart unreachable');
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(await MailboxModel.findById(sourceMailboxId)).not.toBeNull();
    });

    it('rejects a destination in another tenant', async () => {
      const foreignDest = await MailboxModel.create({
        tenantId: otherTenantId,
        domainId,
        localPart: 'eve',
        address: 'eve@rival.test',
        status: 'active',
        stalwartAccountId: 'acc-foreign',
      });

      await expect(
        startMigrationAndDelete(sourceMailboxId, foreignDest._id.toString(), tenantId, 'admin-1', 'TENANT_ADMIN')
      ).rejects.toMatchObject({ code: 'DESTINATION_NOT_FOUND' });
    });

    it('rejects migrating a mailbox into itself', async () => {
      await expect(
        startMigrationAndDelete(sourceMailboxId, sourceMailboxId, tenantId, 'admin-1', 'TENANT_ADMIN')
      ).rejects.toMatchObject({ code: 'SAME_MAILBOX' });
    });
  });

  describe('POST /api/mailboxes/:id/migrate', () => {
    it('202s with a jobId, completes migration, and strictly PRESERVES source mailbox', async () => {
      vi.spyOn(stalwartClient, 'migrateAccountMail').mockResolvedValue({
        totalMessages: 6,
        migratedMessages: 6,
        failedMessageIds: [],
      });
      const deleteSpy = vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();

      const res = await request(app)
        .post(`/api/mailboxes/${sourceMailboxId}/migrate`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ destinationMailboxId });

      expect(res.status).toBe(202);
      expect(res.body.jobId).toBeTruthy();

      let statusRes = await request(app)
        .get(`/api/mailboxes/migration-jobs/${res.body.jobId}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      for (let i = 0; i < 20 && statusRes.body.status !== 'completed'; i++) {
        await wait(25);
        statusRes = await request(app)
          .get(`/api/mailboxes/migration-jobs/${res.body.jobId}`)
          .set('Authorization', `Bearer ${tenantAdminToken}`);
      }

      expect(statusRes.body.status).toBe('completed');
      expect(statusRes.body.totalMessages).toBe(6);
      expect(statusRes.body.migratedMessages).toBe(6);
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(await MailboxModel.findById(sourceMailboxId)).not.toBeNull();
    });
  });

  describe('POST /api/mailboxes/:id/migrate-and-delete', () => {
    it('202s with a jobId and eventually completes', async () => {
      vi.spyOn(stalwartClient, 'migrateAccountMail').mockResolvedValue({
        totalMessages: 3,
        migratedMessages: 3,
        failedMessageIds: [],
      });
      vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();

      const res = await request(app)
        .post(`/api/mailboxes/${sourceMailboxId}/migrate-and-delete`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ destinationMailboxId });

      expect(res.status).toBe(202);
      expect(res.body.jobId).toBeTruthy();

      let statusRes = await request(app)
        .get(`/api/mailboxes/migration-jobs/${res.body.jobId}`)
        .set('Authorization', `Bearer ${tenantAdminToken}`);
      for (let i = 0; i < 20 && statusRes.body.status !== 'completed'; i++) {
        await wait(25);
        statusRes = await request(app)
          .get(`/api/mailboxes/migration-jobs/${res.body.jobId}`)
          .set('Authorization', `Bearer ${tenantAdminToken}`);
      }

      expect(statusRes.body.status).toBe('completed');
    });

    it('404s when the destination mailbox does not exist', async () => {
      const res = await request(app)
        .post(`/api/mailboxes/${sourceMailboxId}/migrate-and-delete`)
        .set('Authorization', `Bearer ${tenantAdminToken}`)
        .send({ destinationMailboxId: '64b7f0f0f0f0f0f0f0f0f0f0' });

      expect(res.status).toBe(404);
    });
  });
});
