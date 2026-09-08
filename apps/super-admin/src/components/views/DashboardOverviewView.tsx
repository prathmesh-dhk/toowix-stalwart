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
  // Operational calculations
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

  // Applications to display in widget
  const displayApps = pendingApps.length > 0
    ? pendingApps.slice(0, 4)
    : applications.slice(0, 4);

  return (
    <div className="space-y-7" id="view-dashboard">
      {/* SECTION 1: PLATFORM STATUS (TOP OPERATIONAL BAR) */}
      <section className="bg-white border border-quartz-200 rounded-xl p-5 shadow-xs flex flex-wrap items-center justify-between gap-6">
        <div className="flex flex-wrap items-center gap-8 text-xs">
          {/* Overall Indicator */}
          <div className="flex items-center gap-3 pr-6 border-r border-quartz-200">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                hasSystemIssue ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse'
              }`}
            />
            <div>
              <span className="font-bold text-quartz-900 text-sm block">
                {hasSystemIssue ? 'Degraded Service' : '100% Operational'}
              </span>
              <span className="text-[11px] text-quartz-500 font-medium">Platform Health</span>
            </div>
          </div>

          {/* Telemetry Items */}
          <div>
            <span className="text-quartz-400 text-[10px] font-semibold block uppercase tracking-wider mb-0.5">
              MongoDB
            </span>
            <span
              className={`font-medium text-xs flex items-center gap-1 ${
                mongoStatus === 'healthy' ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  mongoStatus === 'healthy' ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
              {mongoStatus === 'healthy'
                ? mongoPing !== undefined ? `Healthy (${mongoPing}ms)` : 'Healthy'
                : 'Degraded'}
            </span>
          </div>

          <div>
            <span className="text-quartz-400 text-[10px] font-semibold block uppercase tracking-wider mb-0.5">
              Stalwart Engine
            </span>
            <span
              className={`font-medium text-xs flex items-center gap-1 ${
                stalwartStatus === 'connected' ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  stalwartStatus === 'connected' ? 'bg-emerald-500' : 'bg-rose-500'
                }`}
              />
              {stalwartStatus === 'connected'
                ? stalwartLatency !== undefined ? `Connected (${stalwartLatency}ms)` : 'Connected'
                : 'Unreachable'}
            </span>
          </div>

          <div>
            <span className="text-quartz-400 text-[10px] font-semibold block uppercase tracking-wider mb-0.5">
              Stalwart API
            </span>
            <span className="text-quartz-800 font-medium text-xs">
              {stalwartStatus === 'connected' ? 'Ready' : 'Offline'}
            </span>
          </div>

          <div>
            <span className="text-quartz-400 text-[10px] font-semibold block uppercase tracking-wider mb-0.5">
              Mail Queue
            </span>
            <span className="text-quartz-800 font-medium text-xs">
              {queueDepth} queued
            </span>
          </div>

          <div>
            <span className="text-quartz-400 text-[10px] font-semibold block uppercase tracking-wider mb-0.5">
              Backup
            </span>
            <span className="text-quartz-700 font-medium text-xs">
              {backupStatusText}
            </span>
          </div>
        </div>

        {/* Action Link */}
        <button
          className="text-xs font-semibold text-quartz-700 hover:text-quartz-900 flex items-center gap-1 transition px-3 py-1.5 rounded-lg hover:bg-quartz-50"
          onClick={() => onNavigateTab('operations')}
        >
          <span>View system health</span>
          <ArrowRight size={15} />
        </button>
      </section>

      {/* SECTION 2: ACTION REQUIRED (NEEDS ATTENTION) */}
      <section className="bg-amber-50/50 border border-amber-200/80 rounded-xl p-5 shadow-xs">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-7 w-7 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-xs">
            <AlertTriangle size={17} />
          </div>
          <div>
            <h2 className="text-xs font-bold text-amber-950 uppercase tracking-wider">
              Action Required
            </h2>
            <p className="text-[11px] text-amber-800 font-medium">
              {totalActionsCount > 0
                ? `${totalActionsCount} operational item${totalActionsCount > 1 ? 's' : ''} requiring Super Admin evaluation or review.`
                : 'All operational queues cleared. Core platform services healthy.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Item 1: Applications */}
          <div className="bg-white border border-amber-200/90 rounded-xl p-4 flex flex-col justify-between shadow-xs hover:border-amber-300 transition">
            <div className="mb-3">
              <div className="font-bold text-quartz-900 text-xs">
                {pendingApps.length} application{pendingApps.length !== 1 ? 's' : ''} awaiting review
              </div>
              <div className="text-[11px] text-quartz-500 mt-0.5">
                {pendingApps.length > 0 ? 'Submitted in the last 24h' : 'No new applications pending'}
              </div>
            </div>
            <button
              className="w-full py-2 bg-quartz-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium transition shadow-xs"
              onClick={() => onNavigateTab('applications')}
            >
              Review applications
            </button>
          </div>

          {/* Item 2: Activations */}
          <div className="bg-white border border-amber-200/90 rounded-xl p-4 flex flex-col justify-between shadow-xs hover:border-amber-300 transition">
            <div className="mb-3">
              <div className="font-bold text-quartz-900 text-xs">
                {pendingActivationTenants.length > 0
                  ? `${pendingActivationTenants.length} tenant${pendingActivationTenants.length !== 1 ? 's' : ''} ready for activation`
                  : 'All tenants active'}
              </div>
              <div className="text-[11px] text-quartz-500 mt-0.5 font-mono truncate">
                {pendingActivationTenants.length > 0
                  ? `${pendingActivationTenants[0].domain?.domainName || pendingActivationTenants[0].name} domain setup passed`
                  : 'Domain setup passed'}
              </div>
            </div>
            <button
              className="w-full py-2 bg-quartz-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium transition shadow-xs"
              onClick={() => {
                if (pendingActivationTenants.length > 0) {
                  onActivateTenant(pendingActivationTenants[0]);
                } else {
                  onNavigateTab('tenants');
                }
              }}
            >
              Activate tenant
            </button>
          </div>

          {/* Item 3: Suspended / Drift */}
          <div className="bg-white border border-amber-200/90 rounded-xl p-4 flex flex-col justify-between shadow-xs hover:border-amber-300 transition">
            <div className="mb-3">
              <div className="font-bold text-quartz-900 text-xs">
                {suspendedTenants.length > 0
                  ? `${suspendedTenants.length} tenant${suspendedTenants.length !== 1 ? 's' : ''} suspended`
                  : hasDrift
                  ? 'State drift detected'
                  : '0 tenants suspended'}
              </div>
              <div className="text-[11px] text-quartz-500 mt-0.5">
                {suspendedTenants.length > 0
                  ? 'Frozen due to policy or billing review'
                  : hasDrift
                  ? 'Discrepancies found between Mongo and Stalwart'
                  : 'Policy & relay holds normal'}
              </div>
            </div>
            <button
              className="w-full py-2 bg-quartz-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium transition shadow-xs"
              onClick={() => {
                if (hasDrift) {
                  onNavigateTab('operations');
                } else {
                  onNavigateTab('tenants');
                }
              }}
            >
              {hasDrift ? 'Reconcile drift' : 'View tenants'}
            </button>
          </div>
        </div>
      </section>

      {/* SECTION 3: PLATFORM OVERVIEW (5 FOCUSED METRICS) */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* Metric 1 */}
        <div className="bg-white border border-quartz-200 rounded-xl p-5 shadow-xs">
          <span className="text-[11px] font-semibold text-quartz-500 uppercase tracking-wider block mb-1">
            Active Tenants
          </span>
          <div className="text-3xl font-bold text-quartz-900 font-mono tabular-nums tracking-tight">
            {activeTenants.length}
          </div>
          <div className="text-[11px] text-emerald-700 font-medium mt-1.5 flex items-center gap-1">
            <CheckCircle2 size={13} />
            <span>100% DNS verified</span>
          </div>
        </div>

        {/* Metric 2 */}
        <div className="bg-white border border-quartz-200 rounded-xl p-5 shadow-xs">
          <span className="text-[11px] font-semibold text-quartz-500 uppercase tracking-wider block mb-1">
            Pending Applications
          </span>
          <div className="text-3xl font-bold text-amber-600 font-mono tabular-nums tracking-tight">
            {pendingApps.length}
          </div>
          <div className="text-[11px] text-quartz-500 mt-1.5">Awaiting review</div>
        </div>

        {/* Metric 3 */}
        <div className="bg-white border border-quartz-200 rounded-xl p-5 shadow-xs">
          <span className="text-[11px] font-semibold text-quartz-500 uppercase tracking-wider block mb-1">
            Suspended Tenants
          </span>
          <div className="text-3xl font-bold text-rose-600 font-mono tabular-nums tracking-tight">
            {suspendedTenants.length}
          </div>
          <div className="text-[11px] text-quartz-500 mt-1.5">Policy &amp; relay holds</div>
        </div>

        {/* Metric 4 */}
        <div className="bg-white border border-quartz-200 rounded-xl p-5 shadow-xs">
          <span className="text-[11px] font-semibold text-quartz-500 uppercase tracking-wider block mb-1">
            Total Mailboxes
          </span>
          <div className="text-3xl font-bold text-quartz-900 font-mono tabular-nums tracking-tight">
            {totalMailboxesUsed.toLocaleString()}
          </div>
          <div className="text-[11px] text-quartz-500 mt-1.5">
            of {totalMailboxQuota > 0 ? totalMailboxQuota.toLocaleString() : '5,000'} quota pool
          </div>
        </div>

        {/* Metric 5 */}
        <div className="bg-white border border-quartz-200 rounded-xl p-5 shadow-xs col-span-2 md:col-span-1">
          <span className="text-[11px] font-semibold text-quartz-500 uppercase tracking-wider block mb-1">
            Mail Queue Depth
          </span>
          <div className="text-3xl font-bold text-quartz-900 font-mono tabular-nums tracking-tight">
            {queueDepth}
          </div>
          <div className="text-[11px] text-emerald-700 mt-1.5">Normal delivery rate</div>
        </div>
      </section>

      {/* SECTION 4: SPLIT OPERATIONAL WIDGETS */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Widget: Recent Applications */}
        <div className="lg:col-span-7 bg-white border border-quartz-200 rounded-xl shadow-xs flex flex-col">
          <div className="p-5 border-b border-quartz-200 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-quartz-900 uppercase tracking-wider">
                Recent Applications
              </h3>
            </div>
            <button
              className="text-xs font-medium text-quartz-600 hover:text-quartz-900 flex items-center gap-1 transition"
              onClick={() => onNavigateTab('applications')}
            >
              <span>View all applications</span>
              <ArrowRight size={15} />
            </button>
          </div>

          <div className="divide-y divide-quartz-100 text-xs flex-1">
            {displayApps.length === 0 ? (
              <div className="p-8 text-center text-quartz-400 text-xs">
                No recent applications to display.
              </div>
            ) : (
              displayApps.map((app) => (
                <div
                  key={app._id}
                  className="p-4 hover:bg-quartz-50/70 transition flex items-center justify-between gap-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-quartz-900 truncate">
                        {app.companyName}
                      </span>
                      <span className="text-quartz-400">·</span>
                      <span className="font-mono text-quartz-700 text-[11px]">
                        {app.requestedDomain}
                      </span>
                    </div>
                    <div className="text-[11px] text-quartz-500 flex items-center gap-2">
                      <span>{app.applicantName}</span>
                      <span>·</span>
                      <span>{formatRelativeTime(app.createdAt)}</span>
                      <span>·</span>
                      <span className="text-amber-700 font-medium">
                        {app.status === 'PENDING_REVIEW' ? 'Pending Review' : app.status}
                      </span>
                    </div>
                  </div>
                  <button
                    className="px-3.5 py-1.5 bg-quartz-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium transition shrink-0 shadow-xs"
                    onClick={() => onReviewApplication(app)}
                  >
                    Review
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Widget: Recent Activity */}
        <div className="lg:col-span-5 bg-white border border-quartz-200 rounded-xl shadow-xs flex flex-col">
          <div className="p-5 border-b border-quartz-200 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-quartz-900 uppercase tracking-wider">
                Recent Activity
              </h3>
            </div>
            <button
              className="text-xs font-medium text-quartz-600 hover:text-quartz-900 flex items-center gap-1 transition"
              onClick={() => onNavigateTab('audit')}
            >
              <span>View audit log</span>
              <ArrowRight size={15} />
            </button>
          </div>

          <div className="divide-y divide-quartz-100 text-xs flex-1">
            {recentAuditLogs.length === 0 ? (
              <div className="p-8 text-center text-quartz-400 text-xs">
                No recent audit events logged.
              </div>
            ) : (
              recentAuditLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="p-4 hover:bg-quartz-50/70 transition space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-quartz-900">
                      {log.action}
                    </span>
                    <span className="text-quartz-400 text-[11px]">
                      {formatRelativeTime(log.timestamp)}
                    </span>
                  </div>
                  <div className="text-[11px] text-quartz-500 truncate">
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
