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
    <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-900">Tenant Directory</h2>
          <p className="text-xs text-slate-500">
            Review, provision, and administer organization tenants across the cluster
          </p>
        </div>
        <Button
          size="sm"
          variant="primary"
          onClick={onCreateTenant}
          icon={<Plus className="w-4 h-4" />}
        >
          Provision Tenant
        </Button>
      </div>

      {/* Top Filter Bar & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Status Filters Segmented Control */}
        <div className="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
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
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
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
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
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
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
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
        <div className="flex items-center gap-2.5">
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search organization or domain..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
            />
          </div>

          <Button
            size="sm"
            variant="secondary"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh tenant directory"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
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
          <div className="overflow-x-auto">
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
                    <tr key={tenant.id}>
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
                              ID: {tenant.id.slice(-8)} · {tenant.adminCount || 0} admin{(tenant.adminCount || 0) !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Domain */}
                      <td>
                        {tenant.domains && tenant.domains.length > 0 ? (
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium">
                              <Globe size={13} className="text-slate-400" />
                              <span>{tenant.domain?.domainName || tenant.domains[0].domainName}</span>
                            </div>
                            {tenant.domains.length > 1 && (
                              <div className="flex items-center gap-1 text-[11px] text-slate-500">
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px] font-semibold">
                                  +{tenant.domains.length - 1} more
                                </span>
                                <span
                                  className="text-slate-400 truncate max-w-[150px]"
                                  title={tenant.domains.slice(1).map((d) => d.domainName).join(', ')}
                                >
                                  {tenant.domains.slice(1).map((d) => d.domainName).join(', ')}
                                </span>
                              </div>
                            )}
                          </div>
                        ) : tenant.domain ? (
                          <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium">
                            <Globe size={13} className="text-slate-400" />
                            <span>{tenant.domain.domainName}</span>
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
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => onViewDetails(tenant)}
                            title="Inspect Tenant Details"
                          >
                            Details
                          </Button>

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

                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => onDeleteTenant(tenant)}
                            title="Delete Tenant"
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
};
