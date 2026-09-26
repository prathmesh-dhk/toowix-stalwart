import React, { useEffect, useState } from 'react';
import {
  Server,
  Database,
  HardDrive,
  RefreshCw,
  Trash2,
  FileCheck,
  Cpu,
  Layers,
  Wrench,
  Mail,
  Send,
  CheckCircle2,
  AlertCircle,
  X,
  Bell,
} from 'lucide-react';
import {
  SystemHealthDetails,
  BackupRecordItem,
  AlertConfig,
  IntegrityCheckResult,
  DriftReport,
  SystemMetrics,
  MailLimitConfig,
} from '../../types';
import { api } from '../../api';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';

interface SystemOperationsViewProps {
  healthDetails: SystemHealthDetails | null;
  metrics: SystemMetrics | null;
  backups: BackupRecordItem[];
  driftReport: DriftReport | null;
  alertConfig?: AlertConfig;
  loading: boolean;
  onRefreshAll: () => Promise<void>;
  onShowAlert: (type: 'success' | 'error', message: string) => void;
}

export const SystemOperationsView: React.FC<SystemOperationsViewProps> = ({
  healthDetails,
  metrics,
  backups,
  driftReport,
  alertConfig: propAlertConfig,
  loading,
  onRefreshAll,
  onShowAlert,
}) => {
  // Backup State
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [verifyingBackupId, setVerifyingBackupId] = useState<string | null>(null);
  const [verificationModalResult, setVerificationModalResult] = useState<IntegrityCheckResult | null>(null);
  const [deletingBackupId, setDeletingBackupId] = useState<string | null>(null);

  const [mailLimits, setMailLimits] = useState<MailLimitConfig>({
    attachmentSizeMb: 5,
    messageSizeMb: 6,
    maxMailboxDepth: 10,
    maxMailboxNameLength: 255,
  });
  const [savingMailLimits, setSavingMailLimits] = useState(false);
  const [mailLimitsLoaded, setMailLimitsLoaded] = useState(false);

  // Drift Repair State
  const [repairingQuota, setRepairingQuota] = useState(false);
  const [autoRepairingDrift, setAutoRepairingDrift] = useState(false);

  // SMTP Relay Diagnostic State
  const [relayStatus, setRelayStatus] = useState<{
    connected: boolean;
    latencyMs: number;
    host: string;
    port: number;
    secure: boolean;
    authenticated: boolean;
    error?: string;
  } | null>(null);
  const [checkingRelay, setCheckingRelay] = useState(false);
  const [testPingEmail, setTestPingEmail] = useState('');
  const [sendingTestPing, setSendingTestPing] = useState(false);
  const [testPingResult, setTestPingResult] = useState<{
    success: boolean;
    messageId?: string;
    latencyMs: number;
    error?: string;
  } | null>(null);

  // Alert Configuration State
  const [localAlertConfig, setLocalAlertConfig] = useState<AlertConfig>({
    webhookUrl: propAlertConfig?.webhookUrl || '',
    alertEmail: propAlertConfig?.alertEmail || '',
    alertsEnabled: propAlertConfig?.alertsEnabled ?? false,
    consecutiveFailureThreshold: propAlertConfig?.consecutiveFailureThreshold ?? 3,
  });
  const [savingAlertConfig, setSavingAlertConfig] = useState(false);
  const [sendingTestAlert, setSendingTestAlert] = useState(false);

  useEffect(() => {
    if (propAlertConfig) {
      setLocalAlertConfig({
        webhookUrl: propAlertConfig.webhookUrl || '',
        alertEmail: propAlertConfig.alertEmail || '',
        alertsEnabled: Boolean(propAlertConfig.alertsEnabled),
        consecutiveFailureThreshold: propAlertConfig.consecutiveFailureThreshold || 3,
      });
    }
  }, [propAlertConfig]);

  const handleSaveAlertConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAlertConfig(true);
    try {
      const res = await api.updateAlertConfig(localAlertConfig);
      onShowAlert('success', res.message || 'Alert configuration saved successfully.');
    } catch (err: any) {
      onShowAlert('error', err.message || 'Failed to update alert configuration.');
    } finally {
      setSavingAlertConfig(false);
    }
  };

  const handleSendTestAlert = async () => {
    setSendingTestAlert(true);
    try {
      const res = await api.sendTestAlert(localAlertConfig.webhookUrl || undefined);
      if (res.success) {
        onShowAlert('success', res.message || 'Test alert dispatched successfully.');
      } else {
        onShowAlert('error', res.message || 'Failed to send test alert.');
      }
    } catch (err: any) {
      onShowAlert('error', err.message || 'Failed to dispatch test alert.');
    } finally {
      setSendingTestAlert(false);
    }
  };

  // Format bytes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Format uptime
  const formatUptime = (seconds?: number) => {
    if (!seconds) return 'N/A';
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d > 0 ? `${d}d ` : ''}${h}h ${m}m`;
  };

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      const res = await api.createBackup();
      onShowAlert('success', `Backup archive created: ${res.backup.filename}`);
      await onRefreshAll();
    } catch (err: any) {
      onShowAlert('error', err.message || 'Failed to create platform backup.');
    } finally {
      setCreatingBackup(false);
    }
  };

  const handleVerifyBackup = async (id: string) => {
    setVerifyingBackupId(id);
    try {
      const res = await api.verifyBackup(id);
      setVerificationModalResult(res);
      if (res.valid) {
        onShowAlert('success', `Verification passed for ${res.filename}. Checksum and documents valid.`);
      } else {
        onShowAlert('error', `Backup verification failed: ${res.error || 'Invalid archive checksum'}`);
      }
    } catch (err: any) {
      onShowAlert('error', err.message || 'Verification execution failed.');
    } finally {
      setVerifyingBackupId(null);
    }
  };

  const handleDeleteBackup = async (id: string, filename: string) => {
    if (!confirm(`Are you sure you want to delete backup "${filename}"? This action cannot be undone.`)) {
      return;
    }
    setDeletingBackupId(id);
    try {
      await api.deleteBackup(id);
      onShowAlert('success', `Backup archive "${filename}" deleted.`);
      await onRefreshAll();
    } catch (err: any) {
      onShowAlert('error', err.message || 'Failed to delete backup.');
    } finally {
      setDeletingBackupId(null);
    }
  };

  const handleRepairQuotaDrift = async () => {
    setRepairingQuota(true);
    try {
      const res = await api.repairQuotaDrift();
      onShowAlert('success', `Quota reconciliation complete: ${res.message || 'Synced'}`);
      await onRefreshAll();
    } catch (err: any) {
      onShowAlert('error', err.message || 'Failed to repair tenant quota drift.');
    } finally {
      setRepairingQuota(false);
    }
  };

  const handleAutoRepairDrift = async () => {
    setAutoRepairingDrift(true);
    try {
      const res = await api.autoRepairEntityDrift();
      onShowAlert(
        'success',
        `Entity drift auto-repair complete: Restored ${res.restoredDomains?.length || 0} domain(s), ${res.restoredMailboxes?.length || 0} mailbox(es), aligned ${res.quotaRepairedCount || 0} tenant quota(s).`
      );
      await onRefreshAll();
    } catch (err: any) {
      onShowAlert('error', err.message || 'Failed to auto-repair entity drift.');
    } finally {
      setAutoRepairingDrift(false);
    }
  };

  const handleCheckRelay = async () => {
    setCheckingRelay(true);
    try {
      const res = await api.getSmtpRelayStatus();
      setRelayStatus(res);
      if (res.connected) {
        onShowAlert('success', `SMTP relay verified: ${res.host}:${res.port} connected in ${res.latencyMs}ms`);
      } else {
        onShowAlert('error', `SMTP relay connection failed: ${res.error || 'Unreachable'}`);
      }
    } catch (err: any) {
      onShowAlert('error', err.message || 'Failed to check SMTP relay');
    } finally {
      setCheckingRelay(false);
    }
  };

  const handleSendTestPing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testPingEmail || !testPingEmail.includes('@')) {
      onShowAlert('error', 'Please enter a valid recipient email address');
      return;
    }
    setSendingTestPing(true);
    setTestPingResult(null);
    try {
      const res = await api.sendSmtpTestPing(testPingEmail.trim());
      setTestPingResult(res);
      if (res.success) {
        onShowAlert('success', `Test ping dispatched to ${testPingEmail} in ${res.latencyMs}ms`);
      } else {
        onShowAlert('error', `Failed to send test ping: ${res.error}`);
      }
    } catch (err: any) {
      onShowAlert('error', err.message || 'Failed to dispatch test ping');
    } finally {
      setSendingTestPing(false);
    }
  };

  const handleLoadMailLimits = async () => {
    try {
      const limits = await api.getMailLimits();
      setMailLimits({
        attachmentSizeMb: Number(limits.attachmentSizeMb ?? 5),
        messageSizeMb: Number(limits.messageSizeMb ?? 6),
        maxMailboxDepth: Number(limits.maxMailboxDepth ?? 10),
        maxMailboxNameLength: Number(limits.maxMailboxNameLength ?? 255),
      });
      setMailLimitsLoaded(true);
    } catch (err: any) {
      onShowAlert('error', err.message || 'Failed to load global email limits.');
    }
  };

  const handleSaveMailLimits = async (event: React.FormEvent) => {
    event.preventDefault();
    setSavingMailLimits(true);
    try {
      const res = await api.updateMailLimits(mailLimits);
      setMailLimits(res.config);
      onShowAlert('success', res.message || 'Mail limits updated successfully.');
    } catch (err: any) {
      onShowAlert('error', err.message || 'Failed to update global email limits.');
    } finally {
      setSavingMailLimits(false);
    }
  };

  useEffect(() => {
    if (!mailLimitsLoaded) {
      void handleLoadMailLimits();
    }
  }, [mailLimitsLoaded]);

  const mongo = healthDetails?.services?.mongodb;
  const stalwart = healthDetails?.services?.stalwart;
  const system = healthDetails?.system;

  const missingDomains = driftReport?.drift?.missingInStalwartDomains || driftReport?.domainDrift?.missingInStalwartDomains || [];
  const orphanedDomains = driftReport?.drift?.orphanedInStalwartDomains || driftReport?.domainDrift?.orphanedInStalwartDomains || [];
  const missingDomainCount = missingDomains.length || driftReport?.domainDrift?.missingInStalwartCount || 0;
  const orphanedDomainCount = orphanedDomains.length || driftReport?.domainDrift?.orphanedInStalwartCount || 0;
  const hasDomainDrift = (missingDomainCount + orphanedDomainCount) > 0;

  const missingMailboxes = driftReport?.drift?.missingInStalwartMailboxes || driftReport?.mailboxDrift?.missingInStalwartMailboxes || [];
  const orphanedMailboxes = driftReport?.drift?.orphanedInStalwartAccounts || driftReport?.mailboxDrift?.orphanedInStalwartAccounts || [];
  const missingMailboxCount = missingMailboxes.length || driftReport?.mailboxDrift?.missingInStalwartCount || 0;
  const orphanedMailboxCount = orphanedMailboxes.length || driftReport?.mailboxDrift?.orphanedInStalwartCount || 0;
  const hasMailboxDrift = (missingMailboxCount + orphanedMailboxCount) > 0;

  const quotaDiscrepancies = driftReport?.drift?.quotaDiscrepancies || [];
  const legacyInconsistentTenants = driftReport?.quotaDrift?.inconsistentTenants || [];
  const quotaDiscrepancyCount = quotaDiscrepancies.length || legacyInconsistentTenants.length || driftReport?.quotaDrift?.inconsistentTenantCount || 0;
  const hasQuotaDrift = quotaDiscrepancyCount > 0;

  return (
    <div className="flex flex-col gap-8">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            System Operations
          </h1>
          <p className="text-xs text-slate-500 font-normal">
            Cluster health diagnostics, state synchronization engine, and automated backup management
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={onRefreshAll}
          disabled={loading}
          icon={<RefreshCw size={13} className={loading ? 'animate-spin' : ''} />}
          className="w-full sm:w-auto min-h-[44px] sm:min-h-0"
        >
          Refresh Diagnostics
        </Button>
      </div>

      {/* 1. Core Services Telemetry Grid */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Server size={17} className="text-indigo-600" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Core Infrastructure Health
          </h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* MongoDB Health Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center border border-emerald-100">
                  <Database size={16} />
                </div>
                <div>
                  <div className="font-semibold text-xs text-slate-900">MongoDB Database</div>
                  <div className="text-[11px] text-slate-400">Primary Data Store</div>
                </div>
              </div>
              <StatusBadge status={mongo?.status === 'healthy' ? 'success' : 'danger'}>
                {mongo?.status || 'Unknown'}
              </StatusBadge>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Ping Latency:</span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {mongo?.pingMs !== undefined ? `${mongo.pingMs} ms` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Last Checked:</span>
                <span className="text-slate-700">
                  {healthDetails?.timestamp ? new Date(healthDetails.timestamp).toLocaleTimeString() : 'N/A'}
                </span>
              </div>
              {mongo?.error && (
                <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-[11px]">
                  {mongo.error}
                </div>
              )}
            </div>
          </div>

          {/* Stalwart Mail Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-md bg-indigo-50 text-indigo-700 flex items-center justify-center border border-indigo-100">
                  <Server size={16} />
                </div>
                <div>
                  <div className="font-semibold text-xs text-slate-900">Stalwart Mail Engine</div>
                  <div className="text-[11px] text-slate-400">
                    {stalwart?.edition || metrics?.stalwart?.edition || 'v0.8.0'}
                  </div>
                </div>
              </div>
              <StatusBadge status={stalwart?.status === 'connected' ? 'success' : 'danger'}>
                {stalwart?.status || 'Unknown'}
              </StatusBadge>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Engine Latency:</span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {stalwart?.latencyMs !== undefined ? `${stalwart.latencyMs} ms` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Mail Queue Depth:</span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {stalwart?.queueDepth ?? 0} messages
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Server Locale:</span>
                <span className="text-slate-700">
                  {stalwart?.locale || metrics?.stalwart?.locale || 'en_US'}
                </span>
              </div>
            </div>
          </div>

          {/* Runtime Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-md bg-purple-50 text-purple-700 flex items-center justify-center border border-purple-100">
                  <Cpu size={16} />
                </div>
                <div>
                  <div className="font-semibold text-xs text-slate-900">Host Runtime</div>
                  <div className="text-[11px] text-slate-400">
                    Node {system?.nodeVersion || 'v20.x'} · {system?.platform || 'win32'}
                  </div>
                </div>
              </div>
              <span className="text-[11px] font-medium tabular-nums px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                {formatUptime(system?.uptimeSeconds)}
              </span>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Memory (Heap):</span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {system?.memoryUsage?.heapUsedMb ? `${system.memoryUsage.heapUsedMb} MB` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Memory (RSS):</span>
                <span className="text-slate-700 tabular-nums">
                  {system?.memoryUsage?.rssMb ? `${system.memoryUsage.rssMb} MB` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Eval Speed:</span>
                <span className="text-slate-700 tabular-nums">
                  {healthDetails?.evaluationTimeMs !== undefined ? `${healthDetails.evaluationTimeMs} ms` : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Mail Limit Configuration */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Server size={17} className="text-indigo-600" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Mail Limits
          </h3>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 shadow-xs">
          <form onSubmit={handleSaveMailLimits} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <label className="field-label">Attachment Size</label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    value={mailLimits.attachmentSizeMb}
                    onChange={(e) => setMailLimits((prev) => ({ ...prev, attachmentSizeMb: Number(e.target.value || 1) }))}
                    className="form-input text-base sm:text-xs min-h-[44px] sm:min-h-0 pr-12"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 font-medium">MB</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="field-label">Email Message Size</label>
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    value={mailLimits.messageSizeMb}
                    onChange={(e) => setMailLimits((prev) => ({ ...prev, messageSizeMb: Number(e.target.value || 1) }))}
                    className="form-input text-base sm:text-xs min-h-[44px] sm:min-h-0 pr-12"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 font-medium">MB</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="field-label">Mailbox Depth</label>
                <input
                  type="number"
                  min={1}
                  value={mailLimits.maxMailboxDepth}
                  onChange={(e) => setMailLimits((prev) => ({ ...prev, maxMailboxDepth: Number(e.target.value || 1) }))}
                  className="form-input text-base sm:text-xs min-h-[44px] sm:min-h-0"
                />
              </div>

              <div className="space-y-2">
                <label className="field-label">Mailbox Name Length</label>
                <input
                  type="number"
                  min={1}
                  value={mailLimits.maxMailboxNameLength}
                  onChange={(e) => setMailLimits((prev) => ({ ...prev, maxMailboxNameLength: Number(e.target.value || 1) }))}
                  className="form-input text-base sm:text-xs min-h-[44px] sm:min-h-0"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" variant="primary" size="md" loading={savingMailLimits} className="w-full sm:w-auto min-h-[44px]">
                Save Mail Limits
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* 3. State Drift & Reconciliation Engine */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers size={17} className="text-indigo-600 shrink-0" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              State Drift &amp; Reconciliation Engine
            </h3>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            {(hasDomainDrift || hasMailboxDrift || hasQuotaDrift) && (
              <Button
                size="sm"
                variant="primary"
                onClick={handleAutoRepairDrift}
                disabled={autoRepairingDrift}
                title="Automatically restore missing domains and mailboxes in Stalwart and align tenant quotas"
                className="w-full sm:w-auto min-h-[44px] sm:min-h-0"
              >
                <Wrench size={13} className={autoRepairingDrift ? 'animate-spin' : ''} />
                <span>{autoRepairingDrift ? 'Auto-Repairing...' : 'Auto-Repair Stalwart Drift'}</span>
              </Button>
            )}
            {hasQuotaDrift && !hasDomainDrift && !hasMailboxDrift && (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleRepairQuotaDrift}
                disabled={repairingQuota}
                className="w-full sm:w-auto min-h-[44px] sm:min-h-0"
              >
                <RefreshCw size={13} className={repairingQuota ? 'animate-spin' : ''} />
                <span>{repairingQuota ? 'Repairing Quota...' : 'Repair Quota Drift'}</span>
              </Button>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 shadow-xs">
          {!driftReport ? (
            <div className="text-slate-400 text-xs text-center py-4">
              Reconciliation diagnostics not loaded.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* Domain Drift */}
                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-[11px] text-slate-500 mb-1">Domain Drift</div>
                  <div className={`text-lg font-bold ${hasDomainDrift ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {!hasDomainDrift ? 'Synchronized' : 'Discrepancy'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Missing in Stalwart: {missingDomainCount} · Orphaned: {orphanedDomainCount}
                  </div>
                </div>

                {/* Mailbox Drift */}
                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-[11px] text-slate-500 mb-1">Mailbox Account Drift</div>
                  <div className={`text-lg font-bold ${hasMailboxDrift ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {!hasMailboxDrift ? 'Synchronized' : 'Discrepancy'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Missing in Stalwart: {missingMailboxCount} · Orphaned: {orphanedMailboxCount}
                  </div>
                </div>

                {/* Quota Drift */}
                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-[11px] text-slate-500 mb-1">Tenant Quota Drift</div>
                  <div className={`text-lg font-bold ${hasQuotaDrift ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {!hasQuotaDrift ? 'Synchronized' : `${quotaDiscrepancyCount} Inconsistent`}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Tenants with cached mailbox count mismatch
                  </div>
                </div>
              </div>

              {/* Quota Discrepancies Alert */}
              {quotaDiscrepancies.length > 0 && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs space-y-2">
                  <div className="font-semibold text-amber-900">
                    Quota Inconsistencies Detected:
                  </div>
                  <div className="space-y-1">
                    {quotaDiscrepancies.map((qd) => (
                      <div key={qd.tenantId} className="flex flex-col sm:flex-row sm:justify-between text-slate-700 gap-1">
                        <span><strong>{qd.tenantName}</strong> (ID: {qd.tenantId.slice(-6)})</span>
                        <span className="text-slate-500 tabular-nums">
                          Cached: {qd.recordedMailboxCount} → Actual in DB: {qd.actualActiveMailboxes} (Delta: {qd.recordedMailboxCount - qd.actualActiveMailboxes})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 4. Outbound SMTP Relay Live Diagnostic */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Mail size={17} className="text-indigo-600 shrink-0" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Outbound SMTP Relay Live Diagnostic
            </h3>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleCheckRelay}
            disabled={checkingRelay}
            title="Ping configured SMTP relay host"
            className="w-full sm:w-auto min-h-[44px] sm:min-h-0"
          >
            <RefreshCw size={13} className={checkingRelay ? 'animate-spin' : ''} />
            <span>{checkingRelay ? 'Testing Relay...' : 'Test Relay Handshake'}</span>
          </Button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 shadow-xs space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500 mb-1">Relay Connection Status</div>
              <div className="text-lg font-bold text-slate-900 flex items-center gap-2">
                {relayStatus === null ? (
                  <span className="text-slate-400 text-sm font-normal">Not tested yet</span>
                ) : relayStatus.connected ? (
                  <>
                    <CheckCircle2 size={18} className="text-emerald-500" />
                    <span className="text-emerald-600">Connected</span>
                  </>
                ) : (
                  <>
                    <AlertCircle size={18} className="text-red-500" />
                    <span className="text-red-600">Failed</span>
                  </>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {relayStatus ? `${relayStatus.host}:${relayStatus.port}` : 'Click test button to probe'}
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500 mb-1">Handshake Latency</div>
              <div className="text-lg font-bold text-slate-900">
                {relayStatus?.latencyMs !== undefined ? `${relayStatus.latencyMs} ms` : '—'}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {relayStatus?.secure ? 'Implicit SSL/TLS' : 'STARTTLS / Opportunistic'}
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
              <div className="text-[11px] text-slate-500 mb-1">Relay Authentication</div>
              <div className="text-lg font-bold text-slate-900">
                {relayStatus?.authenticated ? (
                  <span className="text-emerald-600">Authenticated</span>
                ) : (
                  <span className="text-slate-500">Anonymous / Open</span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">
                {relayStatus?.error ? <span className="text-red-500 truncate block">{relayStatus.error}</span> : 'Ready for outbound deliverability'}
              </div>
            </div>
          </div>

          {/* Test Ping Email Dispatcher */}
          <form onSubmit={handleSendTestPing} className="p-4 bg-slate-50 rounded-lg border border-slate-200 flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            <div className="flex-1 w-full">
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Send Diagnostic Test Ping Email:
              </label>
              <input
                type="email"
                placeholder="recipient@example.com"
                value={testPingEmail}
                onChange={(e) => setTestPingEmail(e.target.value)}
                className="w-full text-base sm:text-xs min-h-[44px] sm:min-h-0 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 bg-white"
                required
              />
            </div>
            <div className="w-full sm:w-auto">
              <Button
                type="submit"
                size="md"
                variant="primary"
                disabled={sendingTestPing || !testPingEmail}
                className="w-full sm:w-auto min-h-[44px]"
              >
                <Send size={13} className={sendingTestPing ? 'animate-spin' : ''} />
                <span>{sendingTestPing ? 'Dispatching...' : 'Send Test Ping'}</span>
              </Button>
            </div>
          </form>

          {testPingResult && (
            <div className={`p-3 rounded-lg text-xs border ${testPingResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {testPingResult.success ? (
                <div>
                  <strong>Ping Delivered Successfully!</strong> Latency: {testPingResult.latencyMs}ms. Message ID: {testPingResult.messageId}
                </div>
              ) : (
                <div>
                  <strong>Ping Delivery Failed:</strong> {testPingResult.error}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 5. Webhook & Infrastructure Alert Routing */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bell size={17} className="text-indigo-600 shrink-0" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Infrastructure Alerts &amp; Webhooks
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={handleSendTestAlert}
              disabled={sendingTestAlert || !localAlertConfig.webhookUrl}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-0"
              title="Dispatch test payload to configured webhook"
            >
              <Send size={13} className={sendingTestAlert ? 'animate-spin' : ''} />
              <span>{sendingTestAlert ? 'Sending Test...' : 'Send Test Alert'}</span>
            </Button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 shadow-xs">
          <form onSubmit={handleSaveAlertConfig} className="space-y-5">
            <div className="flex items-center justify-between p-3.5 bg-slate-50 rounded-lg border border-slate-200">
              <div>
                <div className="text-xs font-semibold text-slate-900">Enable Automated Platform Alerts</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Trigger automated webhook and email notifications when consecutive health check failures occur
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={localAlertConfig.alertsEnabled}
                  onChange={(e) => setLocalAlertConfig((prev) => ({ ...prev, alertsEnabled: e.target.checked }))}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div className="space-y-2 md:col-span-2">
                <label className="field-label">Webhook URL (Slack, Discord, PagerDuty)</label>
                <input
                  type="url"
                  placeholder="https://hooks.slack.com/services/..."
                  value={localAlertConfig.webhookUrl}
                  onChange={(e) => setLocalAlertConfig((prev) => ({ ...prev, webhookUrl: e.target.value }))}
                  className="form-input text-base sm:text-xs min-h-[44px] sm:min-h-0"
                />
              </div>

              <div className="space-y-2">
                <label className="field-label">Failure Threshold</label>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={localAlertConfig.consecutiveFailureThreshold}
                  onChange={(e) =>
                    setLocalAlertConfig((prev) => ({ ...prev, consecutiveFailureThreshold: parseInt(e.target.value, 10) || 1 }))
                  }
                  className="form-input text-base sm:text-xs min-h-[44px] sm:min-h-0"
                />
              </div>

              <div className="space-y-2 md:col-span-3">
                <label className="field-label">Alert Email Recipient</label>
                <input
                  type="email"
                  placeholder="ops@toowix.com"
                  value={localAlertConfig.alertEmail}
                  onChange={(e) => setLocalAlertConfig((prev) => ({ ...prev, alertEmail: e.target.value }))}
                  className="form-input text-base sm:text-xs min-h-[44px] sm:min-h-0"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" variant="primary" size="md" loading={savingAlertConfig} className="w-full sm:w-auto min-h-[44px]">
                Save Alert Settings
              </Button>
            </div>
          </form>
        </div>
      </div>

      {/* 6. Database Backup Engine */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <HardDrive size={17} className="text-indigo-600 shrink-0" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Database Backup Engine
            </h3>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={handleCreateBackup}
            disabled={creatingBackup}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-0"
          >
            <HardDrive size={13} />
            <span>{creatingBackup ? 'Creating Snapshot...' : 'Create Backup Now'}</span>
          </Button>
        </div>

        <div className="data-table-container">
          {backups.length === 0 ? (
            <div className="p-12 text-center">
              <HardDrive size={36} className="mx-auto mb-3 text-slate-300" />
              <div className="text-sm font-semibold text-slate-800 mb-1">No Backups Created Yet</div>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Click "Create Backup Now" to capture an immutable snapshot of tenants, domains, mailboxes, and audit logs.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Filename & Archive</th>
                      <th>Size</th>
                      <th>Created</th>
                      <th>Payload Breakdown</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {backups.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-900 text-xs">
                              {b.filename}
                            </span>
                            <span className="text-[10px] text-slate-400 tabular-nums">
                              SHA-256: {b.checksumSha256.slice(0, 16)}...
                            </span>
                          </div>
                        </td>

                        <td>
                          <span className="text-xs text-slate-800 tabular-nums">
                            {formatBytes(b.sizeBytes)}
                          </span>
                        </td>

                        <td>
                          <div className="text-xs text-slate-800">
                            {new Date(b.createdAt).toLocaleDateString()}
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>

                        <td>
                          <div className="text-xs text-slate-600">
                            {b.documentCounts?.tenants || 0} tenants · {b.documentCounts?.mailboxes || 0} mailboxes · {b.documentCounts?.auditLogs || 0} logs
                          </div>
                        </td>

                        <td style={{ textAlign: 'right' }}>
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleVerifyBackup(b.id)}
                              disabled={verifyingBackupId === b.id}
                              title="Verify archive checksum"
                            >
                              <FileCheck size={13} />
                              <span>{verifyingBackupId === b.id ? 'Checking...' : 'Verify'}</span>
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDeleteBackup(b.id, b.filename)}
                              disabled={deletingBackupId === b.id}
                              title="Delete backup archive"
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View (< md) */}
              <div className="block md:hidden divide-y divide-slate-100">
                {backups.map((b) => (
                  <div key={b.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-900 text-xs break-all">
                          {b.filename}
                        </div>
                        <div className="text-[10px] text-slate-400 tabular-nums break-all mt-0.5">
                          SHA-256: {b.checksumSha256.slice(0, 16)}...
                        </div>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-slate-700 tabular-nums bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {formatBytes(b.sizeBytes)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      <div>
                        <span className="text-[11px] text-slate-400 block">Created</span>
                        <span className="text-slate-700 font-medium">
                          {new Date(b.createdAt).toLocaleDateString()}{' '}
                          <span className="text-slate-400 text-[10px]">
                            {new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </span>
                      </div>
                      <div>
                        <span className="text-[11px] text-slate-400 block">Payload</span>
                        <span className="text-slate-700 font-medium">
                          {b.documentCounts?.tenants || 0} t · {b.documentCounts?.mailboxes || 0} m · {b.documentCounts?.auditLogs || 0} l
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleVerifyBackup(b.id)}
                        disabled={verifyingBackupId === b.id}
                        className="flex-1 min-h-[44px]"
                        title="Verify archive checksum"
                      >
                        <FileCheck size={14} />
                        <span>{verifyingBackupId === b.id ? 'Checking...' : 'Verify Archive'}</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteBackup(b.id, b.filename)}
                        disabled={deletingBackupId === b.id}
                        className="min-h-[44px] min-w-[44px] text-red-500 hover:text-red-700 hover:bg-red-50 flex items-center justify-center"
                        title="Delete backup archive"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Verification Result Modal */}
      {verificationModalResult && (
        <div className="modal-backdrop-mock">
          <div className="modal-card max-w-md w-full mx-4 max-h-[calc(100dvh-24px)] flex flex-col">
            <div className="modal-header shrink-0">
              <div className="min-w-0 flex-1 mr-2">
                <h3 className="modal-title">Archive Verification</h3>
                <p className="text-xs text-slate-500 mt-0.5 truncate">{verificationModalResult.filename}</p>
              </div>
              <button
                onClick={() => setVerificationModalResult(null)}
                className="modal-close-btn min-h-[44px] min-w-[44px] flex items-center justify-center"
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body overflow-y-auto space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-xs text-slate-600">Integrity Status:</span>
                <StatusBadge status={verificationModalResult.valid ? 'success' : 'danger'}>
                  {verificationModalResult.valid ? 'Valid & Verified' : 'Checksum Corrupted'}
                </StatusBadge>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Checksum Check:</span>
                  <span className="font-medium text-slate-800 text-[11px]">
                    {verificationModalResult.checksumVerified ? 'SHA-256 Passed' : 'Failed'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Document Counts:</span>
                  <span className="font-medium text-slate-800 text-[11px] tabular-nums">
                    {verificationModalResult.documentCounts?.tenants ?? 0} tenants, {verificationModalResult.documentCounts?.mailboxes ?? 0} mailboxes
                  </span>
                </div>
              </div>
            </div>

            <div className="modal-footer shrink-0">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setVerificationModalResult(null)}
                className="w-full sm:w-auto min-h-[44px]"
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
