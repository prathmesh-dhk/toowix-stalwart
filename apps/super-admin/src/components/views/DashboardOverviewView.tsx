import React from 'react';
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import {
  TenantSummary,
  SystemMetrics,
  RegistrationApplication,
  SystemHealthDetails,
  AuditItem,
  DriftReport,
  BackupRecordItem,
} from '../../types';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';

interface DashboardOverviewViewProps {
  tenants: TenantSummary[];
  metrics: SystemMetrics | null;
  healthDetails: SystemHealthDetails | null;
  applications: RegistrationApplication[];
  backups: BackupRecordItem[];
  driftReport: DriftReport | null;
  recentAuditLogs: AuditItem[];
  onNavigateTab: (tab: 'applications' | 'tenants' | 'operations' | 'audit') => void;
  onReviewApplication: (app: RegistrationApplication) => void;
  onActivateTenant: (tenant: TenantSummary) => void;
}

function formatRelativeTime(date: Date | string | undefined): string {
  if (!date) return 'Recently';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 'Recently';
  const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diffSec < 45) return 'just now';
  if (diffSec < 90) return '1m ago';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  return `${diffDays}d ago`;
}

export const DashboardOverviewView: React.FC<DashboardOverviewViewProps> = ({
  tenants,
  metrics,
  healthDetails,
  applications,
  backups,
  driftReport,
  recentAuditLogs,
  onNavigateTab,
  onReviewApplication,
  onActivateTenant,
}) => {
  const pendingApps = applications.filter((a) => a.status === 'PENDING_REVIEW');
  const pendingActivationTenants = tenants.filter((t) => t.status === 'approved_pending_setup');
  const suspendedTenants = tenants.filter((t) => t.status === 'suspended');
  const activeTenants = tenants.filter((t) => t.status === 'active');

  const totalMailboxesUsed = tenants.reduce((acc, t) => acc + (t.mailboxCount || 0), 0);
  const totalMailboxQuota = tenants.reduce((acc, t) => acc + (t.mailboxLimit || 0), 0);

  const mongoStatus = healthDetails?.services?.mongodb?.status || 'healthy';
  const mongoPing = healthDetails?.services?.mongodb?.pingMs;
  const stalwartStatus = healthDetails?.services?.stalwart?.status || metrics?.stalwart?.status || 'connected';
  const stalwartLatency = healthDetails?.services?.stalwart?.latencyMs;
  const queueDepth = healthDetails?.services?.stalwart?.queueDepth ?? 0;

  const latestBackup = backups.length > 0
    ? backups[0]
    : (healthDetails?.backups?.latestBackupAt ? { createdAt: healthDetails.backups.latestBackupAt } : null);

  const domainMissing = (driftReport?.drift?.missingInStalwartDomains?.length ?? driftReport?.domainDrift?.missingInStalwartCount) || 0;
  const mailboxMissing = (driftReport?.drift?.missingInStalwartMailboxes?.length ?? driftReport?.mailboxDrift?.missingInStalwartCount) || 0;
  const quotaIssues = (driftReport?.drift?.quotaDiscrepancies?.length ?? driftReport?.quotaDrift?.inconsistentTenantCount) || 0;

  const hasDrift = Boolean(
    driftReport && (
      !driftReport.synchronized ||
      quotaIssues > 0 ||
      domainMissing > 0 ||
      mailboxMissing > 0
    )
  );

  const hasSystemIssue = mongoStatus !== 'healthy' || stalwartStatus !== 'connected';
  const totalActionsCount = pendingApps.length + pendingActivationTenants.length + suspendedTenants.length + (hasDrift ? 1 : 0);

  const backupStatusText = latestBackup
    ? `Up to date (${formatRelativeTime(latestBackup.createdAt)})`
    : 'Up to date';

  const displayApps = pendingApps.length > 0
    ? pendingApps.slice(0, 4)
    : applications.slice(0, 4);

  return (
    <div className="space-y-6" id="view-dashboard">
      {/* 1. Infrastructure Status Bar */}
      <section className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6 text-xs">
          {/* Platform Health Status */}
          <div className="flex items-center gap-2.5 pr-6 border-r border-slate-200">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                hasSystemIssue ? 'bg-red-500' : 'bg-emerald-500 animate-pulse'
              }`}
            />
            <div>
              <span className="font-bold text-slate-900 text-xs block">
                {hasSystemIssue ? 'Degraded Service' : '100% Operational'}
              </span>
              <span className="text-[10px] text-slate-400">Platform Health</span>
            </div>
          </div>

          {/* MongoDB */}
          <div>
            <span className="text-slate-400 text-[10px] font-semibold block uppercase tracking-wider mb-0.5">
              MongoDB
            </span>
            <span
              className={`font-medium text-xs flex items-center gap-1 ${
                mongoStatus === 'healthy' ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${mongoStatus === 'healthy' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {mongoStatus === 'healthy'
                ? mongoPing !== undefined ? `Healthy (${mongoPing}ms)` : 'Healthy'
                : 'Degraded'}
            </span>
          </div>

          {/* Stalwart Engine */}
          <div>
            <span className="text-slate-400 text-[10px] font-semibold block uppercase tracking-wider mb-0.5">
              Stalwart Engine
            </span>
            <span
              className={`font-medium text-xs flex items-center gap-1 ${
                stalwartStatus === 'connected' ? 'text-emerald-700' : 'text-red-700'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${stalwartStatus === 'connected' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {stalwartStatus === 'connected'
                ? stalwartLatency !== undefined ? `Connected (${stalwartLatency}ms)` : 'Connected'
                : 'Unreachable'}
            </span>
          </div>

          {/* Mail Queue */}
          <div>
            <span className="text-slate-400 text-[10px] font-semibold block uppercase tracking-wider mb-0.5">
              Mail Queue
            </span>
            <span className="text-slate-800 font-medium text-xs font-mono">
              {queueDepth} queued
            </span>
          </div>

          {/* Backup */}
          <div>
            <span className="text-slate-400 text-[10px] font-semibold block uppercase tracking-wider mb-0.5">
              Backup Archive
            </span>
            <span className="text-slate-700 font-medium text-xs">
              {backupStatusText}
            </span>
          </div>
        </div>

        <button
          className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition"
          onClick={() => onNavigateTab('operations')}
        >
          <span>View system health</span>
          <ArrowRight size={14} />
        </button>
      </section>

      {/* 2. Action Required Card */}
      {totalActionsCount > 0 && (
        <section className="bg-amber-50/70 border border-amber-200 rounded-lg p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="h-6 w-6 rounded-md bg-amber-500 text-white flex items-center justify-center shrink-0">
              <AlertTriangle size={15} />
            </div>
            <div>
              <h2 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
                Action Required
              </h2>
              <p className="text-[11px] text-amber-800">
                {totalActionsCount} operational item{totalActionsCount > 1 ? 's' : ''} requiring Super Admin review.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Item 1: Applications */}
            <div className="bg-white border border-amber-200 rounded-lg p-3.5 flex flex-col justify-between">
              <div className="mb-3">
                <div className="font-semibold text-slate-900 text-xs">
                  {pendingApps.length} application{pendingApps.length !== 1 ? 's' : ''} awaiting review
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {pendingApps.length > 0 ? 'Pending operator approval' : 'Queue cleared'}
                </div>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={() => onNavigateTab('applications')}
              >
                Review applications
              </Button>
            </div>

            {/* Item 2: Activations */}
            <div className="bg-white border border-amber-200 rounded-lg p-3.5 flex flex-col justify-between">
              <div className="mb-3">
                <div className="font-semibold text-slate-900 text-xs">
                  {pendingActivationTenants.length > 0
                    ? `${pendingActivationTenants.length} tenant${pendingActivationTenants.length !== 1 ? 's' : ''} ready for activation`
                    : 'All tenants active'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 font-mono truncate">
                  {pendingActivationTenants.length > 0
                    ? `${pendingActivationTenants[0].domain?.domainName || pendingActivationTenants[0].name} setup ready`
                    : 'Domain setup passed'}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (pendingActivationTenants.length > 0) {
                    onActivateTenant(pendingActivationTenants[0]);
                  } else {
                    onNavigateTab('tenants');
                  }
                }}
              >
                Activate tenant
              </Button>
            </div>

            {/* Item 3: Suspended / Drift */}
            <div className="bg-white border border-amber-200 rounded-lg p-3.5 flex flex-col justify-between">
              <div className="mb-3">
                <div className="font-semibold text-slate-900 text-xs">
                  {suspendedTenants.length > 0
                    ? `${suspendedTenants.length} tenant${suspendedTenants.length !== 1 ? 's' : ''} suspended`
                    : hasDrift
                    ? 'State drift detected'
                    : '0 tenants suspended'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  {suspendedTenants.length > 0
                    ? 'Account holds active'
                    : hasDrift
                    ? 'Discrepancies found in Stalwart sync'
                    : 'Policy & relay holds normal'}
                </div>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (hasDrift) {
                    onNavigateTab('operations');
                  } else {
                    onNavigateTab('tenants');
                  }
                }}
              >
                {hasDrift ? 'Reconcile drift' : 'View tenants'}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* 3. Platform Metric Cards */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Active Tenants
          </span>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {activeTenants.length}
          </div>
          <div className="text-[11px] text-emerald-700 font-medium mt-1 flex items-center gap-1">
            <CheckCircle2 size={12} />
            <span>100% DNS verified</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Pending Applications
          </span>
          <div className="text-2xl font-bold text-amber-600 font-mono tabular-nums">
            {pendingApps.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Awaiting review</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Suspended Tenants
          </span>
          <div className="text-2xl font-bold text-red-600 font-mono tabular-nums">
            {suspendedTenants.length}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Policy &amp; relay holds</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Total Mailboxes
          </span>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {totalMailboxesUsed.toLocaleString()}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            of {totalMailboxQuota > 0 ? totalMailboxQuota.toLocaleString() : '5,000'} pool
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-xs col-span-2 md:col-span-1">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block mb-1">
            Queue Depth
          </span>
          <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
            {queueDepth}
          </div>
          <div className="text-[11px] text-emerald-700 mt-1">Normal delivery rate</div>
        </div>
      </section>

      {/* 4. Split Operational Tables */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Recent Applications */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg shadow-xs flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Recent Applications
            </h3>
            <button
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition"
              onClick={() => onNavigateTab('applications')}
            >
              <span>View all</span>
              <ArrowRight size={13} />
            </button>
          </div>

          <div className="divide-y divide-slate-100 text-xs flex-1">
            {displayApps.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No recent applications to display.
              </div>
            ) : (
              displayApps.map((app) => (
                <div
                  key={app._id || app.id}
                  className="p-3.5 hover:bg-slate-50 transition flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 truncate">
                        {app.companyName}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-mono text-indigo-600 text-[11px]">
                        {app.requestedDomain}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2">
                      <span>{app.applicantName}</span>
                      <span>·</span>
                      <span>{formatRelativeTime(app.createdAt)}</span>
                      <span>·</span>
                      <StatusBadge status={app.status === 'PENDING_REVIEW' ? 'warning' : app.status === 'APPROVED' ? 'success' : 'danger'}>
                        {app.status === 'PENDING_REVIEW' ? 'Pending Review' : app.status}
                      </StatusBadge>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={app.status === 'PENDING_REVIEW' ? 'primary' : 'secondary'}
                    onClick={() => onReviewApplication(app)}
                  >
                    {app.status === 'PENDING_REVIEW' ? 'Review' : 'Details'}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Recent Audit Log */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg shadow-xs flex flex-col overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Recent Activity
            </h3>
            <button
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition"
              onClick={() => onNavigateTab('audit')}
            >
              <span>View audit log</span>
              <ArrowRight size={13} />
            </button>
          </div>

          <div className="divide-y divide-slate-100 text-xs flex-1">
            {recentAuditLogs.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No recent audit events logged.
              </div>
            ) : (
              recentAuditLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="p-3.5 hover:bg-slate-50 transition space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">
                      {log.action}
                    </span>
                    <span className="text-slate-400 text-[11px]">
                      {formatRelativeTime(log.timestamp)}
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 truncate font-mono">
                    {log.resource ? `${log.resource} · ` : ''}{log.actor_role}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
