import React, { useState } from 'react';
import {
  Server,
  Database,
  HardDrive,
  RefreshCw,
  Trash2,
  FileCheck,
  Cpu,
  Layers,
  X,
} from 'lucide-react';
import {
  SystemHealthDetails,
  BackupRecordItem,
  AlertConfig,
  IntegrityCheckResult,
  DriftReport,
  SystemMetrics,
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
  loading,
  onRefreshAll,
  onShowAlert,
}) => {
  // Backup State
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [verifyingBackupId, setVerifyingBackupId] = useState<string | null>(null);
  const [verificationModalResult, setVerificationModalResult] = useState<IntegrityCheckResult | null>(null);
  const [deletingBackupId, setDeletingBackupId] = useState<string | null>(null);

  // Drift Repair State
  const [repairingQuota, setRepairingQuota] = useState(false);

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
    <div className="space-y-6">
      {/* 1. Core Services Telemetry Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Server size={17} className="text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Core Infrastructure Health
            </h3>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={onRefreshAll}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Diagnostics</span>
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* MongoDB Health Card */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
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
                <span className="font-semibold text-slate-800 font-mono">
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
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-md bg-indigo-50 text-indigo-700 flex items-center justify-center border border-indigo-100">
                  <Server size={16} />
                </div>
                <div>
                  <div className="font-semibold text-xs text-slate-900">Stalwart Mail Engine</div>
                  <div className="text-[11px] text-slate-400 font-mono">
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
                <span className="font-semibold text-slate-800 font-mono">
                  {stalwart?.latencyMs !== undefined ? `${stalwart.latencyMs} ms` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Mail Queue Depth:</span>
                <span className="font-semibold text-slate-800 font-mono">
                  {stalwart?.queueDepth ?? 0} messages
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Server Locale:</span>
                <span className="text-slate-700 font-mono">
                  {stalwart?.locale || metrics?.stalwart?.locale || 'en_US'}
                </span>
              </div>
            </div>
          </div>

          {/* Runtime Card */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-md bg-purple-50 text-purple-700 flex items-center justify-center border border-purple-100">
                  <Cpu size={16} />
                </div>
                <div>
                  <div className="font-semibold text-xs text-slate-900">Host Runtime</div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Node {system?.nodeVersion || 'v20.x'} · {system?.platform || 'win32'}
                  </div>
                </div>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                {formatUptime(system?.uptimeSeconds)}
              </span>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Memory (Heap):</span>
                <span className="font-semibold text-slate-800 font-mono">
                  {system?.memoryUsage?.heapUsedMb ? `${system.memoryUsage.heapUsedMb} MB` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Memory (RSS):</span>
                <span className="text-slate-700 font-mono">
                  {system?.memoryUsage?.rssMb ? `${system.memoryUsage.rssMb} MB` : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Eval Speed:</span>
                <span className="text-slate-700 font-mono">
                  {healthDetails?.evaluationTimeMs !== undefined ? `${healthDetails.evaluationTimeMs} ms` : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. State Drift & Reconciliation Engine */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Layers size={17} className="text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              State Drift & Reconciliation Engine
            </h3>
          </div>
          {hasQuotaDrift && (
            <Button
              size="sm"
              variant="primary"
              onClick={handleRepairQuotaDrift}
              disabled={repairingQuota}
            >
              <RefreshCw size={13} className={repairingQuota ? 'animate-spin' : ''} />
              <span>{repairingQuota ? 'Repairing Quota...' : 'Repair Quota Drift'}</span>
            </Button>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-xs">
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
                  <div className={`text-lg font-bold font-mono ${hasDomainDrift ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {!hasDomainDrift ? 'Synchronized' : 'Discrepancy'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Missing in Stalwart: {missingDomainCount} · Orphaned: {orphanedDomainCount}
                  </div>
                </div>

                {/* Mailbox Drift */}
                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-[11px] text-slate-500 mb-1">Mailbox Account Drift</div>
                  <div className={`text-lg font-bold font-mono ${hasMailboxDrift ? 'text-amber-600' : 'text-emerald-600'}`}>
                    {!hasMailboxDrift ? 'Synchronized' : 'Discrepancy'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Missing in Stalwart: {missingMailboxCount} · Orphaned: {orphanedMailboxCount}
                  </div>
                </div>

                {/* Quota Drift */}
                <div className="p-3.5 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="text-[11px] text-slate-500 mb-1">Tenant Quota Drift</div>
                  <div className={`text-lg font-bold font-mono ${hasQuotaDrift ? 'text-amber-600' : 'text-emerald-600'}`}>
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
                      <div key={qd.tenantId} className="flex justify-between text-slate-700">
                        <span><strong>{qd.tenantName}</strong> (ID: {qd.tenantId.slice(-6)})</span>
                        <span className="text-slate-500 font-mono">
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

      {/* 3. Database Backup Engine */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <HardDrive size={17} className="text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Database Backup Engine
            </h3>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={handleCreateBackup}
            disabled={creatingBackup}
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
            <div className="overflow-x-auto">
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
                          <span className="text-[10px] text-slate-400 font-mono">
                            SHA-256: {b.checksumSha256.slice(0, 16)}...
                          </span>
                        </div>
                      </td>

                      <td>
                        <span className="text-xs font-mono text-slate-800">
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
                        <div className="text-xs text-slate-600 font-mono">
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
          )}
        </div>
      </div>

      {/* Verification Result Modal */}
      {verificationModalResult && (
        <div className="modal-backdrop-mock">
          <div className="modal-card max-w-md">
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Archive Verification</h3>
                <p className="text-xs text-slate-500 mt-0.5 font-mono">{verificationModalResult.filename}</p>
              </div>
              <button
                onClick={() => setVerificationModalResult(null)}
                className="modal-close-btn"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body space-y-4">
              <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50 border border-slate-200">
                <span className="text-xs text-slate-600">Integrity Status:</span>
                <StatusBadge status={verificationModalResult.valid ? 'success' : 'danger'}>
                  {verificationModalResult.valid ? 'Valid & Verified' : 'Checksum Corrupted'}
                </StatusBadge>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Checksum Check:</span>
                  <span className="font-mono text-slate-800 text-[11px]">
                    {verificationModalResult.checksumVerified ? 'SHA-256 Passed' : 'Failed'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Document Counts:</span>
                  <span className="font-mono text-slate-800 text-[11px]">
                    {verificationModalResult.documentCounts?.tenants ?? 0} tenants, {verificationModalResult.documentCounts?.mailboxes ?? 0} mailboxes
                  </span>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={() => setVerificationModalResult(null)}
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
