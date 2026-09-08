import React, { useState, useMemo } from 'react';
import {
  Building2,
  Globe,
  Plus,
  Search,
  CheckCircle2,
  AlertTriangle,
  PauseCircle,
  PlayCircle,
  Sliders,
  Users,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { TenantSummary } from '../../types';

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
        const matchesDomain = tenant.domain?.domainName?.toLowerCase().includes(query);
        return matchesName || matchesDomain;
      }
      return true;
    });
  }, [tenants, filterStatus, searchQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Controls: Filter Pills, Search Bar, Provision Action */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
      }}>
        {/* Status Filters */}
        <div style={{
          display: 'flex',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md, 8px)',
          padding: '4px',
          gap: '4px',
        }}>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setFilterStatus('all')}
            style={{
              background: filterStatus === 'all' ? 'var(--primary)' : 'transparent',
              color: filterStatus === 'all' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>All Tenants</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: filterStatus === 'all' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {allCount}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setFilterStatus('active')}
            style={{
              background: filterStatus === 'active' ? 'var(--primary)' : 'transparent',
              color: filterStatus === 'active' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <CheckCircle2 size={13} />
            <span>Active</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: filterStatus === 'active' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {activeCount}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setFilterStatus('approved_pending_setup')}
            style={{
              background: filterStatus === 'approved_pending_setup' ? 'var(--primary)' : 'transparent',
              color: filterStatus === 'approved_pending_setup' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertTriangle size={13} />
            <span>Pending Setup</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: filterStatus === 'approved_pending_setup' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {pendingCount}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setFilterStatus('suspended')}
            style={{
              background: filterStatus === 'suspended' ? 'var(--primary)' : 'transparent',
              color: filterStatus === 'suspended' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <PauseCircle size={13} />
            <span>Suspended</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: filterStatus === 'suspended' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {suspendedCount}
            </span>
          </button>
        </div>

        {/* Right side: Search, Refresh, New Tenant CTA */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative', width: '260px' }}>
            <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Search organization or domain..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '36px', height: '36px', fontSize: '0.82rem' }}
            />
          </div>

          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh tenant directory"
            style={{ height: '36px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onCreateTenant}
            style={{ height: '36px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Plus size={15} />
            <span>Provision Tenant</span>
          </button>
        </div>
      </div>

      {/* Tenants Directory Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && tenants.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-dim)' }}>
            Loading tenant directory...
          </div>
        ) : filteredTenants.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <Building2 size={36} color="var(--text-dim)" style={{ margin: '0 auto 12px auto', opacity: 0.6 }} />
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
              {filterStatus === 'all' ? 'No Tenants Registered' : 'No Tenants Match the Current Criteria'}
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', maxWidth: '400px', margin: '0 auto' }}>
              {filterStatus === 'all'
                ? 'No organization tenants exist on the platform. Click "Provision Tenant" to create one.'
                : 'Try clearing the search query or selecting a different status filter above.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: '220px' }}>Organization</th>
                  <th style={{ minWidth: '180px' }}>Domain</th>
                  <th style={{ minWidth: '140px' }}>Status</th>
                  <th style={{ minWidth: '180px' }}>Mailbox Allocation</th>
                  <th style={{ minWidth: '110px' }}>Created</th>
                  <th style={{ minWidth: '280px', textAlign: 'right' }}>Actions</th>
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <div style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '6px',
                            background: 'rgba(56, 189, 248, 0.1)',
                            color: 'var(--primary-light)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}>
                            <Building2 size={16} />
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.92rem' }}>
                              {tenant.name}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                              ID: {tenant.id.slice(-8)} &bull; {tenant.adminCount || 0} admin{(tenant.adminCount || 0) !== 1 ? 's' : ''}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Domain */}
                      <td>
                        {tenant.domain ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <Globe size={13} color="var(--primary-light)" />
                              <code style={{ fontSize: '0.82rem', color: 'var(--primary-light)' }}>
                                {tenant.domain.domainName}
                              </code>
                            </div>
                            <span style={{ fontSize: '0.72rem', color: tenant.domain.stalwartDomainId ? 'var(--success)' : 'var(--warning)' }}>
                              {tenant.domain.stalwartDomainId ? 'Stalwart Synced' : 'Pending Stalwart Sync'}
                            </span>
                          </div>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>No domain configured</span>
                        )}
                      </td>

                      {/* Status */}
                      <td>
                        {isActive && (
                          <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <CheckCircle2 size={11} /> Active
                          </span>
                        )}
                        {isPending && (
                          <span className="badge badge-amber" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <AlertTriangle size={11} /> Pending Setup
                          </span>
                        )}
                        {isSuspended && (
                          <span className="badge badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <PauseCircle size={11} /> Suspended
                          </span>
                        )}
                      </td>

                      {/* Mailbox Allocation Meter */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                            <span style={{ color: 'var(--text-main)', fontWeight: 600 }}>
                              {tenant.mailboxCount || 0} / {tenant.mailboxLimit}
                            </span>
                            <span style={{ color: 'var(--text-dim)' }}>{usagePct}%</span>
                          </div>
                          <div style={{ background: 'var(--bg-input)', height: '5px', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{
                              width: `${Math.min(usagePct, 100)}%`,
                              height: '100%',
                              background: usagePct > 85 ? 'var(--danger)' : 'var(--primary)',
                            }} />
                          </div>
                        </div>
                      </td>

                      {/* Created Date */}
                      <td>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-main)' }}>
                          {new Date(tenant.createdAt).toLocaleDateString()}
                        </div>
                      </td>

                      {/* Contextual Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          {/* View Details CTA */}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onViewDetails(tenant)}
                            title="Inspect Tenant Details"
                            style={{ padding: '5px 10px' }}
                          >
                            Details
                          </button>

                          {/* Activate Button (if pending setup) */}
                          {isPending && (
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              onClick={() => onActivateTenant(tenant)}
                              title="Complete Tenant Activation"
                              style={{ padding: '5px 10px', background: 'linear-gradient(135deg, #10b981, #059669)' }}
                            >
                              Activate
                            </button>
                          )}

                          {/* Suspend / Reactivate */}
                          {isActive && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onToggleSuspend(tenant)}
                              title="Suspend Tenant Access"
                              style={{ padding: '5px 8px', color: '#fca5a5' }}
                            >
                              <PauseCircle size={14} />
                            </button>
                          )}

                          {isSuspended && (
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => onToggleSuspend(tenant)}
                              title="Reactivate Tenant Access"
                              style={{ padding: '5px 8px', color: '#86efac' }}
                            >
                              <PlayCircle size={14} />
                            </button>
                          )}

                          {/* Quota limit */}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onUpdateQuota(tenant)}
                            title="Adjust Mailbox Quota Limit"
                            style={{ padding: '5px 8px' }}
                          >
                            <Sliders size={14} />
                          </button>

                          {/* Manage Admins */}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onManageAdmins(tenant)}
                            title="Manage Tenant Administrators"
                            style={{ padding: '5px 8px' }}
                          >
                            <Users size={14} />
                          </button>

                          {/* Delete Tenant */}
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => onDeleteTenant(tenant)}
                            title="Permanently Delete Tenant"
                            style={{ padding: '5px 8px', color: '#f87171' }}
                          >
                            <Trash2 size={14} />
                          </button>
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
    </div>
  );
};
