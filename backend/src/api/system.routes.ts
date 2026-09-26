import { Router, Request, Response } from 'express';
import { requireSuperAdmin } from '../auth/middleware';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { MailboxModel } from '../db/models/Mailbox';
import { BackupRecordModel } from '../db/models/BackupRecord';
import { AuditLogModel } from '../db/models/AuditLog';
import { checkDatabaseHealth } from '../db/connection';
import { reconciliationService } from '../services/reconciliation.service';
import { backupService } from '../services/backup.service';
import { alertService } from '../services/alert.service';
import { emailService } from '../services/email.service';
import { stalwartClient } from '../stalwart/client';
import { config } from '../config';
import http from 'http';
import https from 'https';

export const systemRouter = Router();

systemRouter.use(requireSuperAdmin);

// 1. High-Level System Status & Counters
systemRouter.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    // 1. Query MongoDB counts
    const [
      totalTenants,
      activeTenants,
      suspendedTenants,
      totalDomains,
      totalMailboxes,
      activeMailboxes,
      suspendedMailboxes,
    ] = await Promise.all([
      TenantModel.countDocuments(),
      TenantModel.countDocuments({ status: 'active' }),
      TenantModel.countDocuments({ status: 'suspended' }),
      DomainModel.countDocuments(),
      MailboxModel.countDocuments(),
      MailboxModel.countDocuments({ status: 'active' }),
      MailboxModel.countDocuments({ status: 'suspended' }),
    ]);

    // 2. Introspect Stalwart
    let stalwartInfo: any = { status: 'unknown' };
    try {
      const authHeader = `Basic ${Buffer.from(`${config.stalwart.user}:${config.stalwart.password}`).toString('base64')}`;
      const targetUrl = new URL(`${config.stalwart.url}/api/account`);
      const transport = targetUrl.protocol === 'https:' ? https : http;

      stalwartInfo = await new Promise((resolve) => {
        const req = transport.request(
          targetUrl,
          {
            method: 'GET',
            rejectUnauthorized: false,
            headers: { Authorization: authHeader },
            timeout: 3000,
          },
          (resp) => {
            let data = '';
            resp.on('data', chunk => data += chunk);
            resp.on('end', () => {
              if (resp.statusCode && resp.statusCode >= 200 && resp.statusCode < 300) {
                try {
                  const parsed = JSON.parse(data);
                  resolve({
                    status: 'connected',
                    edition: parsed.edition || 'community',
                    locale: parsed.locale,
                    permissionCount: parsed.permissions?.length || 0,
                  });
                } catch {
                  resolve({ status: 'connected', raw: data });
                }
              } else {
                resolve({ status: 'degraded', httpStatus: resp.statusCode });
              }
            });
          }
        );
        req.on('error', err => resolve({ status: 'unreachable', error: err.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ status: 'timeout' });
        });
        req.end();
      });
    } catch (err: any) {
      stalwartInfo = { status: 'unreachable', error: err.message };
    }

    res.status(200).json({
      status: 'operational',
      timestamp: new Date().toISOString(),
      stalwart: stalwartInfo,
      metrics: {
        tenants: {
          total: totalTenants,
          active: activeTenants,
          suspended: suspendedTenants,
        },
        domains: {
          total: totalDomains,
        },
        mailboxes: {
          total: totalMailboxes,
          active: activeMailboxes,
          provisioning: 0,
          failed: suspendedMailboxes,
        },
      },
    });
  } catch (err: any) {
    console.error('[System Status Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to aggregate system status' });
  }
});

// 2. Detailed Comprehensive System Health
systemRouter.get('/health', async (_req: Request, res: Response): Promise<void> => {
  try {
    const startTime = Date.now();

    // 1. Database Health
    const dbHealth = await checkDatabaseHealth();
    const isDbHealthy = dbHealth.status === 'healthy';

    // 2. Stalwart Health
    let stalwartStatus: 'connected' | 'degraded' | 'unreachable' = 'unreachable';
    let stalwartLatencyMs = 0;
    let stalwartMetadata: any = null;

    try {
      const swStart = Date.now();
      const authHeader = `Basic ${Buffer.from(`${config.stalwart.user}:${config.stalwart.password}`).toString('base64')}`;
      const targetUrl = new URL(`${config.stalwart.url}/api/account`);
      const transport = targetUrl.protocol === 'https:' ? https : http;

      const swResult: any = await new Promise((resolve) => {
        const req = transport.request(
          targetUrl,
          {
            method: 'GET',
            rejectUnauthorized: false,
            headers: { Authorization: authHeader },
            timeout: 3000,
          },
          (resp) => {
            let data = '';
            resp.on('data', c => data += c);
            resp.on('end', () => {
              const latency = Date.now() - swStart;
              if (resp.statusCode && resp.statusCode >= 200 && resp.statusCode < 300) {
                try {
                  const parsed = JSON.parse(data);
                  resolve({
                    status: 'connected',
                    latency,
                    edition: parsed.edition || 'community',
                    locale: parsed.locale || 'en-US',
                  });
                } catch {
                  resolve({ status: 'connected', latency });
                }
              } else {
                resolve({ status: 'degraded', latency, httpStatus: resp.statusCode });
              }
            });
          }
        );
        req.on('error', (err) => resolve({ status: 'unreachable', latency: Date.now() - swStart, error: err.message }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ status: 'unreachable', latency: Date.now() - swStart, error: 'Timeout' });
        });
        req.end();
      });

      stalwartStatus = swResult.status;
      stalwartLatencyMs = swResult.latency;
      stalwartMetadata = swResult;
    } catch {
      stalwartStatus = 'unreachable';
    }

    const isStalwartHealthy = stalwartStatus === 'connected';

    // 3. Evaluate health via AlertService (consecutive failure tracking)
    await Promise.all([
      alertService.evaluateServiceHealth('mongodb', isDbHealthy, { pingMs: dbHealth.pingMs }),
      alertService.evaluateServiceHealth('stalwart', isStalwartHealthy, { latencyMs: stalwartLatencyMs }),
    ]);

    // 4. Runtime & Process Metrics
    const memory = process.memoryUsage();
    const [totalBackups, latestBackup, alertConfig] = await Promise.all([
      BackupRecordModel.countDocuments(),
      BackupRecordModel.findOne().sort({ createdAt: -1 }).lean(),
      alertService.getAlertConfig(),
    ]);

    const isSystemOperational = isDbHealthy && isStalwartHealthy;

    res.status(200).json({
      status: isSystemOperational ? 'operational' : 'degraded',
      timestamp: new Date().toISOString(),
      evaluationTimeMs: Date.now() - startTime,
      services: {
        mongodb: {
          status: dbHealth.status,
          pingMs: dbHealth.pingMs || 0,
          error: dbHealth.error,
        },
        stalwart: {
          status: stalwartStatus,
          latencyMs: stalwartLatencyMs,
          edition: stalwartMetadata?.edition || 'community',
          locale: stalwartMetadata?.locale || 'en-US',
          queueDepth: 0,
        },
      },
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryUsage: {
          rssMb: Math.round(memory.rss / (1024 * 1024)),
          heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
          heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
        },
      },
      backups: {
        total: totalBackups,
        latestBackupAt: latestBackup ? latestBackup.createdAt : null,
      },
      alerts: {
        alertsEnabled: alertConfig.alertsEnabled,
        hasWebhook: Boolean(alertConfig.webhookUrl),
        consecutiveFailures: alertService.getFailureCounts(),
      },
    });
  } catch (err: any) {
    console.error('[System Health Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to evaluate system health' });
  }
});

// 3. Drift Reconciliation Report
systemRouter.get('/reconciliation', async (_req: Request, res: Response): Promise<void> => {
  try {
    const report = await reconciliationService.checkDrift();
    res.status(200).json(report);
  } catch (err: any) {
    console.error('[System Reconciliation Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to generate reconciliation drift report' });
  }
});

// 4. On-Demand Quota Drift Repair
systemRouter.post('/reconciliation/sync-quota', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await reconciliationService.repairQuotaDrift();
    res.status(200).json({
      success: true,
      message: `Quota drift repaired for ${result.repairedCount} tenant(s).`,
      repaired: result.details,
    });
  } catch (err: any) {
    console.error('[System Quota Sync Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to repair quota drift' });
  }
});

// 4b. 1-Click Stalwart Entity Drift Auto-Repair
systemRouter.post('/reconciliation/auto-repair', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await reconciliationService.repairEntityDrift();
    res.status(200).json({
      success: true,
      message: `Entity drift auto-repair complete. Repaired ${result.repairedCount} item(s).`,
      ...result,
    });
  } catch (err: any) {
    console.error('[System Auto-Repair Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to auto-repair entity drift' });
  }
});

// 4c. Outbound SMTP Relay Connectivity Verification
systemRouter.get('/smtp/relay-status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await emailService.verifyRelay();
    res.status(200).json(status);
  } catch (err: any) {
    console.error('[SMTP Relay Status Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to verify SMTP relay' });
  }
});

// 4d. Outbound SMTP Relay Test Ping
systemRouter.post('/smtp/test-ping', async (req: Request, res: Response): Promise<void> => {
  try {
    const { to } = req.body;
    if (!to || typeof to !== 'string' || !to.includes('@')) {
      res.status(400).json({ error: 'INVALID_INPUT', message: 'Valid recipient email address is required' });
      return;
    }

    const result = await emailService.sendTestPing(to.trim());
    res.status(result.success ? 200 : 502).json(result);
  } catch (err: any) {
    console.error('[SMTP Test Ping Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to dispatch test ping email' });
  }
});

// 5. Trigger On-Demand Backup
systemRouter.post('/backup', async (req: Request, res: Response): Promise<void> => {
  try {
    const actorEmail = (req as any).adminUser?.email || 'superadmin';
    const actorId = (req as any).adminUser?.id;
    const actorIp = req.ip;

    const backupRecord = await backupService.createBackup({
      actorEmail,
      actorId,
      actorIp,
    });

    res.status(201).json({
      success: true,
      message: 'System backup generated and encrypted successfully',
      backup: backupRecord,
    });
  } catch (err: any) {
    console.error('[System Backup Error]:', err);
    res.status(500).json({ error: 'BACKUP_FAILED', message: err.message || 'Failed to generate backup' });
  }
});

// 6. List Historical Backups
systemRouter.get('/backups', async (_req: Request, res: Response): Promise<void> => {
  try {
    const backups = await backupService.listBackups(50);
    res.status(200).json({ backups });
  } catch (err: any) {
    console.error('[System List Backups Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to list backups' });
  }
});

// 7. Verify Backup Integrity
systemRouter.post('/backups/:id/verify', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await backupService.verifyBackupIntegrity(req.params.id);
    res.status(200).json(result);
  } catch (err: any) {
    console.error('[System Verify Backup Error]:', err);
    res.status(err.message?.includes('not found') ? 404 : 500).json({
      error: 'VERIFICATION_FAILED',
      message: err.message || 'Failed to verify backup integrity',
    });
  }
});

// 8. Delete Backup
systemRouter.delete('/backups/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const actorEmail = (req as any).adminUser?.email;
    const success = await backupService.deleteBackup(req.params.id, actorEmail);
    if (!success) {
      res.status(404).json({ error: 'NOT_FOUND', message: 'Backup record not found' });
      return;
    }
    res.status(200).json({ success: true, message: 'Backup deleted successfully' });
  } catch (err: any) {
    console.error('[System Delete Backup Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to delete backup' });
  }
});

// 9. Get Mail Limits Configuration
systemRouter.get('/mail-limits', async (_req: Request, res: Response): Promise<void> => {
  try {
    const limits = await alertService.getMailLimits();
    res.status(200).json(limits);
  } catch (err: any) {
    console.error('[System Mail Limits Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to load mail limit configuration' });
  }
});

systemRouter.post('/mail-limits', async (req: Request, res: Response): Promise<void> => {
  try {
    const actorEmail = (req as any).adminUser?.email || 'superadmin';
    const body = req.body || {};
    const numeric = (value: unknown, fallback: number) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };

    const payload = {
      attachmentSizeMb: Math.max(1, numeric(body.attachmentSizeMb, 5)),
      messageSizeMb: Math.max(1, numeric(body.messageSizeMb, 6)),
      maxMailboxDepth: Math.max(1, numeric(body.maxMailboxDepth, 10)),
      maxMailboxNameLength: Math.max(1, numeric(body.maxMailboxNameLength, 255)),
    };

    const config = await alertService.updateMailLimits(payload, actorEmail);
    res.status(200).json({
      success: true,
      message: 'Mail limits updated successfully',
      config,
    });
  } catch (err: any) {
    console.error('[System Update Mail Limits Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to update mail limit configuration' });
  }
});

// 10. Get Outage Alert Configuration
systemRouter.get('/alerts/config', async (_req: Request, res: Response): Promise<void> => {
  try {
    const alertConfig = await alertService.getAlertConfig();
    res.status(200).json(alertConfig);
  } catch (err: any) {
    console.error('[System Alert Config Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to load alert configuration' });
  }
});

// 11. Update Outage Alert Configuration
systemRouter.post('/alerts/config', async (req: Request, res: Response): Promise<void> => {
  try {
    const actorEmail = (req as any).adminUser?.email || 'superadmin';
    const updated = await alertService.updateAlertConfig(req.body, actorEmail);
    res.status(200).json({
      success: true,
      message: 'Alert configuration updated successfully',
      config: updated,
    });
  } catch (err: any) {
    console.error('[System Update Alert Config Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to update alert configuration' });
  }
});

// 11. Dispatch Test Alert
systemRouter.post('/alerts/test', async (req: Request, res: Response): Promise<void> => {
  try {
    const actorEmail = (req as any).adminUser?.email || 'superadmin';
    const webhookUrl = req.body?.webhookUrl;
    const result = await alertService.sendTestAlert(actorEmail, webhookUrl);

    if (result.success) {
      res.status(200).json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: any) {
    console.error('[System Test Alert Error]:', err);
    res.status(500).json({ error: 'ALERT_TEST_FAILED', message: err.message || 'Failed to dispatch test alert' });
  }
});

// 12. Platform Analytics — email traffic, storage, per-tenant breakdown
systemRouter.get('/analytics', async (_req: Request, res: Response): Promise<void> => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // --- Step 1: MongoDB snapshot ---
    const [
      totalMailboxes,
      activeMailboxes,
      suspendedMailboxes,
      totalTenants,
      activeTenants,
      suspendedTenants,
      totalDomains,
      allTenants,
      allDomains,
      allMailboxes,
    ] = await Promise.all([
      MailboxModel.countDocuments(),
      MailboxModel.countDocuments({ status: 'active' }),
      MailboxModel.countDocuments({ status: 'suspended' }),
      TenantModel.countDocuments(),
      TenantModel.countDocuments({ status: 'active' }),
      TenantModel.countDocuments({ status: 'suspended' }),
      DomainModel.countDocuments(),
      TenantModel.find().lean(),
      DomainModel.find().lean(),
      MailboxModel.find().lean(),
    ]);

    // --- Step 2: Stalwart storage (usedDiskQuota per account) ---
    let storageMap = new Map<string, number>();
    let stalwartReachable = false;
    try {
      storageMap = await stalwartClient.listAccountsWithStorage();
      stalwartReachable = true;
    } catch (err: any) {
      console.warn('[Analytics] Stalwart storage fetch failed:', err.message);
    }

    // --- Step 3: Stalwart email counts (sent/inbox/total per account) ---
    const accountIdsWithStalwart = allMailboxes
      .filter((m) => m.stalwartAccountId)
      .map((m) => m.stalwartAccountId as string);

    let emailCountMap = new Map<string, { emailsSent: number; emailsInbox: number; totalEmails: number }>();
    if (stalwartReachable && accountIdsWithStalwart.length > 0) {
      try {
        emailCountMap = await stalwartClient.batchGetEmailCounts(accountIdsWithStalwart, 10);
      } catch (err: any) {
        console.warn('[Analytics] Stalwart email count batch failed:', err.message);
      }
    }

    // --- Step 4: Build per-tenant aggregation ---
    const tenantMap = new Map(allTenants.map((t) => [t._id.toString(), t]));
    const domainByTenant = new Map(allDomains.map((d) => [d.tenantId.toString(), d]));

    // Group mailboxes by tenantId
    const mailboxesByTenant = new Map<string, typeof allMailboxes>();
    for (const m of allMailboxes) {
      const tid = m.tenantId.toString();
      if (!mailboxesByTenant.has(tid)) mailboxesByTenant.set(tid, []);
      mailboxesByTenant.get(tid)!.push(m);
    }

    const perTenant = allTenants.map((tenant) => {
      const tid = tenant._id.toString();
      const domain = domainByTenant.get(tid);
      const mboxes = mailboxesByTenant.get(tid) || [];

      let storageBytes = 0;
      let emailsSent = 0;
      let emailsInbox = 0;
      let totalEmails = 0;
      const topMailboxes: { address: string; storageBytes: number; emailsSent: number }[] = [];

      for (const m of mboxes) {
        const sid = m.stalwartAccountId as string | null;
        const mStorage = sid ? (storageMap.get(sid) ?? 0) : 0;
        const mCounts = sid ? (emailCountMap.get(sid) ?? { emailsSent: 0, emailsInbox: 0, totalEmails: 0 }) : { emailsSent: 0, emailsInbox: 0, totalEmails: 0 };

        storageBytes += mStorage;
        emailsSent += mCounts.emailsSent;
        emailsInbox += mCounts.emailsInbox;
        totalEmails += mCounts.totalEmails;

        topMailboxes.push({
          address: m.address,
          storageBytes: mStorage,
          emailsSent: mCounts.emailsSent,
        });
      }

      topMailboxes.sort((a, b) => b.storageBytes - a.storageBytes);

      return {
        tenantId: tid,
        tenantName: tenant.name,
        domainName: domain?.domainName || 'unknown',
        status: tenant.status as 'active' | 'suspended',
        mailboxCount: mboxes.length,
        mailboxLimit: tenant.mailboxLimit,
        utilizationPct: tenant.mailboxLimit > 0
          ? Math.round((mboxes.length / tenant.mailboxLimit) * 100)
          : 0,
        storageBytes,
        emailsSent,
        emailsInbox,
        totalEmails,
        topMailboxes: topMailboxes.slice(0, 3),
      };
    });

    // --- Step 5: Top storage consumers platform-wide ---
    const allMailboxStats = allMailboxes.map((m) => {
      const sid = m.stalwartAccountId as string | null;
      const tenant = tenantMap.get(m.tenantId.toString());
      return {
        address: m.address,
        tenantName: tenant?.name || 'Unknown',
        storageBytes: sid ? (storageMap.get(sid) ?? 0) : 0,
        emailsSent: sid ? (emailCountMap.get(sid)?.emailsSent ?? 0) : 0,
      };
    });
    allMailboxStats.sort((a, b) => b.storageBytes - a.storageBytes);
    const topStorageConsumers = allMailboxStats.slice(0, 10);

    // --- Step 6: Platform totals ---
    const totalStorageBytes = [...storageMap.values()].reduce((s, v) => s + v, 0);
    const platformTotalSent = [...emailCountMap.values()].reduce((s, v) => s + v.emailsSent, 0);
    const platformTotalInbox = [...emailCountMap.values()].reduce((s, v) => s + v.emailsInbox, 0);
    const platformTotalEmails = [...emailCountMap.values()].reduce((s, v) => s + v.totalEmails, 0);

    // --- Step 7: 30-day audit summary ---
    const auditDocs = await AuditLogModel.find({ timestamp: { $gte: thirtyDaysAgo } }).lean();
    let auditLogins = 0;
    let auditMailboxEvents = 0;
    let auditTenantLifecycle = 0;
    let auditSecurityEvents = 0;

    for (const a of auditDocs) {
      const action: string = (a as any).action || '';
      if (action.includes('LOGIN') || action.includes('SESSION')) auditLogins++;
      else if (action.includes('MAILBOX')) auditMailboxEvents++;
      else if (action.includes('TENANT') || action.includes('DOMAIN')) auditTenantLifecycle++;
      else if (action.includes('FAIL') || action.includes('REVOK') || action.includes('SECURITY')) auditSecurityEvents++;
    }

    res.status(200).json({
      generatedAt: new Date().toISOString(),
      stalwartReachable,
      snapshot: {
        totalMailboxes,
        activeMailboxes,
        suspendedMailboxes,
        totalTenants,
        activeTenants,
        suspendedTenants,
        totalDomains,
        platform: {
          totalStorageBytes,
          avgStoragePerMailboxBytes: totalMailboxes > 0 ? Math.round(totalStorageBytes / totalMailboxes) : 0,
          totalEmailsSent: platformTotalSent,
          totalEmailsInbox: platformTotalInbox,
          totalEmails: platformTotalEmails,
        },
      },
      perTenant,
      topStorageConsumers,
      auditSummary: {
        last30Days: {
          total: auditDocs.length,
          logins: auditLogins,
          mailboxEvents: auditMailboxEvents,
          tenantLifecycle: auditTenantLifecycle,
          securityEvents: auditSecurityEvents,
        },
      },
    });
  } catch (err: any) {
    console.error('[System Analytics Error]:', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Failed to generate analytics' });
  }
});
