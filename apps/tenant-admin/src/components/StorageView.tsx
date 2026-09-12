import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  HardDrive,
  Mail,
  RefreshCw,
  Search,
  ArrowUpDown,
  Database,
  ArrowUp,
  ArrowDown,
  Inbox,
} from 'lucide-react';
import { api } from '../api';
import { DomainItem, MailboxStorageItem, TenantStorageSummary } from '../types';
import { Button } from './ui/Button';
import { StatusBadge } from './ui/StatusBadge';

interface StorageViewProps {
  activeDomain?: DomainItem | null;
}

type SortKey = 'storageBytes' | 'address' | 'createdAt';
type SortDir = 'asc' | 'desc';

export const StorageView: React.FC<StorageViewProps> = ({ activeDomain }) => {
  const [summary, setSummary] = useState<TenantStorageSummary | null>(null);
  const [mailboxes, setMailboxes] = useState<MailboxStorageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('storageBytes');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const fetchStorageData = useCallback(async (isManualRefresh = false) => {
    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const res = await api.getStorageUsage(activeDomain?.id);
      setSummary(res.summary);
      setMailboxes(res.mailboxes || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load storage usage.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeDomain?.id]);

  useEffect(() => {
    fetchStorageData();
  }, [fetchStorageData]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'storageBytes' ? 'desc' : 'asc');
    }
  };

  const filteredAndSortedMailboxes = useMemo(() => {
    let list = [...mailboxes];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (m) =>
          m.address.toLowerCase().includes(q) ||
          m.localPart.toLowerCase().includes(q) ||
          m.domainName.toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let comparison = 0;
      if (sortKey === 'storageBytes') {
        comparison = a.storageBytes - b.storageBytes;
      } else if (sortKey === 'address') {
        comparison = a.address.localeCompare(b.address);
      } else if (sortKey === 'createdAt') {
        comparison = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }
      return sortDir === 'asc' ? comparison : -comparison;
    });

    return list;
  }, [mailboxes, searchQuery, sortKey, sortDir]);

  const averageStorageFormatted = useMemo(() => {
    if (!summary || summary.mailboxCount === 0) return '0 B';
    const avgBytes = Math.round(summary.totalStorageBytes / summary.mailboxCount);
    if (avgBytes < 1024) return `${avgBytes} B`;
    if (avgBytes < 1024 * 1024) return `${(avgBytes / 1024).toFixed(1)} KB`;
    if (avgBytes < 1024 * 1024 * 1024) return `${(avgBytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(avgBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }, [summary]);

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto py-2">
      {/* PAGE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-1">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2.5">
            Storage
          </h1>
          <p className="text-sm text-slate-500">
            {activeDomain ? (
              <>
                Disk space consumed by mailboxes on{' '}
                <span className="font-medium text-slate-700">@{activeDomain.domainName}</span>
              </>
            ) : (
              'Monitor mailbox disk usage and storage distribution across your organization.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchStorageData(true)}
            disabled={loading || refreshing}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-indigo-600' : ''}`} />}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button
            onClick={() => fetchStorageData(true)}
            className="font-medium underline hover:text-red-900 cursor-pointer ml-4"
          >
            Retry
          </button>
        </div>
      )}

      {/* SUMMARY METRIC CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Total Storage Used Card */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Total Storage Used
            </span>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <HardDrive className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 tracking-tight" data-testid="total-storage-val">
              {loading && !summary ? '—' : (summary?.totalStorageFormatted || '0 B')}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Across {summary?.mailboxCount || 0} configured {summary?.mailboxCount === 1 ? 'mailbox' : 'mailboxes'}
          </p>
        </div>

        {/* Mailboxes With Data Card */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Active Mailboxes
            </span>
            <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <Mail className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 tracking-tight" data-testid="mailbox-count-val">
              {loading && !summary ? '—' : (summary?.mailboxCount || 0)}
            </span>
            <span className="text-xs text-slate-500">
              ({summary?.mailboxesWithData || 0} with stored emails)
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Managed via Stalwart mail storage
          </p>
        </div>

        {/* Average per Mailbox Card */}
        <div className="bg-white border border-slate-200/90 rounded-2xl p-5 shadow-xs flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wider text-slate-500">
              Average per Mailbox
            </span>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 tracking-tight" data-testid="avg-storage-val">
              {loading && !summary ? '—' : averageStorageFormatted}
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Average disk utilization per account
          </p>
        </div>
      </div>

      {/* SEARCH AND FILTER TOOLBAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-2xl p-3 sm:px-4 shadow-xs">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search mailboxes by address or prefix…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
            id="storage-search-input"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto text-xs text-slate-500">
          <span>Sort by:</span>
          <button
            onClick={() => handleSort('storageBytes')}
            className={`px-2.5 py-1 rounded-lg border font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
              sortKey === 'storageBytes'
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span>Storage</span>
            {sortKey === 'storageBytes' ? (
              sortDir === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />
            ) : (
              <ArrowUpDown className="w-3 h-3 opacity-40" />
            )}
          </button>

          <button
            onClick={() => handleSort('address')}
            className={`px-2.5 py-1 rounded-lg border font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
              sortKey === 'address'
                ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <span>Address</span>
            {sortKey === 'address' ? (
              sortDir === 'desc' ? <ArrowDown className="w-3 h-3" /> : <ArrowUp className="w-3 h-3" />
            ) : (
              <ArrowUpDown className="w-3 h-3 opacity-40" />
            )}
          </button>
        </div>
      </div>

      {/* STORAGE TABLE */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
        {loading && !summary ? (
          <div className="p-12 text-center flex flex-col items-center justify-center gap-3 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
            <span className="text-xs font-medium text-slate-500">Loading mailbox storage…</span>
          </div>
        ) : filteredAndSortedMailboxes.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
              <Inbox className="w-6 h-6" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-slate-800">No mailboxes found</p>
              <p className="text-xs text-slate-500">
                {searchQuery
                  ? 'No mailboxes match your search query.'
                  : 'No mailboxes have been created for this domain yet.'}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                  <th className="py-3 px-4 sm:px-6">Mailbox</th>
                  <th className="py-3 px-4">Domain</th>
                  <th className="py-3 px-4 w-64">Storage Used</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 sm:px-6 text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredAndSortedMailboxes.map((mb) => (
                  <tr key={mb.id} className="hover:bg-slate-50/60 transition-colors group">
                    {/* Mailbox Info */}
                    <td className="py-3.5 px-4 sm:px-6">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center font-semibold text-xs shrink-0">
                          {mb.localPart.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="font-semibold text-slate-900 truncate">
                            {mb.address}
                          </span>
                          <span className="text-[11px] text-slate-400 font-mono">
                            {mb.localPart}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Domain */}
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200/60">
                        {mb.domainName}
                      </span>
                    </td>

                    {/* Storage & Relative Bar */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-baseline justify-between">
                          <span className="font-semibold text-slate-900">
                            {mb.storageFormatted}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            {mb.percentage}%
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              mb.storageBytes > 100 * 1024 * 1024
                                ? 'bg-amber-500'
                                : 'bg-indigo-600'
                            }`}
                            style={{ width: `${Math.max(mb.storageBytes > 0 ? 3 : 0, mb.percentage)}%` }}
                          />
                        </div>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 text-center">
                      <StatusBadge status={mb.status === 'active' ? 'active' : 'suspended'} />
                    </td>

                    {/* Created Date */}
                    <td className="py-3.5 px-4 sm:px-6 text-right text-slate-400 font-mono text-[11px]">
                      {new Date(mb.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
