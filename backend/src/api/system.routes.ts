import { Router, Request, Response } from 'express';
import { requireSuperAdmin } from '../auth/middleware';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { MailboxModel } from '../db/models/Mailbox';
import { BackupRecordModel } from '../db/models/BackupRecord';
import { checkDatabaseHealth } from '../db/connection';
import { reconciliationService } from '../services/reconciliation.service';
import { backupService } from '../services/backup.service';
import { alertService } from '../services/alert.service';
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
