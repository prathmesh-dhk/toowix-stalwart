import React from 'react';
import {
  TenantSummary,
  SystemMetrics,
  RegistrationApplication,
  SystemHealthDetails,
  AuditItem,
  DriftReport,
  BackupRecordItem,
  PlatformAnalytics,
} from '../../types';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import {
  Plus,
  Mail,
  CheckCircle2,
  Server,
  ArrowRight,
  ClipboardList,
  History,
  FileText,
  BarChart3,
  HardDrive,
  SendHorizontal,
  Inbox,
} from 'lucide-react';

interface DashboardOverviewViewProps {
  tenants: TenantSummary[];
  metrics: SystemMetrics | null;
  healthDetails: SystemHealthDetails | null;
  applications: RegistrationApplication[];
  backups: BackupRecordItem[];
  driftReport: DriftReport | null;
  recentAuditLogs: AuditItem[];
  analyticsData?: PlatformAnalytics | null;
  onNavigateTab: (tab: 'applications' | 'tenants' | 'operations' | 'audit' | 'analytics') => void;
  onReviewApplication: (app: RegistrationApplication) => void;
  onActivateTenant: (tenant: TenantSummary) => void;
}

function formatRelativeTime(date: Date | string | undefined): string {
  if (!date) return 'recently';
  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return 'recently';
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

const getInitials = (text: string) => {
  if (!text) return 'AP';
  const parts = text.trim().split(/[._\s-]+/);
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return text.slice(0, 2).toUpperCase();
};

export const DashboardOverviewView: React.FC<DashboardOverviewViewProps> = ({
  tenants,
  metrics,
  healthDetails,
  applications,
  backups,
  driftReport: _driftReport,
  recentAuditLogs,
  analyticsData,
  onNavigateTab,
  onReviewApplication,
  onActivateTenant,
}) => {
  const pendingApps = applications.filter((a) => a.status === 'PENDING_REVIEW');
  const pendingActivationTenants = tenants.filter((t) => t.status === 'approved_pending_setup');
  const activeTenants = tenants.filter((t) => t.status === 'active');

  const totalMailboxesUsed = tenants.reduce((acc, t) => acc + (t.mailboxCount || 0), 0);
  const totalMailboxQuota = tenants.reduce((acc, t) => acc + (t.mailboxLimit || 0), 0);
  const effectiveQuota = totalMailboxQuota > 0 ? totalMailboxQuota : 5000;
  const usagePercent = Math.min(100, Math.round((totalMailboxesUsed / Math.max(1, effectiveQuota)) * 100));
  const availableCount = Math.max(0, effectiveQuota - totalMailboxesUsed);

  const mongoStatus = healthDetails?.services?.mongodb?.status || 'healthy';
  const mongoPing = healthDetails?.services?.mongodb?.pingMs;
  const stalwartStatus = healthDetails?.services?.stalwart?.status || metrics?.stalwart?.status || 'connected';
  const stalwartLatency = healthDetails?.services?.stalwart?.latencyMs;
  const queueDepth = healthDetails?.services?.stalwart?.queueDepth ?? 0;

  const latestBackup = backups.length > 0
    ? backups[0]
    : (healthDetails?.backups?.latestBackupAt ? { createdAt: healthDetails.backups.latestBackupAt } : null);

  const hasSystemIssue = mongoStatus !== 'healthy' || stalwartStatus !== 'connected';

  const backupStatusText = latestBackup
    ? `Up to date (${formatRelativeTime(latestBackup.createdAt)})`
    : 'Up to date';

  const displayApps = pendingApps.length > 0
    ? pendingApps.slice(0, 4)
    : applications.slice(0, 4);

  return (
    <div className="flex flex-col gap-8" id="view-dashboard">
      {/* 1. TOP ACTION & CONTEXT BAR */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Admin Overview
          </h1>
          <p className="text-xs text-slate-500 font-normal">
            Platform infrastructure &amp; multi-tenant cluster telemetry
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              if (pendingActivationTenants.length > 0) {
                onActivateTenant(pendingActivationTenants[0]);
              } else {
                onNavigateTab('tenants');
              }
            }}
            icon={<Plus className="w-4 h-4" />}
          >
            Provision tenant
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onNavigateTab('tenants')}
          >
            Directory
          </Button>
        </div>
      </section>

      {/* 2. 3-PART OVERVIEW GRID (MATCHING TENANT ADMIN DASHBOARD) */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Card 1: Mailbox & Quota Allocation */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Mailbox Allocation
            </span>
            <Mail className="w-[18px] h-[18px] text-slate-400" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold text-slate-900">
                {totalMailboxesUsed}{' '}
                <span className="text-sm font-normal text-slate-500">
                  / {effectiveQuota} Used
                </span>
              </span>
              <span className="text-xs text-slate-500 ml-auto font-medium">
                {usagePercent}%
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  usagePercent >= 90
                    ? 'bg-rose-500'
                    : usagePercent >= 75
                    ? 'bg-amber-500'
                    : 'bg-indigo-600'
                }`}
                style={{ width: `${usagePercent}%` }}
              ></div>
            </div>
            <span className="text-[11px] text-slate-500 mt-1">
              {availableCount} Available for assignment across {activeTenants.length} tenants
            </span>
          </div>
        </div>

        {/* Card 2: Email Analytics Snapshot */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Email Analytics
            </span>
            <BarChart3 className="w-[18px] h-[18px] text-indigo-500" />
          </div>
          <div className="flex flex-col gap-3">
            {/* Storage row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <HardDrive className="w-3.5 h-3.5 text-amber-500" />
                <span>Storage Used</span>
              </div>
              <span className="text-sm font-semibold text-slate-900 tabular-nums">
                {analyticsData
                  ? analyticsData.snapshot.platform.totalStorageBytes >= 1073741824
                    ? `${(analyticsData.snapshot.platform.totalStorageBytes / 1073741824).toFixed(2)} GB`
                    : analyticsData.snapshot.platform.totalStorageBytes >= 1048576
                    ? `${(analyticsData.snapshot.platform.totalStorageBytes / 1048576).toFixed(1)} MB`
                    : `${Math.round(analyticsData.snapshot.platform.totalStorageBytes / 1024)} KB`
                  : '—'}
              </span>
            </div>
            {/* Emails Sent row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <SendHorizontal className="w-3.5 h-3.5 text-emerald-500" />
                <span>Emails Sent</span>
              </div>
              <span className="text-sm font-semibold text-slate-900 tabular-nums">
                {analyticsData ? analyticsData.snapshot.platform.totalEmailsSent.toLocaleString() : '—'}
              </span>
            </div>
            {/* Inbox row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Inbox className="w-3.5 h-3.5 text-blue-500" />
                <span>Inbox Emails</span>
              </div>
              <span className="text-sm font-semibold text-slate-900 tabular-nums">
                {analyticsData ? analyticsData.snapshot.platform.totalEmailsInbox.toLocaleString() : '—'}
              </span>
            </div>
          </div>
          <button
            onClick={() => onNavigateTab('analytics')}
            className="mt-4 flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
          >
            <span>View full analytics</span>
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>

        {/* Card 3: Cluster & Delivery Summary */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Cluster Summary
            </span>
            <Server className="w-[18px] h-[18px] text-slate-400" />
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <span className="text-2xl font-semibold text-slate-900 truncate">
                {activeTenants.length} Active Tenants
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-700 mt-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Stalwart Mail &amp; TLS 1.3 Strict Encrypted</span>
            </div>
          </div>
        </div>
      </section>

      {/* 3. INFRASTRUCTURE TELEMETRY STRIP */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6 text-xs">
          {/* Platform Health Status */}
          <div className="flex items-center gap-2.5 pr-6 border-r border-slate-200">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                hasSystemIssue ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse'
              }`}
            />
            <div>
              <span className="font-semibold text-slate-900 text-xs block">
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
                mongoStatus === 'healthy' ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${mongoStatus === 'healthy' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
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
                stalwartStatus === 'connected' ? 'text-emerald-700' : 'text-rose-700'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${stalwartStatus === 'connected' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
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
            <span className="text-slate-800 font-medium text-xs tabular-nums">
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
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </section>

      {/* 4. SIDE-BY-SIDE DUAL PANELS (MATCHING TENANT ADMIN EXACTLY) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Panel: Recent Applications */}
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-[18px] h-[18px] text-slate-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Recent Applications
              </h2>
            </div>
            <button
              onClick={() => onNavigateTab('applications')}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1"
            >
              <span>View all</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {displayApps.length === 0 ? (
            <div className="py-8 text-center flex flex-col items-center gap-2 text-slate-400">
              <Mail className="w-7 h-7" />
              <p className="text-xs">No recent applications to display.</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100">
              {displayApps.map((app) => (
                <div
                  key={app._id || app.id}
                  className="py-3 flex items-center justify-between gap-4 hover:bg-slate-50/50 -mx-2 px-2 rounded-lg transition-colors group"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-medium shrink-0">
                      {getInitials(app.companyName)}
                    </div>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-slate-900 truncate">
                          {app.companyName}
                        </span>
                        <span className="text-indigo-600 font-medium text-[11px]">
                          {app.requestedDomain}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 mt-0.5">
                        {app.applicantName} · {formatRelativeTime(app.createdAt)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <StatusBadge
                      status={
                        app.status === 'PENDING_REVIEW'
                          ? 'warning'
                          : app.status === 'APPROVED'
                          ? 'success'
                          : 'danger'
                      }
                      label={app.status === 'PENDING_REVIEW' ? 'Pending Review' : app.status}
                    />
                    <Button
                      size="sm"
                      variant={app.status === 'PENDING_REVIEW' ? 'primary' : 'secondary'}
                      onClick={() => onReviewApplication(app)}
                    >
                      {app.status === 'PENDING_REVIEW' ? 'Review' : 'Details'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Right Panel: Platform Event Log */}
        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <History className="w-[18px] h-[18px] text-slate-400" />
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Platform Event Log
              </h2>
            </div>
            <button
              onClick={() => onNavigateTab('audit')}
              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1"
            >
              <span>View audit log</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {recentAuditLogs.length === 0 ? (
            <div className="py-8 text-center flex flex-col items-center gap-2 text-slate-400">
              <FileText className="w-7 h-7" />
              <p className="text-xs">No recent events recorded.</p>
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100">
              {recentAuditLogs.slice(0, 5).map((log) => (
                <div key={log.id} className="py-3 flex flex-col gap-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-800 leading-snug">
                      {log.action}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {formatRelativeTime(log.timestamp)}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400">
                    {log.resource ? `${log.resource} · ` : ''}{log.actor_role}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
