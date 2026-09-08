import React, { useState } from 'react';
import {
  Server,
  Database,
  HardDrive,
  RefreshCw,
  CheckCircle2,
  Trash2,
  FileCheck,
  Cpu,
  Layers,
  XCircle,
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

  // Handlers

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
        onShowAlert('success', `Verification passed for ${res.filename}. SHA-256 checksum and JSON payload valid.`);
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
      onShowAlert('success', res.message || 'Quota counts reconciled with Stalwart mailboxes.');
      await onRefreshAll();
    } catch (err: any) {
      onShowAlert('error', err.message || 'Failed to repair quota drift.');
    } finally {
      setRepairingQuota(false);
    }
  };

  const mongo = healthDetails?.services?.mongodb;
  const stalwart = healthDetails?.services?.stalwart;
  const runtime = healthDetails?.system;

  // Drift calculations (supports backend reconciliation schema and fallbacks)
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* 1. Core Services Telemetry Grid */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Server size={18} color="var(--primary-light)" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
              Core Infrastructure Health
            </h3>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onRefreshAll}
            disabled={loading}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh Diagnostics</span>
          </button>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '16px',
        }}>
          {/* MongoDB Health Card */}
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  background: 'rgba(16, 185, 129, 0.1)',
                  color: 'var(--success)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Database size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-main)' }}>MongoDB Database</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>Primary Data Store</div>
                </div>
              </div>
              <span className={`badge ${mongo?.status === 'healthy' ? 'badge-green' : 'badge-red'}`} style={{ textTransform: 'capitalize' }}>
                {mongo?.status || 'Unknown'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Ping Latency:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                  {mongo?.pingMs !== undefined ? `${mongo.pingMs} ms` : 'N/A'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Last Checked:</span>
                <span style={{ color: 'var(--text-main)' }}>
                  {healthDetails?.timestamp ? new Date(healthDetails.timestamp).toLocaleTimeString() : 'N/A'}
                </span>
              </div>
              {mongo?.error && (
                <div style={{ marginTop: '6px', padding: '8px', background: 'var(--danger-bg)', borderRadius: '6px', color: '#fca5a5', fontSize: '0.76rem' }}>
                  {mongo.error}
                </div>
              )}
            </div>
          </div>

          {/* Stalwart Mail Card */}
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  background: 'rgba(56, 189, 248, 0.1)',
                  color: 'var(--primary-light)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Server size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-main)' }}>Stalwart Mail Engine</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                    {stalwart?.edition || metrics?.stalwart?.edition || 'v0.8.0'}
                  </div>
                </div>
              </div>
              <span className={`badge ${stalwart?.status === 'connected' ? 'badge-green' : 'badge-red'}`} style={{ textTransform: 'capitalize' }}>
                {stalwart?.status || 'Unknown'}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Engine Latency:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                  {stalwart?.latencyMs !== undefined ? `${stalwart.latencyMs} ms` : 'N/A'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Mail Queue Depth:</span>
                <span style={{ fontWeight: 600, color: (stalwart?.queueDepth || 0) > 50 ? 'var(--warning)' : 'var(--text-main)' }}>
                  {stalwart?.queueDepth ?? 0} messages
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Server Locale:</span>
                <span style={{ color: 'var(--text-main)' }}>
                  {stalwart?.locale || metrics?.stalwart?.locale || 'en_US'}
                </span>
              </div>
            </div>
          </div>

          {/* Node.js Platform Runtime Card */}
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '8px',
                  background: 'rgba(168, 85, 247, 0.1)',
                  color: '#c084fc',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Cpu size={20} />
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-main)' }}>Host Runtime</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                    Node {runtime?.nodeVersion || 'v20.x'} &bull; {runtime?.platform || 'win32'}
                  </div>
                </div>
              </div>
              <span className="badge badge-cyan">
                {formatUptime(runtime?.uptimeSeconds)}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '0.82rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Memory (Heap Used):</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                  {runtime?.memoryUsage?.heapUsedMb ? `${runtime.memoryUsage.heapUsedMb} MB` : 'N/A'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Memory (RSS):</span>
                <span style={{ color: 'var(--text-main)' }}>
                  {runtime?.memoryUsage?.rssMb ? `${runtime.memoryUsage.rssMb} MB` : 'N/A'}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Diagnostics Speed:</span>
                <span style={{ color: 'var(--text-main)' }}>
                  {healthDetails?.evaluationTimeMs !== undefined ? `${healthDetails.evaluationTimeMs} ms` : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. State Drift & Reconciliation Engine */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={18} color="var(--primary-light)" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
              State Drift & Reconciliation Engine
            </h3>
          </div>
          {hasQuotaDrift && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={handleRepairQuotaDrift}
              disabled={repairingQuota}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <RefreshCw size={13} className={repairingQuota ? 'animate-spin' : ''} />
              <span>{repairingQuota ? 'Repairing Quota...' : 'Repair Quota Drift'}</span>
            </button>
          )}
        </div>

        <div className="card" style={{ padding: '20px' }}>
          {!driftReport ? (
            <div style={{ color: 'var(--text-dim)', fontSize: '0.85rem', textAlign: 'center', padding: '20px' }}>
              Reconciliation diagnostics not loaded.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: '14px',
              }}>
                {/* Domain Drift */}
                <div style={{
                  padding: '14px',
                  background: 'var(--bg-input)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '4px' }}>Domain Drift</div>
                  <div style={{
                    fontSize: '1.2rem',
                    fontWeight: 700,
                    color: hasDomainDrift ? 'var(--warning)' : 'var(--success)',
                  }}>
                    {!hasDomainDrift ? 'Synchronized' : 'Discrepancy'}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                    Missing in Stalwart: {missingDomainCount} &bull; Orphaned: {orphanedDomainCount}
                  </div>
                </div>

                {/* Mailbox Drift */}
                <div style={{
                  padding: '14px',
                  background: 'var(--bg-input)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '4px' }}>Mailbox Account Drift</div>
                  <div style={{
                    fontSize: '1.2rem',
                    fontWeight: 700,
                    color: hasMailboxDrift ? 'var(--warning)' : 'var(--success)',
                  }}>
                    {!hasMailboxDrift ? 'Synchronized' : 'Discrepancy'}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                    Missing in Stalwart: {missingMailboxCount} &bull; Orphaned: {orphanedMailboxCount}
                  </div>
                </div>

                {/* Quota Drift */}
                <div style={{
                  padding: '14px',
                  background: 'var(--bg-input)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '4px' }}>Tenant Quota Drift</div>
                  <div style={{
                    fontSize: '1.2rem',
                    fontWeight: 700,
                    color: hasQuotaDrift ? 'var(--warning)' : 'var(--success)',
                  }}>
                    {!hasQuotaDrift ? 'Synchronized' : `${quotaDiscrepancyCount} Inconsistent`}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)', marginTop: '4px' }}>
                    Tenants with cached mailbox count mismatch
                  </div>
                </div>
              </div>

              {/* Quota Discrepancies List (Backend schema) */}
              {quotaDiscrepancies.length > 0 && (
                <div style={{
                  padding: '12px 16px',
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.82rem',
                }}>
                  <div style={{ fontWeight: 600, color: '#fbbf24', marginBottom: '8px' }}>
                    Quota Inconsistencies Detected:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {quotaDiscrepancies.map((qd) => (
                      <div key={qd.tenantId} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-main)' }}>
                        <span><strong>{qd.tenantName}</strong> (ID: {qd.tenantId.slice(-6)})</span>
                        <span style={{ color: 'var(--text-dim)' }}>
                          Cached: {qd.recordedMailboxCount} &rarr; Actual in DB: {qd.actualActiveMailboxes} (Delta: {qd.recordedMailboxCount - qd.actualActiveMailboxes})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Legacy Inconsistent Tenants List if passed */}
              {quotaDiscrepancies.length === 0 && legacyInconsistentTenants.length > 0 && (
                <div style={{
                  padding: '12px 16px',
                  background: 'rgba(245, 158, 11, 0.08)',
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.82rem',
                }}>
                  <div style={{ fontWeight: 600, color: '#fbbf24', marginBottom: '8px' }}>
                    Quota Inconsistencies Detected:
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {legacyInconsistentTenants.map((t) => (
                      <div key={t.tenantId} style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--text-main)' }}>
                        <span><strong>{t.tenantName}</strong> (ID: {t.tenantId.slice(-6)})</span>
                        <span style={{ color: 'var(--text-dim)' }}>
                          Cached: {t.cachedCount} &rarr; Actual in DB: {t.actualActiveMailboxCount} (Delta: {t.driftDelta})
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

      {/* 3. Backup Engine */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <HardDrive size={18} color="var(--primary-light)" />
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main)', margin: 0 }}>
              Database Backup Engine
            </h3>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={handleCreateBackup}
            disabled={creatingBackup}
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <HardDrive size={14} />
            <span>{creatingBackup ? 'Creating Snapshot...' : 'Create Backup Now'}</span>
          </button>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {backups.length === 0 ? (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <HardDrive size={32} color="var(--text-dim)" style={{ margin: '0 auto 8px auto', opacity: 0.5 }} />
              <div style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--text-main)' }}>No Backups Created Yet</div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '4px 0 0 0' }}>
                Click "Create Backup Now" to capture an immutable snapshot of tenants, domains, mailboxes, and audit logs.
              </p>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="custom-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: '220px' }}>Filename & Archive</th>
                    <th style={{ minWidth: '100px' }}>Size</th>
                    <th style={{ minWidth: '130px' }}>Created</th>
                    <th style={{ minWidth: '180px' }}>Payload Breakdown</th>
                    <th style={{ minWidth: '180px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {backups.map((b) => (
                    <tr key={b.id}>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.86rem', color: 'var(--text-main)' }}>
                            {b.filename}
                          </span>
                          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', fontFamily: 'monospace' }}>
                            SHA-256: {b.checksumSha256.slice(0, 16)}...
                          </span>
                        </div>
                      </td>

                      <td>
                        <span style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
                          {formatBytes(b.sizeBytes)}
                        </span>
                      </td>

                      <td>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
                          {new Date(b.createdAt).toLocaleDateString()}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                          {new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      <td>
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-dim)' }}>
                          {b.documentCounts?.tenants || 0} tenants &bull; {b.documentCounts?.mailboxes || 0} mailboxes &bull; {b.documentCounts?.auditLogs || 0} logs
                        </div>
                      </td>

                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleVerifyBackup(b.id)}
                            disabled={verifyingBackupId === b.id}
                            title="Verify archive checksum and documents"
                            style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                          >
                            <FileCheck size={13} />
                            <span>{verifyingBackupId === b.id ? 'Checking...' : 'Verify'}</span>
                          </button>

                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => handleDeleteBackup(b.id, b.filename)}
                            disabled={deletingBackupId === b.id}
                            title="Delete backup archive"
                            style={{ color: '#f87171' }}
                          >
                            <Trash2 size={13} />
                          </button>
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



      {/* Verification Result Modal / Inspector */}
      {verificationModalResult && (
        <div className="modal-overlay" style={{ zIndex: 1050 }}>
          <div className="modal-content" style={{ maxWidth: '520px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: verificationModalResult.valid ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                  color: verificationModalResult.valid ? 'var(--success)' : 'var(--danger)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {verificationModalResult.valid ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                </div>
                <div>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>
                    Backup Verification Result
                  </h3>
                  <p style={{ fontSize: '0.78rem', color: 'var(--text-dim)', margin: '2px 0 0 0' }}>
                    {verificationModalResult.filename}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVerificationModalResult(null)}
                style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: '4px' }}
              >
                &times;
              </button>
            </div>

            <div style={{
              background: verificationModalResult.valid ? 'rgba(16, 185, 129, 0.08)' : 'rgba(239, 68, 68, 0.08)',
              border: `1px solid ${verificationModalResult.valid ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              borderRadius: 'var(--radius-md)',
              padding: '14px',
              marginBottom: '18px',
              fontSize: '0.85rem',
            }}>
              <div style={{ fontWeight: 600, color: verificationModalResult.valid ? '#34d399' : '#f87171', marginBottom: '4px' }}>
                {verificationModalResult.valid ? 'Integrity Verified' : 'Integrity Check Failed'}
              </div>
              <p style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                {verificationModalResult.valid
                  ? 'SHA-256 hash match confirmed. JSON document schema unpacked successfully.'
                  : (verificationModalResult.error || 'The archive failed checksum verification or contains invalid JSON structure.')}
              </p>
            </div>

            <div style={{
              background: 'var(--bg-input)',
              borderRadius: 'var(--radius-md)',
              padding: '14px',
              fontSize: '0.82rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              marginBottom: '20px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Tenants:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{verificationModalResult.documentCounts?.tenants || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Domains:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{verificationModalResult.documentCounts?.domains || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Mailboxes:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{verificationModalResult.documentCounts?.mailboxes || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Administrators:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{verificationModalResult.documentCounts?.admins || 0}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Audit Trail Records:</span>
                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{verificationModalResult.documentCounts?.auditLogs || 0}</span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setVerificationModalResult(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
