import React, { useState, useMemo } from 'react';
import {
  Building2,
  Globe,
  Search,
  CheckCircle2,
  AlertTriangle,
  PauseCircle,
  PlayCircle,
  Sliders,
  Users,
  Trash2,
  RefreshCw,
  Plus,
  ChevronRight,
  Archive,
} from 'lucide-react';
import { TenantSummary } from '../../types';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';

interface TenantsManagementViewProps {
  tenants: TenantSummary[];
  loading: boolean;
  onRefresh: () => void;
  onCreateTenant: () => void;
  onViewDetails: (tenant: TenantSummary) => void;
  onActivateTenant: (tenant: TenantSummary) => void;
  onToggleSuspend: (tenant: TenantSummary) => void;
  onManageAdmins: (tenant: TenantSummary) => void;
  onUpdateQuota: (tenant: TenantSummary) => void;
  onDeleteTenant: (tenant: TenantSummary) => void;
  onViewDeletedArchive?: () => void;
}

export const TenantsManagementView: React.FC<TenantsManagementViewProps> = ({
  tenants,
  loading,
  onRefresh,
  onCreateTenant,
  onViewDetails,
  onActivateTenant,
  onToggleSuspend,
  onManageAdmins,
  onUpdateQuota,
  onDeleteTenant,
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
        const matchesName = tenant.name?.toLowerCase().includes(query);
        const matchesDomain =
          tenant.domain?.domainName?.toLowerCase().includes(query) ||
          tenant.domains?.some((d) => d.domainName.toLowerCase().includes(query));
        return matchesName || matchesDomain;
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
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
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
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
              filterStatus === 'active'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CheckCircle2 size={13} />
            <span>Active</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
              {activeCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('approved_pending_setup')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
              filterStatus === 'approved_pending_setup'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <AlertTriangle size={13} />
            <span>Pending Setup</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 font-semibold">
              {pendingCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('suspended')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
              filterStatus === 'suspended'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <PauseCircle size={13} />
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
              placeholder="Search organization or domain..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 sm:py-1.5 text-base sm:text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 min-h-[44px] sm:min-h-0"
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
            {/* Desktop Table View (>= 768px) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Organization</th>
                    <th>Domain</th>
                    <th>Status</th>
                    <th>Mailbox Allocation</th>
                    <th>Created</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
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

                    return (
                      <tr
                        key={tenant.id}
                        onClick={() => onViewDetails(tenant)}
                        className="cursor-pointer hover:bg-slate-50/80 transition-colors group"
                      >
                        {/* Organization Name */}
                        <td>
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100">
                              <Building2 size={15} />
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 text-xs">
                                {tenant.name}
                              </div>
                              <div className="text-[11px] text-slate-400">
                                {tenant.adminCount || 0} admin{(tenant.adminCount || 0) !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Domain */}
                        <td>
                          {tenant.domain || (tenant.domains && tenant.domains.length > 0) ? (
                            <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium">
                              <Globe size={13} className="text-slate-400 shrink-0" />
                              <span>{tenant.domain?.domainName || tenant.domains![0].domainName}</span>
                              {tenant.domains && tenant.domains.length > 1 && (
                                <span
                                  className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold"
                                  title={tenant.domains.slice(1).map((d) => d.domainName).join(', ')}
                                >
                                  +{tenant.domains.length - 1}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">No domain</span>
                          )}
                        </td>

                        {/* Status */}
                        <td>
                          {isActive && <StatusBadge status="success">Active</StatusBadge>}
                          {isPending && <StatusBadge status="warning">Pending Setup</StatusBadge>}
                          {isSuspended && <StatusBadge status="danger">Suspended</StatusBadge>}
                        </td>

                        {/* Mailbox Allocation Meter */}
                        <td>
                          <div className="w-36 space-y-1 text-xs">
                            <div className="flex justify-between text-[11px]">
                              <span className="font-semibold text-slate-800 tabular-nums">
                                {tenant.mailboxCount || 0} / {tenant.mailboxLimit}
                              </span>
                              <span className="text-slate-400 tabular-nums">{usagePct}%</span>
                            </div>
                            <div className="progress-bar-bg">
                              <div
                                className={`h-full rounded-full ${usagePct > 85 ? 'bg-red-500' : 'bg-indigo-600'}`}
                                style={{ width: `${Math.min(usagePct, 100)}%` }}
                              />
                            </div>
                          </div>
                        </td>

                        {/* Created Date */}
                        <td>
                          <div className="text-xs text-slate-700">
                            {new Date(tenant.createdAt).toLocaleDateString()}
                          </div>
                        </td>

                        {/* Actions */}
                        <td style={{ textAlign: 'right' }}>
                          <div className="inline-flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                            {isPending && (
                              <Button
                                size="sm"
                                variant="primary"
                                onClick={() => onActivateTenant(tenant)}
                                title="Complete Tenant Activation"
                              >
                                Activate
                              </Button>
                            )}

                            {isActive && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onToggleSuspend(tenant)}
                                title="Suspend Tenant Access"
                                className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
                              >
                                <PauseCircle size={14} />
                              </Button>
                            )}

                            {isSuspended && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => onToggleSuspend(tenant)}
                                title="Reactivate Tenant Access"
                                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                              >
                                <PlayCircle size={14} />
                              </Button>
                            )}

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onUpdateQuota(tenant)}
                              title="Adjust Mailbox Quota Limit"
                            >
                              <Sliders size={14} />
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onManageAdmins(tenant)}
                              title="Manage Administrators"
                            >
                              <Users size={14} />
                            </Button>

                            <span className="w-px h-4 bg-slate-200 mx-0.5" aria-hidden="true" />

                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => onDeleteTenant(tenant)}
                              title="Delete Tenant"
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <Trash2 size={14} />
                            </Button>

                            <ChevronRight
                              size={15}
                              className="ml-1 text-slate-300 group-hover:text-slate-500 transition-colors shrink-0"
                              aria-hidden="true"
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Cards View (< 768px) */}
            <div className="md:hidden space-y-3 p-1">
              {filteredTenants.map((tenant) => {
                const isActive = tenant.status === 'active';
                const isPending = tenant.status === 'approved_pending_setup';
                const isSuspended = tenant.status === 'suspended';

                const usagePct = tenant.mailboxLimit > 0
                  ? Math.round(((tenant.mailboxCount || 0) / tenant.mailboxLimit) * 100)
                  : 0;

                return (
                  <div
                    key={tenant.id}
                    onClick={() => onViewDetails(tenant)}
                    className="p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 shadow-xs transition-all space-y-3 cursor-pointer"
                  >
                    {/* Header: Org Name & Status Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100">
                          <Building2 size={16} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 text-sm truncate">
                            {tenant.name}
                          </div>
                          <div className="text-xs text-slate-400">
                            {tenant.adminCount || 0} admin{(tenant.adminCount || 0) !== 1 ? 's' : ''}
                          </div>
                        </div>
                      </div>
                      <div className="shrink-0">
                        {isActive && <StatusBadge status="success">Active</StatusBadge>}
                        {isPending && <StatusBadge status="warning">Pending</StatusBadge>}
                        {isSuspended && <StatusBadge status="danger">Suspended</StatusBadge>}
                      </div>
                    </div>

                    {/* Domain & Creation Info */}
                    <div className="flex flex-wrap items-center justify-between text-xs gap-2 pt-1 border-t border-slate-100">
                      <div className="flex items-center gap-1.5 text-indigo-600 font-medium truncate">
                        <Globe size={13} className="text-slate-400 shrink-0" />
                        <span className="truncate">
                          {tenant.domain?.domainName || (tenant.domains && tenant.domains[0]?.domainName) || 'No domain'}
                        </span>
                        {tenant.domains && tenant.domains.length > 1 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[10px] font-semibold shrink-0">
                            +{tenant.domains.length - 1}
                          </span>
                        )}
                      </div>
                      <span className="text-slate-400 text-[11px]">
                        {new Date(tenant.createdAt).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Mailbox Allocation Meter */}
                    <div className="space-y-1 text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-slate-600">Mailboxes:</span>
                        <span className="font-semibold text-slate-800 tabular-nums">
                          {tenant.mailboxCount || 0} / {tenant.mailboxLimit} ({usagePct}%)
                        </span>
                      </div>
                      <div className="progress-bar-bg h-2">
                        <div
                          className={`h-full rounded-full ${usagePct > 85 ? 'bg-red-500' : 'bg-indigo-600'}`}
                          style={{ width: `${Math.min(usagePct, 100)}%` }}
                        />
                      </div>
                    </div>

                    {/* Card Actions Footer */}
                    <div
                      className="flex items-center justify-between gap-1 pt-2 border-t border-slate-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-1">
                        {isPending && (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => onActivateTenant(tenant)}
                            className="min-h-[44px] px-3 text-xs"
                          >
                            Activate
                          </Button>
                        )}
                        {isActive && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onToggleSuspend(tenant)}
                            title="Suspend"
                            className="min-h-[44px] min-w-[44px] text-amber-600 hover:text-amber-700 hover:bg-amber-50 p-2 flex items-center justify-center"
                          >
                            <PauseCircle size={16} />
                          </Button>
                        )}
                        {isSuspended && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onToggleSuspend(tenant)}
                            title="Reactivate"
                            className="min-h-[44px] min-w-[44px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 p-2 flex items-center justify-center"
                          >
                            <PlayCircle size={16} />
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onUpdateQuota(tenant)}
                          title="Adjust Quota"
                          className="min-h-[44px] min-w-[44px] p-2 flex items-center justify-center"
                        >
                          <Sliders size={16} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onManageAdmins(tenant)}
                          title="Manage Admins"
                          className="min-h-[44px] min-w-[44px] p-2 flex items-center justify-center"
                        >
                          <Users size={16} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onDeleteTenant(tenant)}
                          title="Delete Tenant"
                          className="min-h-[44px] min-w-[44px] text-red-500 hover:text-red-700 hover:bg-red-50 p-2 flex items-center justify-center"
                        >
                          <Trash2 size={16} />
                        </Button>
                      </div>

                      <button
                        type="button"
                        onClick={() => onViewDetails(tenant)}
                        className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 min-h-[44px] px-2 cursor-pointer border-none bg-transparent"
                      >
                        <span>Details</span>
                        <ChevronRight size={14} />
                      </button>
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
