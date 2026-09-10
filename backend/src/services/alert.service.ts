import http from 'http';
import https from 'https';
import { URL } from 'url';
import { config } from '../config';
import { SystemSettingsModel } from '../db/models/SystemSettings';
import { logAudit } from '../audit/service';
import { stalwartClient } from '../stalwart/client';

export interface AlertNotification {
  title: string;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL' | 'RESOLVED';
  service: string;
  message: string;
  details?: Record<string, any>;
  timestamp?: string;
}

export interface AlertConfigData {
  webhookUrl?: string;
  alertEmail?: string;
  alertsEnabled: boolean;
  consecutiveFailureThreshold: number;
}

export interface MailLimitConfigData {
  attachmentSizeMb: number;
  messageSizeMb: number;
  maxMailboxDepth: number;
  maxMailboxNameLength: number;
}

export class AlertService {
  private consecutiveFailures: Record<string, number> = {
    mongodb: 0,
    stalwart: 0,
  };

  private activeOutages: Record<string, boolean> = {
    mongodb: false,
    stalwart: false,
  };

  /**
   * Dispatches an HTTP/HTTPS POST webhook notification to the target URL.
   */
  async dispatchWebhook(targetUrl: string, notification: AlertNotification): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    return new Promise((resolve) => {
      try {
        const parsedUrl = new URL(targetUrl);
        const transport = parsedUrl.protocol === 'https:' ? https : http;

        const colorMap = {
          INFO: '#3b82f6',
          WARNING: '#f59e0b',
          HIGH: '#f97316',
          CRITICAL: '#ef4444',
          RESOLVED: '#10b981',
        };

        const payload = JSON.stringify({
          text: `🔔 **Toowix Alert [${notification.severity}]**: ${notification.title}\n${notification.message}`,
          attachments: [
            {
              color: colorMap[notification.severity] || '#64748b',
              title: `${notification.title} (${notification.service})`,
              text: notification.message,
              fields: [
                { title: 'Severity', value: notification.severity, short: true },
                { title: 'Service', value: notification.service, short: true },
                { title: 'Environment', value: config.nodeEnv, short: true },
                { title: 'Timestamp', value: notification.timestamp || new Date().toISOString(), short: false },
                ...(notification.details
                  ? Object.entries(notification.details).map(([k, v]) => ({
                      title: k,
                      value: typeof v === 'object' ? JSON.stringify(v) : String(v),
                      short: true,
                    }))
                  : []),
              ],
            },
          ],
        });

        const req = transport.request(
          parsedUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(payload),
              'User-Agent': 'ToowixMail-AlertDispatcher/1.0',
            },
            timeout: 5000,
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                resolve({ success: true, statusCode: res.statusCode });
              } else {
                resolve({ success: false, statusCode: res.statusCode, error: data || `HTTP ${res.statusCode}` });
              }
            });
          }
        );

        req.on('error', (err) => {
          resolve({ success: false, error: err.message });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({ success: false, error: 'Webhook request timed out' });
        });

        req.write(payload);
        req.end();
      } catch (err: any) {
        resolve({ success: false, error: err.message });
      }
    });
  }

  /**
   * Retrieves current alert configuration from database.
   */
  async getAlertConfig(): Promise<AlertConfigData> {
    const settings = await SystemSettingsModel.findOne({ key: 'alerts_config' });
    if (!settings) {
      return {
        webhookUrl: process.env.ALERT_WEBHOOK_URL || '',
        alertEmail: process.env.ALERT_EMAIL || '',
        alertsEnabled: Boolean(process.env.ALERT_WEBHOOK_URL),
        consecutiveFailureThreshold: 3,
      };
    }

    return {
      webhookUrl: settings.webhookUrl || '',
      alertEmail: settings.alertEmail || '',
      alertsEnabled: settings.alertsEnabled,
      consecutiveFailureThreshold: settings.consecutiveFailureThreshold || 3,
    };
  }

  /**
   * Updates alert configuration in database.
   */
  async updateAlertConfig(
    data: Partial<AlertConfigData>,
    actorEmail: string = 'superadmin'
  ): Promise<AlertConfigData> {
    const updated = await SystemSettingsModel.findOneAndUpdate(
      { key: 'alerts_config' },
      {
        $set: {
          webhookUrl: data.webhookUrl?.trim(),
          alertEmail: data.alertEmail?.trim(),
          alertsEnabled: data.alertsEnabled !== undefined ? data.alertsEnabled : false,
          consecutiveFailureThreshold: data.consecutiveFailureThreshold || 3,
          updatedBy: actorEmail,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    await logAudit({
      actorRole: 'SUPER_ADMIN',
      actorEmail,
      action: 'SYSTEM_ALERTS_CONFIG_UPDATED',
      resource: 'system_settings',
      metadata: {
        alertsEnabled: updated.alertsEnabled,
        hasWebhook: Boolean(updated.webhookUrl),
        threshold: updated.consecutiveFailureThreshold,
      },
      success: true,
    });

    return {
      webhookUrl: updated.webhookUrl || '',
      alertEmail: updated.alertEmail || '',
      alertsEnabled: updated.alertsEnabled,
      consecutiveFailureThreshold: updated.consecutiveFailureThreshold,
    };
  }

  async getMailLimits(): Promise<MailLimitConfigData> {
    const settings = await SystemSettingsModel.findOne({ key: 'mail_limits' });
    if (!settings) {
      return {
        attachmentSizeMb: 5,
        messageSizeMb: 6,
        maxMailboxDepth: 10,
        maxMailboxNameLength: 255,
      };
    }

    return {
      attachmentSizeMb: Number(settings.attachmentSizeMb ?? 5),
      messageSizeMb: Number(settings.messageSizeMb ?? 6),
      maxMailboxDepth: Number(settings.maxMailboxDepth ?? 10),
      maxMailboxNameLength: Number(settings.maxMailboxNameLength ?? 255),
    };
  }

  async updateMailLimits(
    data: Partial<MailLimitConfigData>,
    actorEmail: string = 'superadmin'
  ): Promise<MailLimitConfigData> {
    const payload: Partial<MailLimitConfigData> = {
      attachmentSizeMb: Number(data.attachmentSizeMb ?? 5),
      messageSizeMb: Number(data.messageSizeMb ?? 6),
      maxMailboxDepth: Number(data.maxMailboxDepth ?? 10),
      maxMailboxNameLength: Number(data.maxMailboxNameLength ?? 255),
    };

    const updated = await SystemSettingsModel.findOneAndUpdate(
      { key: 'mail_limits' },
      {
        $set: {
          ...payload,
          updatedBy: actorEmail,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    try {
      await stalwartClient.updateMailLimits({
        attachmentSizeMb: Number(updated.attachmentSizeMb ?? 5),
        messageSizeMb: Number(updated.messageSizeMb ?? 6),
        maxMailboxDepth: Number(updated.maxMailboxDepth ?? 10),
        maxMailboxNameLength: Number(updated.maxMailboxNameLength ?? 255),
      });
    } catch (err: any) {
      console.warn('[AlertService] Non-fatal error during Stalwart mail limits sync:', err.message);
    }

    await logAudit({
      actorRole: 'SUPER_ADMIN',
      actorEmail,
      action: 'SYSTEM_MAIL_LIMITS_UPDATED',
      resource: 'system_settings',
      metadata: {
        attachmentSizeMb: updated.attachmentSizeMb,
        messageSizeMb: updated.messageSizeMb,
        maxMailboxDepth: updated.maxMailboxDepth,
        maxMailboxNameLength: updated.maxMailboxNameLength,
      },
      success: true,
    });

    return {
      attachmentSizeMb: Number(updated.attachmentSizeMb ?? 5),
      messageSizeMb: Number(updated.messageSizeMb ?? 6),
      maxMailboxDepth: Number(updated.maxMailboxDepth ?? 10),
      maxMailboxNameLength: Number(updated.maxMailboxNameLength ?? 255),
    };
  }

  /**
   * Sends a test alert payload to verify webhook configuration.
   */
  async sendTestAlert(
    actorEmail: string,
    overrideUrl?: string
  ): Promise<{ success: boolean; message: string; details?: any }> {
    const configData = await this.getAlertConfig();
    const targetUrl = overrideUrl || configData.webhookUrl;

    if (!targetUrl) {
      return {
        success: false,
        message: 'No webhook URL configured. Please set an alert webhook URL first.',
      };
    }

    const testNotification: AlertNotification = {
      title: 'Test Health Alert Notification',
      severity: 'INFO',
      service: 'Toowix Operations',
      message: `This is a test alert triggered manually by ${actorEmail} to verify webhook integration.`,
      details: {
        triggeredBy: actorEmail,
        environment: config.nodeEnv,
        testMode: true,
      },
      timestamp: new Date().toISOString(),
    };

    const result = await this.dispatchWebhook(targetUrl, testNotification);

    await logAudit({
      actorRole: 'SUPER_ADMIN',
      actorEmail,
      action: 'SYSTEM_ALERT_TEST_TRIGGERED',
      resource: 'system_alert',
      metadata: {
        success: result.success,
        statusCode: result.statusCode,
        error: result.error,
      },
      success: result.success,
    });

    if (result.success) {
      return { success: true, message: 'Test alert successfully delivered to webhook.' };
    } else {
      return {
        success: false,
        message: `Failed to deliver test alert: ${result.error || 'Unknown error'}`,
        details: result,
      };
    }
  }

  /**
   * Evaluates service health state, incrementing failure counts and firing alerts
   * when thresholds are crossed, as well as sending resolution notifications.
   */
  async evaluateServiceHealth(service: 'mongodb' | 'stalwart', isHealthy: boolean, metadata?: Record<string, any>): Promise<void> {
    const configData = await this.getAlertConfig();
    if (!configData.alertsEnabled || !configData.webhookUrl) return;

    if (!isHealthy) {
      this.consecutiveFailures[service] = (this.consecutiveFailures[service] || 0) + 1;

      if (
        this.consecutiveFailures[service] >= configData.consecutiveFailureThreshold &&
        !this.activeOutages[service]
      ) {
        this.activeOutages[service] = true;

        await this.dispatchWebhook(configData.webhookUrl, {
          title: `Service Outage Detected: ${service.toUpperCase()}`,
          severity: 'CRITICAL',
          service: service.toUpperCase(),
          message: `The ${service.toUpperCase()} service has failed ${this.consecutiveFailures[service]} consecutive health checks. System operations may be impaired.`,
          details: metadata,
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      // Service is healthy
      if (this.activeOutages[service]) {
        // Recovered from an ongoing outage
        this.activeOutages[service] = false;
        this.consecutiveFailures[service] = 0;

        await this.dispatchWebhook(configData.webhookUrl, {
          title: `Service Restored: ${service.toUpperCase()}`,
          severity: 'RESOLVED',
          service: service.toUpperCase(),
          message: `The ${service.toUpperCase()} service has recovered and is now reporting healthy status.`,
          details: metadata,
          timestamp: new Date().toISOString(),
        });
      } else {
        this.consecutiveFailures[service] = 0;
      }
    }
  }

  public getFailureCounts(): Record<string, number> {
    return { ...this.consecutiveFailures };
  }

  public resetFailureCounts(): void {
    this.consecutiveFailures = { mongodb: 0, stalwart: 0 };
    this.activeOutages = { mongodb: false, stalwart: false };
  }
}

export const alertService = new AlertService();
