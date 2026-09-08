import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase, checkDatabaseHealth } from '../src/db/connection';
import {
  TenantModel,
  DomainModel,
  AdminUserModel,
  MailboxModel,
  RegistrationApplicationModel,
  ActivationTokenModel,
  AuditLogModel,
} from '../src/db/models';

let mongoServer: MongoMemoryServer;

describe('Phase 1: Foundation & MongoDB Data Layer', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await connectDatabase({ uri, autoIndex: true });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clean all collections between tests
    const collections = mongoose.connection.collections;
    for (const key in collections) {
      await collections[key].deleteMany({});
    }
  });

  describe('Connection & Health Checks', () => {
    it('should report healthy database connection', async () => {
      const health = await checkDatabaseHealth();
      expect(health.status).toBe('healthy');
      expect(typeof health.pingMs).toBe('number');
    });
  });

  describe('Tenant Model & Compound Uniqueness', () => {
    it('should create a valid tenant with default quotas', async () => {
      const tenant = await TenantModel.create({
        name: 'Acme Corp',
        status: 'approved_pending_setup',
      });

      expect(tenant._id).toBeDefined();
      expect(tenant.mailboxLimit).toBe(50);
      expect(tenant.mailboxCount).toBe(0);
      expect(tenant.status).toBe('approved_pending_setup');
    });

    it('should reject invalid tenant status', async () => {
      await expect(
        TenantModel.create({
          name: 'Invalid Corp',
          status: 'non_existent_status' as any,
        })
      ).rejects.toThrow();
    });
  });

  describe('Domain Model & 1-Tenant = 1-Domain Constraint', () => {
    it('should enforce 1-to-1 relationship between tenant and domain', async () => {
      const tenant = await TenantModel.create({ name: 'Beta Ltd' });

      // First domain succeeds
      const domain1 = await DomainModel.create({
        tenantId: tenant._id,
        domainName: 'beta.com',
      });
      expect(domain1.domainName).toBe('beta.com');

      // Second domain for same tenant fails due to unique tenantId index
      await expect(
        DomainModel.create({
          tenantId: tenant._id,
          domainName: 'beta-alias.com',
        })
      ).rejects.toThrow(/duplicate key error/i);
    });

    it('should enforce global uniqueness for domain names', async () => {
      const tenantA = await TenantModel.create({ name: 'Tenant A' });
      const tenantB = await TenantModel.create({ name: 'Tenant B' });

      await DomainModel.create({
        tenantId: tenantA._id,
        domainName: 'shared-domain.com',
      });

      // Second tenant trying to claim the same domain must fail
      await expect(
        DomainModel.create({
          tenantId: tenantB._id,
          domainName: 'shared-domain.com',
        })
      ).rejects.toThrow(/duplicate key error/i);
    });
  });

  describe('AdminUser Model & Role Validation', () => {
    it('should allow SUPER_ADMIN with no tenantId', async () => {
      const admin = await AdminUserModel.create({
        email: 'super@toowix.com',
        passwordHash: 'argon2id_hash_sample',
        role: 'SUPER_ADMIN',
        twoFactorEnabled: true,
      });

      expect(admin.role).toBe('SUPER_ADMIN');
      expect(admin.tenantId).toBeNull();
    });

    it('should reject SUPER_ADMIN with a tenantId', async () => {
      const tenant = await TenantModel.create({ name: 'Test Tenant' });

      await expect(
        AdminUserModel.create({
          email: 'invalid-super@toowix.com',
          passwordHash: 'hash',
          role: 'SUPER_ADMIN',
          tenantId: tenant._id,
        })
      ).rejects.toThrow(/SUPER_ADMIN must not have a tenantId/);
    });

    it('should require tenantId for TENANT_ADMIN', async () => {
      await expect(
        AdminUserModel.create({
          email: 'admin@tenant.com',
          passwordHash: 'hash',
          role: 'TENANT_ADMIN',
          tenantId: null as any,
        })
      ).rejects.toThrow(/TENANT_ADMIN must have a tenantId/);
    });

    it('should enforce unique email across admin users', async () => {
      await AdminUserModel.create({
        email: 'unique@admin.com',
        passwordHash: 'hash',
        role: 'SUPER_ADMIN',
      });

      await expect(
        AdminUserModel.create({
          email: 'unique@admin.com',
          passwordHash: 'hash2',
          role: 'SUPER_ADMIN',
        })
      ).rejects.toThrow(/duplicate key error/i);
    });
  });

  describe('Mailbox Model & Atomic Tenant Scoping', () => {
    it('should create a mailbox with embedded security profile', async () => {
      const tenant = await TenantModel.create({ name: 'Delta Corp' });
      const domain = await DomainModel.create({ tenantId: tenant._id, domainName: 'delta.com' });

      const mailbox = await MailboxModel.create({
        tenantId: tenant._id,
        domainId: domain._id,
        localPart: 'info',
        address: 'info@delta.com',
        security: {
          twoFactorEnabled: false,
          mustChangePassword: true,
          temporaryPasswordHash: 'temp_hash',
        },
      });

      expect(mailbox.address).toBe('info@delta.com');
      expect(mailbox.security.mustChangePassword).toBe(true);
      expect(mailbox.security.twoFactorEnabled).toBe(false);
    });

    it('should reject duplicate localPart within the same tenant', async () => {
      const tenant = await TenantModel.create({ name: 'Echo Corp' });
      const domain = await DomainModel.create({ tenantId: tenant._id, domainName: 'echo.com' });

      await MailboxModel.create({
        tenantId: tenant._id,
        domainId: domain._id,
        localPart: 'support',
        address: 'support@echo.com',
      });

      await expect(
        MailboxModel.create({
          tenantId: tenant._id,
          domainId: domain._id,
          localPart: 'support',
          address: 'support-duplicate@echo.com',
        })
      ).rejects.toThrow(/duplicate key error/i);
    });

    it('should atomically increment tenant mailbox count only if below limit', async () => {
      const tenant = await TenantModel.create({
        name: 'Quota Corp',
        mailboxLimit: 2,
        mailboxCount: 0,
      });

      // 1. First increment succeeds
      const res1 = await TenantModel.findOneAndUpdate(
        { _id: tenant._id, mailboxCount: { $lt: tenant.mailboxLimit } },
        { $inc: { mailboxCount: 1 } },
        { returnDocument: 'after' }
      );
      expect(res1?.mailboxCount).toBe(1);

      // 2. Second increment succeeds
      const res2 = await TenantModel.findOneAndUpdate(
        { _id: tenant._id, mailboxCount: { $lt: tenant.mailboxLimit } },
        { $inc: { mailboxCount: 1 } },
        { returnDocument: 'after' }
      );
      expect(res2?.mailboxCount).toBe(2);

      // 3. Third increment fails because mailboxCount (2) is NOT < mailboxLimit (2)
      const res3 = await TenantModel.findOneAndUpdate(
        { _id: tenant._id, mailboxCount: { $lt: tenant.mailboxLimit } },
        { $inc: { mailboxCount: 1 } },
        { returnDocument: 'after' }
      );
      expect(res3).toBeNull(); // Atomic operation rejected!
    });
  });

  describe('RegistrationApplication & ActivationToken Models', () => {
    it('should create a registration application in PENDING_REVIEW status', async () => {
      const app = await RegistrationApplicationModel.create({
        companyName: 'New Org Inc',
        requestedDomain: 'neworg.com',
        applicantName: 'Alice Smith',
        contactEmail: 'alice@external.com',
      });

      expect(app.status).toBe('PENDING_REVIEW');
      expect(app.requestedDomain).toBe('neworg.com');
    });

    it('should create an activation token with TTL expiration', async () => {
      const tenant = await TenantModel.create({ name: 'Token Org' });
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48h

      const token = await ActivationTokenModel.create({
        tenantId: tenant._id,
        tokenHash: 'sha256_mock_hash_string',
        contactEmail: 'alice@external.com',
        expiresAt,
      });

      expect(token.tokenHash).toBe('sha256_mock_hash_string');
      expect(token.expiresAt.getTime()).toBe(expiresAt.getTime());
    });
  });

  describe('AuditLog Model', () => {
    it('should record an append-only audit log entry', async () => {
      const log = await AuditLogModel.create({
        actorRole: 'SUPER_ADMIN',
        actorEmail: 'admin@toowix.com',
        action: 'TENANT_APPLICATION_APPROVED',
        resource: 'TENANT',
        resourceId: 'test-id-123',
        status: 'SUCCESS',
        metadata: { domain: 'neworg.com' },
      });

      expect(log._id).toBeDefined();
      expect(log.action).toBe('TENANT_APPLICATION_APPROVED');
      expect(log.timestamp).toBeInstanceOf(Date);
    });
  });
});
