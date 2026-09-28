import React, { useState, useMemo } from 'react';
import {
  Building2,
  Search,
  CheckCircle2,
  AlertTriangle,
  PauseCircle,
  RefreshCw,
  Plus,
  ChevronRight,
  Archive,
} from 'lucide-react';
import { TenantSummary } from '../../types';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';
import { formatRelativeTime, formatFullTimestamp } from '../../utils/formatTime';

interface TenantsManagementViewProps {
  tenants: TenantSummary[];
  loading: boolean;
  onRefresh: () => void;
  onCreateTenant: () => void;
  onViewDetails: (tenant: TenantSummary) => void;
  onActivateTenant?: (tenant: TenantSummary) => void;
  onToggleSuspend?: (tenant: TenantSummary) => void;
  onManageAdmins?: (tenant: TenantSummary) => void;
  onUpdateQuota?: (tenant: TenantSummary) => void;
  onDeleteTenant?: (tenant: TenantSummary) => void;
  onViewDeletedArchive?: () => void;
}

export const TenantsManagementView: React.FC<TenantsManagementViewProps> = ({
  tenants,
  loading,
  onRefresh,
  onCreateTenant,
  onViewDetails,
  onViewDeletedArchive,
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'approved_pending_setup' | 'suspended'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Counts
  const activeCount = useMemo(() => tenants.filter((t) => t.status === 'active').length, [tenants]);
  const pendingCount = useMemo(() => tenants.filter((t) => t.status === 'approved_pending_setup').length, [tenants]);
  const suspendedCount = useMemo(() => tenants.filter((t) => t.status === 'suspended').length, [tenants]);
  const allCount = tenants.length;

  const filteredTenants = useMemo(() => {
    return tenants.filter((tenant) => {
      if (filterStatus !== 'all' && tenant.status !== filterStatus) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        return tenant.name?.toLowerCase().includes(query);
      }
      return true;
    });
  }, [tenants, filterStatus, searchQuery]);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 shadow-xs flex flex-col gap-4 sm:gap-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-900">Tenant Directory</h2>
          <p className="text-xs text-slate-500">
            Review, provision, and administer organization tenants across the cluster
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {onViewDeletedArchive && (
            <Button
              size="sm"
              variant="secondary"
              onClick={onViewDeletedArchive}
              icon={<Archive className="w-4 h-4 text-slate-500" />}
              className="w-full sm:w-auto justify-center min-h-[44px] sm:min-h-0"
            >
              Deleted Archive
            </Button>
          )}
          <Button
            size="sm"
            variant="primary"
            onClick={onCreateTenant}
            icon={<Plus className="w-4 h-4" />}
            className="w-full sm:w-auto justify-center min-h-[44px] sm:min-h-0"
          >
            Provision Tenant
          </Button>
        </div>
      </div>

      {/* Top Filter Bar & Actions */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Status Filters Segmented Control */}
        <div className="flex overflow-x-auto no-scrollbar bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs gap-1 sm:gap-0 max-w-full">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
              filterStatus === 'all'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>All Tenants</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-semibold">
              {allCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('active')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
              filterStatus === 'active'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CheckCircle2 size={13} className={filterStatus === 'active' ? 'text-indigo-600' : 'text-slate-500'} />
            <span>Active</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
              {activeCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('approved_pending_setup')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
              filterStatus === 'approved_pending_setup'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <AlertTriangle size={13} className={filterStatus === 'approved_pending_setup' ? 'text-indigo-600' : 'text-slate-500'} />
            <span>Pending Setup</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 font-semibold">
              {pendingCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('suspended')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 cursor-pointer ${
              filterStatus === 'suspended'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PauseCircle size={13} className={filterStatus === 'suspended' ? 'text-indigo-600' : 'text-slate-500'} />
            <span>Suspended</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-red-100 text-red-800 font-semibold">
              {suspendedCount}
            </span>
          </button>
        </div>

        {/* Right side: Search, Refresh */}
        <div className="flex items-center gap-2.5 w-full lg:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search organization..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 sm:py-1.5 text-base sm:text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 min-h-[44px] sm:min-h-0 bg-white"
            />
          </div>

          <Button
            size="sm"
            variant="secondary"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh tenant directory"
            className="shrink-0 min-h-[44px] sm:min-h-0 px-3"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Tenants Directory Table */}
      <div className="data-table-container">
        {loading && tenants.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            Loading tenant directory...
          </div>
        ) : filteredTenants.length === 0 ? (
          <div className="p-12 text-center">
            <Building2 size={36} className="mx-auto mb-3 text-slate-300" />
            <div className="text-sm font-semibold text-slate-800 mb-1">
              {filterStatus === 'all' ? 'No Tenants Registered' : 'No Tenants Match Criteria'}
            </div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {filterStatus === 'all'
                ? 'No organization tenants exist on the platform. Click "Provision Tenant" to create one.'
                : 'Try clearing the search query or selecting a different status filter above.'}
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table View (>= md) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Status</th>
                    <th>Mailbox Allocation</th>
                    <th>Created</th>
                    <th style={{ textAlign: 'right', width: 44 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTenants.map((tenant) => {
                    const isActive = tenant.status === 'active';
                    const isPending = tenant.status === 'approved_pending_setup';
                    const isSuspended = tenant.status === 'suspended';

                    const usagePct = tenant.mailboxLimit > 0
                      ? Math.round(((tenant.mailboxCount || 0) / tenant.mailboxLimit) * 100)
                      : 0;

                    const barColor = usagePct >= 90 ? 'bg-red-500' : usagePct >= 75 ? 'bg-amber-500' : 'bg-indigo-600';

                    return (
                      <tr
                        key={tenant.id}
                        onClick={() => onViewDetails(tenant)}
                        className="cursor-pointer hover:bg-slate-50/80 transition-colors group"
                      >
                        {/* Organization */}
                        <td>
                          <span className="font-semibold text-slate-900 text-xs sm:text-sm">
                            {tenant.name}
                          </span>
                        </td>

                        {/* Status */}
                        <td>
                          {isActive && <StatusBadge status="success">Active</StatusBadge>}
                          {isPending && <StatusBadge status="warning">Pending Setup</StatusBadge>}
                          {isSuspended && <StatusBadge status="danger">Suspended</StatusBadge>}
                        </td>

                        {/* Mailbox Allocation (Sleek Horizontal Bar matching Domain List) */}
                        <td>
                          <div className="flex items-center gap-2.5 min-w-[140px]">
                            <div className="flex-1 min-w-[60px] max-w-[80px] bg-slate-100 rounded-full h-1.5 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${barColor}`}
                                style={{ width: `${Math.min(usagePct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                              {tenant.mailboxCount || 0} / {tenant.mailboxLimit}
                            </span>
                          </div>
                        </td>

                        {/* Created Date */}
                        <td>
                          <div className="text-xs text-slate-700" title={formatFullTimestamp(tenant.createdAt)}>
                            {formatRelativeTime(tenant.createdAt)}
                          </div>
                        </td>

                        {/* Row Navigation Chevron */}
                        <td style={{ textAlign: 'right' }}>
                          <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all inline-block" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Cards View (< md) */}
            <div className="block md:hidden divide-y divide-slate-100">
              {filteredTenants.map((tenant) => {
                const isActive = tenant.status === 'active';
                const isPending = tenant.status === 'approved_pending_setup';
                const usagePct = tenant.mailboxLimit > 0
                  ? Math.round(((tenant.mailboxCount || 0) / tenant.mailboxLimit) * 100)
                  : 0;
                const barColor = usagePct >= 90 ? 'bg-red-500' : usagePct >= 75 ? 'bg-amber-500' : 'bg-indigo-600';

                return (
                  <div
                    key={tenant.id}
                    onClick={() => onViewDetails(tenant)}
                    className="p-4 flex flex-col gap-2.5 active:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900 text-sm truncate">{tenant.name}</span>
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    </div>

                    <div className="flex items-center justify-between text-xs gap-2">
                      <div className="flex items-center gap-1.5">
                        {isActive && <StatusBadge status="success">Active</StatusBadge>}
                        {isPending && <StatusBadge status="warning">Pending</StatusBadge>}
                        {!isActive && !isPending && <StatusBadge status="danger">Suspended</StatusBadge>}
                      </div>
                    </div>

                    <div className="flex flex-col gap-1 pt-1">
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Mailbox Quota</span>
                        <span className="tabular-nums font-medium text-slate-700">
                          {tenant.mailboxCount || 0} / {tenant.mailboxLimit} ({usagePct}%)
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(usagePct, 100)}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
