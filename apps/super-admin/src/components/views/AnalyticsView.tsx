import React, { useState, useMemo } from 'react';
import {
  HardDrive,
  Mail,
  SendHorizontal,
  Inbox,
  TrendingUp,
  RefreshCw,
  WifiOff,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ShieldAlert,
  LogIn,
  Layers,
  Building2,
  Loader2,
} from 'lucide-react';
import { PlatformAnalytics, AnalyticsTenantRow } from '../../types';

// ── Utility helpers ──────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Types ────────────────────────────────────────────────────────────────────

type SortKey = keyof Pick<
  AnalyticsTenantRow,
  'tenantName' | 'mailboxCount' | 'utilizationPct' | 'storageBytes' | 'emailsSent' | 'emailsInbox' | 'totalEmails'
>;
type SortDir = 'asc' | 'desc';

interface AnalyticsViewProps {
  data: PlatformAnalytics | null;
  loading: boolean;
  onRefresh: () => void;
}

export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ data, loading, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('storageBytes');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const filteredAndSortedTenants = useMemo(() => {
    if (!data?.perTenant) return [];
    const term = searchTerm.trim().toLowerCase();
    const list = data.perTenant.filter(
      (t) =>
        t.tenantName.toLowerCase().includes(term) ||
        t.domainName.toLowerCase().includes(term)
    );

    return list.sort((a, b) => {
      const av = a[sortKey] as any;
      const bv = b[sortKey] as any;
      const cmp = typeof av === 'string' ? av.localeCompare(bv) : av - bv;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, searchTerm, sortKey, sortDir]);

  if (loading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-2.5 text-slate-400">
          <Loader2 className="w-7 h-7 animate-spin text-slate-600" />
          <span className="text-sm font-medium text-slate-600">Loading analytics telemetry…</span>
          <span className="text-xs text-slate-400">Querying cluster storage and Stalwart JMAP metrics</span>
        </div>
      </div>
    );
  }

  const snap = data?.snapshot;
  const platform = snap?.platform;
  const audit = data?.auditSummary?.last30Days;
  const maxStorage = data?.topStorageConsumers?.[0]?.storageBytes || 1;

  const SortHeader = ({ col, label, align = 'left' }: { col: SortKey; label: string; align?: 'left' | 'right' }) => (
    <th
      onClick={() => handleSort(col)}
      className={`px-3.5 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900 transition-colors whitespace-nowrap ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <div className={`inline-flex items-center gap-1.5 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <span>{label}</span>
        {sortKey === col ? (
          sortDir === 'asc' ? (
            <ArrowUp className="w-3 h-3 text-indigo-600" />
          ) : (
            <ArrowDown className="w-3 h-3 text-indigo-600" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400" />
        )}
      </div>
    </th>
  );

  return (
    <div className="flex-1 flex flex-col gap-6">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200/80">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">Email & Storage Analytics</h1>
            {data?.stalwartReachable ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Live Sync
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200/60">
                <WifiOff className="w-3 h-3 text-amber-600" />
                Stalwart Offline
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time mailbox storage, message volumes, and multi-tenant quota allocation across the cluster.
            {data?.generatedAt && (
              <span className="ml-2 text-slate-400 font-mono">Updated {relativeTime(data.generatedAt)}</span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 shadow-sm transition-colors disabled:opacity-50"
            id="btn-refresh-analytics"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Telemetry</span>
          </button>
        </div>
      </div>

      {/* ── Top Metric Strip (Clean, Minimal, High-Density) ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {/* Storage Used */}
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            <span>Storage Used</span>
            <HardDrive className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 tabular-nums">
              {platform ? formatBytes(platform.totalStorageBytes) : '—'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {platform ? `avg ${formatBytes(platform.avgStoragePerMailboxBytes)} / box` : 'Cluster storage'}
          </div>
        </div>

        {/* Emails Sent */}
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            <span>Emails Sent</span>
            <SendHorizontal className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 tabular-nums">
              {platform ? formatNumber(platform.totalEmailsSent) : '—'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {data?.stalwartReachable ? 'Sent folders total' : 'Offline'}
          </div>
        </div>

        {/* Inbox Emails */}
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            <span>Inbox Emails</span>
            <Inbox className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 tabular-nums">
              {platform ? formatNumber(platform.totalEmailsInbox) : '—'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {platform ? `${formatNumber(platform.totalEmails)} total stored` : 'Inbox volume'}
          </div>
        </div>

        {/* Total Mailboxes */}
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            <span>Mailboxes</span>
            <Mail className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 tabular-nums">
              {snap?.totalMailboxes ?? '—'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 truncate flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
            <span>{snap ? `${snap.activeMailboxes} active` : 'Active accounts'}</span>
            {snap && snap.suspendedMailboxes > 0 && (
              <span className="text-rose-600 font-medium">· {snap.suspendedMailboxes} locked</span>
            )}
          </div>
        </div>

        {/* Active Tenants */}
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            <span>Tenants</span>
            <Building2 className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 tabular-nums">
              {snap?.activeTenants ?? '—'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {snap ? `of ${snap.totalTenants} organizations` : 'Organizations'}
          </div>
        </div>

        {/* Audit Events */}
        <div className="bg-white border border-slate-200/80 rounded-xl p-4 flex flex-col justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            <span>Events (30d)</span>
            <TrendingUp className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <div className="my-2">
            <span className="text-2xl font-bold font-mono tracking-tight text-slate-900 tabular-nums">
              {audit ? formatNumber(audit.total) : '—'}
            </span>
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {audit ? `${audit.securityEvents} security audits` : 'Audit trail'}
          </div>
        </div>
      </div>

      {/* ── Middle Split: Mailbox Allocation & Top Storage Consumers ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Mailbox Capacity & Status Breakdown */}
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 flex flex-col justify-between shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Mailbox Allocation</h2>
                <p className="text-xs text-slate-500 mt-0.5">Active accounts vs suspended state across cluster</p>
              </div>
              <span className="text-xs font-mono font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/60">
                {snap ? `${snap.activeMailboxes}/${snap.totalMailboxes}` : '—'}
              </span>
            </div>

            {/* Segmented Capacity Bar */}
            <div className="space-y-2 mb-6">
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden flex">
                {snap && snap.totalMailboxes > 0 ? (
                  <>
                    <div
                      className="bg-emerald-500 h-full transition-all duration-300"
                      style={{ width: `${(snap.activeMailboxes / snap.totalMailboxes) * 100}%` }}
                      title={`Active: ${snap.activeMailboxes}`}
                    />
                    <div
                      className="bg-rose-500 h-full transition-all duration-300"
                      style={{ width: `${(snap.suspendedMailboxes / snap.totalMailboxes) * 100}%` }}
                      title={`Suspended: ${snap.suspendedMailboxes}`}
                    />
                  </>
                ) : (
                  <div className="bg-slate-200 h-full w-full" />
                )}
              </div>

              {/* Bar Legend */}
              <div className="flex items-center justify-between text-xs text-slate-600 pt-1">
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  <span>Active Mailboxes</span>
                  <span className="font-mono font-semibold text-slate-900 ml-1">{snap?.activeMailboxes ?? 0}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                  <span>Suspended</span>
                  <span className="font-mono font-semibold text-slate-900 ml-1">{snap?.suspendedMailboxes ?? 0}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Quick Health Summary Grid */}
          <div className="pt-4 border-t border-slate-100 grid grid-cols-3 gap-3">
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/60">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block">Total Tenants</span>
              <span className="text-lg font-bold font-mono text-slate-900 tabular-nums">{snap?.totalTenants ?? '—'}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-emerald-50/50 border border-emerald-200/50">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-emerald-600 block">Active Tenants</span>
              <span className="text-lg font-bold font-mono text-emerald-800 tabular-nums">{snap?.activeTenants ?? '—'}</span>
            </div>
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200/60">
              <span className="text-[10px] uppercase font-semibold tracking-wider text-slate-400 block">Suspended Tenants</span>
              <span className="text-lg font-bold font-mono text-slate-900 tabular-nums">{snap?.suspendedTenants ?? 0}</span>
            </div>
          </div>
        </div>

        {/* Top Storage Consumers (Clean, Ranked Bar List) */}
        <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Top Storage Consumers</h2>
              <p className="text-xs text-slate-500 mt-0.5">Ranked mailbox disk consumption from Stalwart quota telemetry</p>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {data?.topStorageConsumers?.length ?? 0} accounts
            </span>
          </div>

          {data?.topStorageConsumers && data.topStorageConsumers.length > 0 ? (
            <div className="space-y-2.5">
              {data.topStorageConsumers.slice(0, 6).map((c, i) => {
                const pct = maxStorage > 0 ? Math.min(100, Math.round((c.storageBytes / maxStorage) * 100)) : 0;
                return (
                  <div key={c.address} className="flex flex-col gap-1 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-[11px] text-slate-400 w-3.5 text-right">{i + 1}</span>
                        <span className="font-mono font-medium text-slate-800 truncate">{c.address}</span>
                        <span className="text-[11px] text-slate-400 truncate max-w-[120px]">({c.tenantName})</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {formatBytes(c.storageBytes)}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {c.emailsSent} sent
                        </span>
                      </div>
                    </div>
                    {/* Consistent, subtle progress bar */}
                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-900 rounded-full transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-44 flex items-center justify-center text-slate-400 text-xs">
              {data?.stalwartReachable ? 'No account storage data recorded' : 'Stalwart engine unreachable'}
            </div>
          )}
        </div>
      </div>

      {/* ── Per-Tenant Email & Storage Table ── */}
      <div className="bg-white border border-slate-200/80 rounded-xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        {/* Table Toolbar */}
        <div className="px-5 py-3.5 border-b border-slate-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-semibold text-slate-900">Tenant Usage & Quotas</h2>
            <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200/60">
              {filteredAndSortedTenants.length} tenants
            </span>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search tenants or domains..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:bg-white transition-colors"
            />
          </div>
        </div>

        {/* Data Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200/80">
              <tr>
                <SortHeader col="tenantName" label="Tenant & Domain" />
                <th className="px-3.5 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-left">
                  Status
                </th>
                <SortHeader col="mailboxCount" label="Mailboxes" />
                <SortHeader col="utilizationPct" label="Quota Used" />
                <SortHeader col="storageBytes" label="Storage" align="right" />
                <SortHeader col="emailsSent" label="Sent" align="right" />
                <SortHeader col="emailsInbox" label="Inbox" align="right" />
                <SortHeader col="totalEmails" label="Total Stored" align="right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredAndSortedTenants.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-400 text-xs">
                    {searchTerm ? 'No tenants matching search criteria.' : 'No tenant analytics available.'}
                  </td>
                </tr>
              ) : (
                filteredAndSortedTenants.map((t) => (
                  <tr key={t.tenantId} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-3.5 py-3">
                      <div className="font-medium text-slate-900">{t.tenantName}</div>
                      <div className="font-mono text-[11px] text-slate-400">{t.domainName}</div>
                    </td>
                    <td className="px-3.5 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border ${
                          t.status === 'active'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                            : 'bg-rose-50 text-rose-700 border-rose-200/60'
                        }`}
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            t.status === 'active' ? 'bg-emerald-500' : 'bg-rose-500'
                          }`}
                        />
                        {t.status === 'active' ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    <td className="px-3.5 py-3 font-mono text-slate-700 tabular-nums">
                      {t.mailboxCount} <span className="text-slate-400">/ {t.mailboxLimit}</span>
                    </td>
                    <td className="px-3.5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden shrink-0">
                          <div
                            className={`h-full rounded-full ${
                              t.utilizationPct >= 90
                                ? 'bg-rose-500'
                                : t.utilizationPct >= 70
                                ? 'bg-amber-400'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(t.utilizationPct, 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-slate-600 tabular-nums">{t.utilizationPct}%</span>
                      </div>
                    </td>
                    <td className="px-3.5 py-3 text-right font-mono font-medium text-slate-800 tabular-nums">
                      {formatBytes(t.storageBytes)}
                    </td>
                    <td className="px-3.5 py-3 text-right font-mono text-slate-600 tabular-nums">
                      {formatNumber(t.emailsSent)}
                    </td>
                    <td className="px-3.5 py-3 text-right font-mono text-slate-600 tabular-nums">
                      {formatNumber(t.emailsInbox)}
                    </td>
                    <td className="px-3.5 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums">
                      {formatNumber(t.totalEmails)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Bottom Section: 30-Day Activity Telemetry (Quiet, Minimalist) ── */}
      <div className="bg-white border border-slate-200/80 rounded-xl p-5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-900">Platform Activity Telemetry (30 Days)</h2>
          </div>
          <span className="text-xs font-mono text-slate-500">
            {audit ? `${audit.total.toLocaleString()} total events` : '—'}
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Logins */}
          <div className="p-3.5 rounded-lg border border-slate-200/60 bg-slate-50/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Logins & Sessions</span>
              <LogIn className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="my-2">
              <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                {audit ? formatNumber(audit.logins) : 0}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {audit && audit.total > 0 ? `${Math.round((audit.logins / audit.total) * 100)}% of total` : '0%'}
            </div>
          </div>

          {/* Mailbox Events */}
          <div className="p-3.5 rounded-lg border border-slate-200/60 bg-slate-50/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Mailbox Operations</span>
              <Mail className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="my-2">
              <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                {audit ? formatNumber(audit.mailboxEvents) : 0}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {audit && audit.total > 0 ? `${Math.round((audit.mailboxEvents / audit.total) * 100)}% of total` : '0%'}
            </div>
          </div>

          {/* Tenant Lifecycle */}
          <div className="p-3.5 rounded-lg border border-slate-200/60 bg-slate-50/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Tenant Lifecycle</span>
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="my-2">
              <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                {audit ? formatNumber(audit.tenantLifecycle) : 0}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {audit && audit.total > 0 ? `${Math.round((audit.tenantLifecycle / audit.total) * 100)}% of total` : '0%'}
            </div>
          </div>

          {/* Security Events */}
          <div className="p-3.5 rounded-lg border border-slate-200/60 bg-slate-50/50 flex flex-col justify-between">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Security Audits</span>
              <ShieldAlert className="w-3.5 h-3.5 text-slate-400" />
            </div>
            <div className="my-2">
              <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
                {audit ? formatNumber(audit.securityEvents) : 0}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              {audit && audit.total > 0 ? `${Math.round((audit.securityEvents / audit.total) * 100)}% of total` : '0%'}
            </div>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="text-center text-[11px] text-slate-400 py-1 font-mono">
        Live telemetry aggregated from MongoDB state and Stalwart Mail Server via JMAP admin session.
      </div>
    </div>
  );
};
