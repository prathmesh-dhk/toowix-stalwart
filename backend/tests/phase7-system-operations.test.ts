import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  AdminUserModel,
  TenantModel,
  DomainModel,
  MailboxModel,
  BackupRecordModel,
  SystemSettingsModel,
  AuditLogModel,
} from '../src/db/models';
import { generateOidcToken } from '../src/auth/service';
import { stalwartClient } from '../src/stalwart/client';
import { backupService } from '../src/services/backup.service';
import { alertService } from '../src/services/alert.service';
import { metricsService } from '../src/services/metrics.service';

let mongoServer: MongoMemoryServer;
let tempBackupsDir: string;

describe('Phase 7: Production Operations, System Health, Backup Engine & Prometheus Metrics', () => {
  let superAdminToken: string;
  let superAdminId: string;

  let tenantAId: string;
  let tenantAdminAToken: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri() });

    // Setup isolated temporary backups directory for testing
    tempBackupsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'toowix-test-backups-'));
    backupService.setBackupsDir(tempBackupsDir);

    // Mock Stalwart methods
    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([
      {
        id: 'dom-acme',
        name: 'acme.test',
        description: 'Acme Corp',
        isEnabled: true,
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]);

    vi.spyOn(stalwartClient, 'listAccounts').mockResolvedValue([
      {
        id: 'acc-service',
        name: 'toowix-service',
        emailAddress: 'toowix-service@toowix.test',
      },
      {
        id: 'acc-user',
        name: 'alice',
        emailAddress: 'alice@acme.test',
      },
    ]);
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
    // Clean up temporary backups directory
    if (fs.existsSync(tempBackupsDir)) {
      fs.rmSync(tempBackupsDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await AdminUserModel.deleteMany({});
    await MailboxModel.deleteMany({});
    await BackupRecordModel.deleteMany({});
    await SystemSettingsModel.deleteMany({});
    await AuditLogModel.deleteMany({});
    alertService.resetFailureCounts();
    metricsService.resetMetrics();

    // 1. Seed Super Admin
    const superAdmin = await AdminUserModel.create({
      email: 'ops-admin@toowix.test',
      passwordHash: 'argon2id$mocked',
      role: 'SUPER_ADMIN',
      status: 'active',
      twoFactorEnabled: true,
    });
    superAdminId = (superAdmin._id as any).toString();
    superAdminToken = generateOidcToken({
      userId: superAdminId,
      email: 'ops-admin@toowix.test',
      role: 'SUPER_ADMIN',
    });

    // 2. Seed Tenant A and Tenant Admin
    const tenantA = await TenantModel.create({
      name: 'Acme Corp',
      status: 'active',
      mailboxLimit: 25,
      mailboxCount: 2,
    });
    tenantAId = (tenantA._id as any).toString();

    const domainA = await DomainModel.create({
      tenantId: tenantA._id,
      domainName: 'acme.test',
      status: 'active',
    });

    const tenantAdminA = await AdminUserModel.create({
      email: 'admin@acme.test',
      passwordHash: 'argon2id$mocked',
      role: 'TENANT_ADMIN',
      tenantId: tenantA._id,
      status: 'active',
      twoFactorEnabled: true,
    });

    tenantAdminAToken = generateOidcToken({
      userId: (tenantAdminA._id as any).toString(),
      email: 'admin@acme.test',
      role: 'TENANT_ADMIN',
      tenantId: tenantAId,
    });

    // Seed Mailboxes for Tenant A
    await MailboxModel.create([
      {
        tenantId: tenantA._id,
        domainId: domainA._id,
        localPart: 'alice',
        address: 'alice@acme.test',
        status: 'active',
      },
      {
        tenantId: tenantA._id,
        domainId: domainA._id,
        localPart: 'bob',
        address: 'bob@acme.test',
        status: 'active',
      },
    ]);
  });

  describe('1. System Health & Status Endpoints', () => {
    it('GET /api/system/status returns aggregated system counts and operational state', async () => {
      const res = await request(app)
        .get('/api/system/status')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('operational');
      expect(res.body.metrics.tenants.total).toBe(1);
      expect(res.body.metrics.tenants.active).toBe(1);
      expect(res.body.metrics.domains.total).toBe(1);
      expect(res.body.metrics.mailboxes.total).toBe(2);
      expect(res.body.metrics.mailboxes.active).toBe(2);
      expect(res.body.stalwart).toBeDefined();
    });

    it('GET /api/system/health returns detailed health checks, latencies, memory, and runtime metrics', async () => {
      const res = await request(app)
        .get('/api/system/health')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
      expect(res.body.services.mongodb.status).toBe('healthy');
      expect(typeof res.body.services.mongodb.pingMs).toBe('number');
      expect(res.body.services.stalwart).toBeDefined();
      expect(res.body.system.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(res.body.system.memoryUsage.rssMb).toBeGreaterThan(0);
      expect(res.body.backups.total).toBe(0);
      expect(res.body.alerts).toBeDefined();
    });

    it('denies non-super admins and unauthenticated callers with 403 and 401', async () => {
      const unauth = await request(app).get('/api/system/health');
      expect(unauth.status).toBe(401);

      const tenantAdminRes = await request(app)
        .get('/api/system/health')
        .set('Authorization', `Bearer ${tenantAdminAToken}`);
      expect(tenantAdminRes.status).toBe(403);
    });
  });

  describe('2. Backup Engine (AES-256-GCM, Checksums & Integrity Verification)', () => {
    it('POST /api/system/backup creates an on-demand encrypted backup and logs audit event', async () => {
      const res = await request(app)
        .post('/api/system/backup')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.backup).toBeDefined();
      expect(res.body.backup.id).toBeDefined();
      expect(res.body.backup.filename).toContain('toowix-backup-');
      expect(res.body.backup.encrypted).toBe(true);
      expect(res.body.backup.sizeBytes).toBeGreaterThan(0);
      expect(res.body.backup.checksumSha256).toBeDefined();
      expect(res.body.backup.documentCounts.tenants).toBe(1);
      expect(res.body.backup.documentCounts.mailboxes).toBe(2);

      // Verify file exists on disk
      const filePath = path.join(tempBackupsDir, res.body.backup.filename);
      expect(fs.existsSync(filePath)).toBe(true);

      // Verify DB record
      const dbRecord = await BackupRecordModel.findOne({ id: res.body.backup.id });
      expect(dbRecord).not.toBeNull();
      expect(dbRecord?.checksumSha256).toBe(res.body.backup.checksumSha256);

      // Verify Audit Log
      const audit = await AuditLogModel.findOne({ action: 'SYSTEM_BACKUP_CREATED' });
      expect(audit).not.toBeNull();
      expect(audit?.actorEmail).toBe('ops-admin@toowix.test');
      expect(audit?.resourceId).toBe(res.body.backup.id);
    });

    it('GET /api/system/backups lists historical backups in descending order', async () => {
      // Create two backups
      await backupService.createBackup({ actorEmail: 'ops-admin@toowix.test' });
      await backupService.createBackup({ actorEmail: 'ops-admin@toowix.test' });

      const res = await request(app)
        .get('/api/system/backups')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.backups).toBeDefined();
      expect(res.body.backups.length).toBe(2);
    });

    it('POST /api/system/backups/:id/verify verifies checksum and decrypts payload', async () => {
      const backup = await backupService.createBackup({ actorEmail: 'ops-admin@toowix.test' });

      const res = await request(app)
        .post(`/api/system/backups/${backup.id}/verify`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.checksumVerified).toBe(true);
      expect(res.body.decryptionVerified).toBe(true);
      expect(res.body.documentCounts.tenants).toBe(1);
      expect(res.body.documentCounts.mailboxes).toBe(2);
      expect(res.body.documentCounts.admins).toBe(2); // Super admin + Tenant admin
    });

    it('POST /api/system/backups/:id/verify detects file corruption or checksum tampering', async () => {
      const backup = await backupService.createBackup({ actorEmail: 'ops-admin@toowix.test' });
      const filePath = path.join(tempBackupsDir, backup.filename);

      // Tamper with file content
      fs.writeFileSync(filePath, 'tampered-data-corrupted', 'utf8');

      const res = await request(app)
        .post(`/api/system/backups/${backup.id}/verify`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.checksumVerified).toBe(false);
      expect(res.body.error).toContain('Checksum mismatch');
    });

    it('DELETE /api/system/backups/:id deletes the record and unlinks file from disk', async () => {
      const backup = await backupService.createBackup({ actorEmail: 'ops-admin@toowix.test' });
      const filePath = path.join(tempBackupsDir, backup.filename);
      expect(fs.existsSync(filePath)).toBe(true);

      const res = await request(app)
        .delete(`/api/system/backups/${backup.id}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Confirm unlinked
      expect(fs.existsSync(filePath)).toBe(false);
      const dbRecord = await BackupRecordModel.findOne({ id: backup.id });
      expect(dbRecord).toBeNull();
    });
  });

  describe('3. Outage Alerting Engine & Webhooks', () => {
    it('GET /api/system/alerts/config and POST /api/system/alerts/config manage alert settings', async () => {
      // 1. Initial config
      const initial = await request(app)
        .get('/api/system/alerts/config')
        .set('Authorization', `Bearer ${superAdminToken}`);
      expect(initial.status).toBe(200);

      // 2. Update config
      const updateRes = await request(app)
        .post('/api/system/alerts/config')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          webhookUrl: 'https://hooks.slack.com/services/MOCK/TEST/12345',
          alertEmail: 'alerts@toowix.test',
          alertsEnabled: true,
          consecutiveFailureThreshold: 2,
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.success).toBe(true);
      expect(updateRes.body.config.alertsEnabled).toBe(true);
      expect(updateRes.body.config.consecutiveFailureThreshold).toBe(2);

      // 3. Verify in DB
      const settings = await SystemSettingsModel.findOne({ key: 'alerts_config' });
      expect(settings?.webhookUrl).toBe('https://hooks.slack.com/services/MOCK/TEST/12345');
      expect(settings?.alertsEnabled).toBe(true);

      // 4. Verify audit log
      const audit = await AuditLogModel.findOne({ action: 'SYSTEM_ALERTS_CONFIG_UPDATED' });
      expect(audit).not.toBeNull();
    });

    it('POST /api/system/alerts/test dispatches test notification payload to webhook', async () => {
      const dispatchSpy = vi.spyOn(alertService, 'dispatchWebhook').mockResolvedValue({
        success: true,
        statusCode: 200,
      });

      const res = await request(app)
        .post('/api/system/alerts/test')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          webhookUrl: 'https://discord.com/api/webhooks/mock/test',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(dispatchSpy).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/mock/test',
        expect.objectContaining({
          severity: 'INFO',
          title: expect.stringContaining('Test Health Alert'),
        })
      );
    });

    it('evaluates consecutive health failures and triggers CRITICAL outage webhook', async () => {
      await alertService.updateAlertConfig({
        webhookUrl: 'https://hooks.slack.com/services/MOCK/OUTAGE/ALERTS',
        alertsEnabled: true,
        consecutiveFailureThreshold: 2,
      });

      const dispatchSpy = vi.spyOn(alertService, 'dispatchWebhook').mockResolvedValue({
        success: true,
        statusCode: 200,
      });

      // Failure 1: consecutive = 1 (threshold is 2, so should not dispatch yet)
      await alertService.evaluateServiceHealth('mongodb', false, { error: 'Connection refused' });
      expect(dispatchSpy).not.toHaveBeenCalled();

      // Failure 2: consecutive = 2 (meets threshold -> fires CRITICAL alert)
      await alertService.evaluateServiceHealth('mongodb', false, { error: 'Connection refused' });
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
      expect(dispatchSpy).toHaveBeenCalledWith(
        'https://hooks.slack.com/services/MOCK/OUTAGE/ALERTS',
        expect.objectContaining({
          severity: 'CRITICAL',
          service: 'MONGODB',
        })
      );

      // Recovery: service becomes healthy -> fires RESOLVED alert
      await alertService.evaluateServiceHealth('mongodb', true);
      expect(dispatchSpy).toHaveBeenCalledTimes(2);
      expect(dispatchSpy).toHaveBeenLastCalledWith(
        'https://hooks.slack.com/services/MOCK/OUTAGE/ALERTS',
        expect.objectContaining({
          severity: 'RESOLVED',
          service: 'MONGODB',
        })
      );
    });
  });

  describe('4. Prometheus Metrics Exporter (/metrics)', () => {
    it('GET /metrics exports standard Prometheus text format with gauges and request counters', async () => {
      // Trigger a couple API requests to populate HTTP metric counters
      await request(app).get('/api/system/status').set('Authorization', `Bearer ${superAdminToken}`);
      await request(app).get('/api/system/health').set('Authorization', `Bearer ${superAdminToken}`);

      const res = await request(app).get('/metrics');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');

      const body = res.text;
      expect(body).toContain('# HELP toowix_mongodb_up');
      expect(body).toContain('# TYPE toowix_mongodb_up gauge');
      expect(body).toContain('toowix_mongodb_up 1');

      expect(body).toContain('# HELP toowix_stalwart_up');
      expect(body).toContain('# TYPE toowix_stalwart_up gauge');

      expect(body).toContain('toowix_tenants_total{status="active"} 1');
      expect(body).toContain('toowix_domains_total 1');
      expect(body).toContain('toowix_mailboxes_total{status="active"} 2');

      expect(body).toContain('nodejs_process_uptime_seconds');
      expect(body).toContain('nodejs_heap_bytes_used');

      expect(body).toContain('# HELP toowix_http_requests_total');
      expect(body).toContain('toowix_http_requests_total{method="GET",route="/api/system/status",status="200"}');
    });
  });
});
