import React, { useState, useMemo } from 'react';
import {
  RefreshCw,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
} from 'lucide-react';
import { PlatformAnalytics, AnalyticsTenantRow } from '../../types';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';

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
      <div className="flex-1 flex items-center justify-center min-h-[50vh]">
        <div className="flex flex-col items-center gap-2 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
          <span className="text-sm font-medium text-slate-600">Loading analytics…</span>
        </div>
      </div>
    );
  }

  const snap = data?.snapshot;
  const platform = snap?.platform;
  const topConsumers = data?.topStorageConsumers || [];

  const SortHeader = ({ col, label, align = 'left' }: { col: SortKey; label: string; align?: 'left' | 'right' }) => (
    <th
      onClick={() => handleSort(col)}
      className={`px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-900 transition-colors whitespace-nowrap ${
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
    <div className="flex flex-col gap-6 font-sans">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h1 className="text-xl sm:text-lg font-semibold tracking-tight text-slate-900">Analytics</h1>
          <p className="text-xs text-slate-500 mt-1">
            Cluster disk storage, mailbox allocations, and per-tenant quota utilization.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
          {data?.stalwartReachable === false && (
            <span className="text-xs font-medium text-amber-600">
              Stalwart offline
            </span>
          )}
          {data?.generatedAt && (
            <span className="text-xs text-slate-400">
              Updated {relativeTime(data.generatedAt)}
            </span>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={onRefresh}
            disabled={loading}
            id="btn-refresh-analytics"
            className="min-h-[44px] sm:min-h-0"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* ── High-Level Summary Metrics (3 Clean, Single-Level Cards) ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Storage */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Total Storage Used
          </span>
          <div className="my-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {platform ? formatBytes(platform.totalStorageBytes) : '—'}
            </span>
          </div>
          <div className="text-xs text-slate-500">
            {platform ? `Avg. ${formatBytes(platform.avgStoragePerMailboxBytes)} per mailbox` : 'Cluster storage'}
          </div>
        </div>

        {/* Mailboxes */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Active Mailboxes
          </span>
          <div className="my-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {snap?.activeMailboxes ?? '—'}
            </span>
          </div>
          <div className="text-xs text-slate-500">
            {snap ? (
              snap.suspendedMailboxes > 0 ? (
                <span>{snap.totalMailboxes} total ({snap.suspendedMailboxes} suspended)</span>
              ) : (
                <span>{snap.totalMailboxes} total accounts provisioned</span>
              )
            ) : (
              'Accounts provisioned'
            )}
          </div>
        </div>

        {/* Organizations */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Active Organizations
          </span>
          <div className="my-2">
            <span className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
              {snap?.activeTenants ?? '—'}
            </span>
          </div>
          <div className="text-xs text-slate-500">
            {snap ? `${snap.totalTenants} total tenants (${snap.totalDomains} domains)` : 'Registered organizations'}
          </div>
        </div>
      </div>

      {/* ── Primary Table: Tenant Usage & Quotas ── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        {/* Table Toolbar */}
        <div className="px-5 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-900">Tenant Usage & Quotas</h2>
            <span className="text-xs text-slate-400">
              ({filteredAndSortedTenants.length})
            </span>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search tenants or domains..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-2 sm:py-1.5 text-base sm:text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:bg-white transition-colors min-h-[44px] sm:min-h-0"
            />
          </div>
        </div>

        {/* Mobile Cards for Tenant Usage (< md) */}
        <div className="block md:hidden divide-y divide-slate-100">
          {filteredAndSortedTenants.length === 0 ? (
            <div className="text-center py-8 text-slate-400 text-xs">
              {searchTerm ? 'No tenants matching search criteria.' : 'No tenant analytics available.'}
            </div>
          ) : (
            filteredAndSortedTenants.map((t) => (
              <div key={t.tenantId} className="p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 text-sm truncate">{t.tenantName}</div>
                    <div className="text-[11px] text-slate-500 truncate">{t.domainName}</div>
                  </div>
                  <StatusBadge status={t.status} />
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase font-semibold text-slate-400">Mailbox Quota</span>
                    <span className="tabular-nums font-medium text-slate-700">
                      {t.mailboxCount} / {t.mailboxLimit} ({t.utilizationPct}%)
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase font-semibold text-slate-400">Storage Used</span>
                    <span className="tabular-nums font-semibold text-slate-900">
                      {formatBytes(t.storageBytes)}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-0.5 px-0.5">
                  <span>Sent: <strong className="text-slate-700">{formatNumber(t.emailsSent)}</strong></span>
                  <span>Inbox: <strong className="text-slate-700">{formatNumber(t.emailsInbox)}</strong></span>
                  <span>Stored: <strong className="text-slate-900 font-semibold">{formatNumber(t.totalEmails)}</strong></span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Desktop Table (>= md) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs text-left font-sans">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <SortHeader col="tenantName" label="Tenant & Domain" />
                <th className="px-4 py-3 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-left">
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
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900">{t.tenantName}</div>
                      <div className="text-[11px] text-slate-500">{t.domainName}</div>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="px-4 py-3 text-slate-700 tabular-nums">
                      {t.mailboxCount} <span className="text-slate-400">/ {t.mailboxLimit}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      <span
                        className={
                          t.utilizationPct >= 90
                            ? 'text-rose-600 font-semibold'
                            : t.utilizationPct >= 70
                            ? 'text-amber-600 font-semibold'
                            : 'text-slate-700'
                        }
                      >
                        {t.utilizationPct}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900 tabular-nums">
                      {formatBytes(t.storageBytes)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 tabular-nums">
                      {formatNumber(t.emailsSent)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500 tabular-nums">
                      {formatNumber(t.emailsInbox)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums">
                      {formatNumber(t.totalEmails)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Secondary Table: Top Mailboxes by Storage (Quiet Reference) ── */}
      {topConsumers.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Top Mailboxes by Storage</h2>
            <span className="text-xs text-slate-400 font-normal">
              {topConsumers.length} accounts
            </span>
          </div>

          {/* Mobile Cards for Top Consumers (< md) */}
          <div className="block md:hidden divide-y divide-slate-100">
            {topConsumers.slice(0, 10).map((c, i) => (
              <div key={c.address} className="p-3.5 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 font-bold text-xs flex items-center justify-center shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-900 truncate">{c.address}</div>
                    <div className="text-[11px] text-slate-500 truncate">{c.tenantName}</div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-bold text-slate-900 tabular-nums">{formatBytes(c.storageBytes)}</div>
                  <div className="text-[10px] text-slate-400">{formatNumber(c.emailsSent)} sent</div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table (>= md) */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-xs text-left font-sans">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider w-12 text-center">
                    #
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Mailbox Address
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    Organization
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-right">
                    Storage Used
                  </th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider text-right">
                    Emails Sent
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topConsumers.slice(0, 10).map((c, i) => (
                  <tr key={c.address} className="hover:bg-slate-50/70 transition-colors">
                    <td className="px-4 py-2.5 text-slate-400 text-center tabular-nums">
                      {i + 1}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {c.address}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {c.tenantName}
                    </td>
                    <td className="px-4 py-2.5 text-right font-medium text-slate-900 tabular-nums">
                      {formatBytes(c.storageBytes)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500 tabular-nums">
                      {formatNumber(c.emailsSent)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
