import { Request, Response, NextFunction } from 'express';
import {
  TenantModel,
  DomainModel,
  MailboxModel,
  BackupRecordModel,
} from '../db/models';
import { checkDatabaseHealth } from '../db/connection';
import { config } from '../config';
import http from 'http';
import https from 'https';

interface RequestMetricKey {
  method: string;
  route: string;
  status: string;
}

export class MetricsService {
  private requestCounts: Map<string, number> = new Map();
  private requestDurations: Map<string, number> = new Map();

  /**
   * Express middleware that collects HTTP request counts and durations.
   */
  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Ignore /metrics itself to avoid circular metric noise
      if (req.path === '/metrics') {
        return next();
      }

      const start = process.hrtime();

      res.on('finish', () => {
        const duration = process.hrtime(start);
        const durationSeconds = duration[0] + duration[1] / 1e9;

        // Clean route path (replace IDs with :id to avoid high cardinality)
        const normalizedRoute = (req.baseUrl || '') + (req.route?.path || req.path || '/')
          .replace(/[0-9a-fA-F]{24}/g, ':id')
          .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, ':uuid');

        const key = `${req.method}|${normalizedRoute}|${res.statusCode}`;
        this.requestCounts.set(key, (this.requestCounts.get(key) || 0) + 1);

        const durKey = `${req.method}|${normalizedRoute}`;
        this.requestDurations.set(durKey, (this.requestDurations.get(durKey) || 0) + durationSeconds);
      });

      next();
    };
  }

  /**
   * Checks live Stalwart availability and latency.
   */
  private async checkStalwartPing(): Promise<{ up: number; latencyMs: number }> {
    const start = Date.now();
    try {
      const authHeader = `Basic ${Buffer.from(`${config.stalwart.user}:${config.stalwart.password}`).toString('base64')}`;
      const targetUrl = new URL(`${config.stalwart.url}/api/account`);
      const transport = targetUrl.protocol === 'https:' ? https : http;

      return await new Promise((resolve) => {
        const req = transport.request(
          targetUrl,
          {
            method: 'GET',
            rejectUnauthorized: false,
            headers: { Authorization: authHeader },
            timeout: 2500,
          },
          (res) => {
            res.resume(); // consume response stream
            const latencyMs = Date.now() - start;
            resolve({
              up: res.statusCode && res.statusCode < 500 ? 1 : 0,
              latencyMs,
            });
          }
        );
        req.on('error', () => resolve({ up: 0, latencyMs: Date.now() - start }));
        req.on('timeout', () => {
          req.destroy();
          resolve({ up: 0, latencyMs: Date.now() - start });
        });
        req.end();
      });
    } catch {
      return { up: 0, latencyMs: 0 };
    }
  }

  /**
   * Produces Prometheus-compliant text format metrics.
   */
  async getPrometheusMetrics(): Promise<string> {
    const lines: string[] = [];

    // Helper to format Prometheus lines
    const addMetric = (name: string, type: 'gauge' | 'counter' | 'summary', help: string, value: number, labels: Record<string, string> = {}) => {
      lines.push(`# HELP ${name} ${help}`);
      lines.push(`# TYPE ${name} ${type}`);
      const labelStr = Object.entries(labels)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',');
      lines.push(`${name}${labelStr ? `{${labelStr}}` : ''} ${value}`);
    };

    // 1. Process & Runtime Metrics
    const memory = process.memoryUsage();
    addMetric('nodejs_process_uptime_seconds', 'gauge', 'Process uptime in seconds', process.uptime());
    addMetric('nodejs_heap_bytes_used', 'gauge', 'V8 heap memory used in bytes', memory.heapUsed);
    addMetric('nodejs_heap_bytes_total', 'gauge', 'V8 heap memory total allocated in bytes', memory.heapTotal);
    addMetric('nodejs_resident_memory_bytes', 'gauge', 'Resident set size in bytes', memory.rss);

    // 2. Database Health & Latency
    const dbHealth = await checkDatabaseHealth();
    addMetric('toowix_mongodb_up', 'gauge', 'MongoDB connection health status (1 = healthy, 0 = down)', dbHealth.status === 'healthy' ? 1 : 0);
    addMetric('toowix_mongodb_latency_ms', 'gauge', 'MongoDB roundtrip ping latency in milliseconds', dbHealth.pingMs || 0);

    // 3. Stalwart Health & Latency
    const stalwartPing = await this.checkStalwartPing();
    addMetric('toowix_stalwart_up', 'gauge', 'Stalwart mail engine reachability (1 = reachable, 0 = down)', stalwartPing.up);
    addMetric('toowix_stalwart_latency_ms', 'gauge', 'Stalwart API roundtrip latency in milliseconds', stalwartPing.latencyMs);

    // 4. Platform Business Entities
    try {
      const [
        activeTenants,
        suspendedTenants,
        pendingReviewTenants,
        approvedSetupTenants,
        totalDomains,
        activeMailboxes,
        suspendedMailboxes,
        totalBackups,
        latestBackup,
      ] = await Promise.all([
        TenantModel.countDocuments({ status: 'active' }),
        TenantModel.countDocuments({ status: 'suspended' }),
        TenantModel.countDocuments({ status: 'pending_review' }),
        TenantModel.countDocuments({ status: 'approved_pending_setup' }),
        DomainModel.countDocuments(),
        MailboxModel.countDocuments({ status: 'active' }),
        MailboxModel.countDocuments({ status: 'suspended' }),
        BackupRecordModel.countDocuments(),
        BackupRecordModel.findOne().sort({ createdAt: -1 }),
      ]);

      addMetric('toowix_tenants_total', 'gauge', 'Total tenants partitioned by status', activeTenants, { status: 'active' });
      addMetric('toowix_tenants_total', 'gauge', 'Total tenants partitioned by status', suspendedTenants, { status: 'suspended' });
      addMetric('toowix_tenants_total', 'gauge', 'Total tenants partitioned by status', pendingReviewTenants, { status: 'pending_review' });
      addMetric('toowix_tenants_total', 'gauge', 'Total tenants partitioned by status', approvedSetupTenants, { status: 'approved_pending_setup' });

      addMetric('toowix_domains_total', 'gauge', 'Total domains registered on the platform', totalDomains);

      addMetric('toowix_mailboxes_total', 'gauge', 'Total provisioned mailboxes partitioned by status', activeMailboxes, { status: 'active' });
      addMetric('toowix_mailboxes_total', 'gauge', 'Total provisioned mailboxes partitioned by status', suspendedMailboxes, { status: 'suspended' });

      addMetric('toowix_backups_total', 'counter', 'Total backup archives generated', totalBackups);
      const lastBackupTimestamp = latestBackup ? Math.floor(new Date(latestBackup.createdAt).getTime() / 1000) : 0;
      addMetric('toowix_backup_last_timestamp_seconds', 'gauge', 'Unix timestamp of the most recent backup', lastBackupTimestamp);
    } catch (e: any) {
      lines.push(`# Error querying business entities: ${e.message}`);
    }

    // 5. HTTP Request Counters
    if (this.requestCounts.size > 0) {
      lines.push('# HELP toowix_http_requests_total Total number of HTTP requests processed');
      lines.push('# TYPE toowix_http_requests_total counter');
      for (const [key, count] of this.requestCounts.entries()) {
        const [method, route, status] = key.split('|');
        lines.push(`toowix_http_requests_total{method="${method}",route="${route}",status="${status}"} ${count}`);
      }
    }

    return lines.join('\n') + '\n';
  }

  public resetMetrics(): void {
    this.requestCounts.clear();
    this.requestDurations.clear();
  }
}

export const metricsService = new MetricsService();
