import React, { useState, useMemo } from 'react';
import {
  History,
  Search,
  CheckCircle2,
  XCircle,
  RefreshCw,
  User,
  ChevronDown,
  ChevronRight,
  Shield,
  Code,
} from 'lucide-react';
import { AuditItem } from '../../types';

interface AuditLogViewProps {
  logs: AuditItem[];
  loading: boolean;
  onRefresh: () => void;
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({
  logs,
  loading,
  onRefresh,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | 'SUPER_ADMIN' | 'TENANT_ADMIN' | 'ANONYMOUS'>('ALL');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  // Role counts
  const superAdminCount = useMemo(() => logs.filter((l) => l.actor_role === 'SUPER_ADMIN').length, [logs]);
  const tenantAdminCount = useMemo(() => logs.filter((l) => l.actor_role === 'TENANT_ADMIN').length, [logs]);
  const anonymousCount = useMemo(() => logs.filter((l) => !l.actor_role || l.actor_role === 'ANONYMOUS').length, [logs]);

  // Filtered logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Role filter
      if (roleFilter !== 'ALL') {
        if (roleFilter === 'ANONYMOUS' && log.actor_role && log.actor_role !== 'ANONYMOUS') {
          return false;
        }
        if (roleFilter !== 'ANONYMOUS' && log.actor_role !== roleFilter) {
          return false;
        }
      }

      // Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesAction = log.action?.toLowerCase().includes(query);
        const matchesResource = log.resource?.toLowerCase().includes(query);
        const matchesResourceId = log.resource_id?.toLowerCase().includes(query);
        const matchesActor = log.actor_id?.toLowerCase().includes(query);
        const matchesMeta = log.metadata ? JSON.stringify(log.metadata).toLowerCase().includes(query) : false;
        return matchesAction || matchesResource || matchesResourceId || matchesActor || matchesMeta;
      }

      return true;
    });
  }, [logs, roleFilter, searchQuery]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Top Filter Controls */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
      }}>
        {/* Role Pills */}
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
            onClick={() => setRoleFilter('ALL')}
            style={{
              background: roleFilter === 'ALL' ? 'var(--primary)' : 'transparent',
              color: roleFilter === 'ALL' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>All Roles</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: roleFilter === 'ALL' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {logs.length}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setRoleFilter('SUPER_ADMIN')}
            style={{
              background: roleFilter === 'SUPER_ADMIN' ? 'var(--primary)' : 'transparent',
              color: roleFilter === 'SUPER_ADMIN' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Shield size={13} />
            <span>Super Admin</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: roleFilter === 'SUPER_ADMIN' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {superAdminCount}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setRoleFilter('TENANT_ADMIN')}
            style={{
              background: roleFilter === 'TENANT_ADMIN' ? 'var(--primary)' : 'transparent',
              color: roleFilter === 'TENANT_ADMIN' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <User size={13} />
            <span>Tenant Admin</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: roleFilter === 'TENANT_ADMIN' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {tenantAdminCount}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setRoleFilter('ANONYMOUS')}
            style={{
              background: roleFilter === 'ANONYMOUS' ? 'var(--primary)' : 'transparent',
              color: roleFilter === 'ANONYMOUS' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>Public / System</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: roleFilter === 'ANONYMOUS' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {anonymousCount}
            </span>
          </button>
        </div>

        {/* Search & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative', width: '280px' }}>
            <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Search action, actor, resource..."
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
            title="Refresh audit logs"
            style={{ height: '36px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && logs.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-dim)' }}>
            Loading platform audit logs...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <History size={36} color="var(--text-dim)" style={{ margin: '0 auto 12px auto', opacity: 0.6 }} />
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
              No Audit Records Found
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', maxWidth: '400px', margin: '0 auto' }}>
              No administrative events match the selected filters or search terms.
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: '40px' }}></th>
                  <th style={{ minWidth: '150px' }}>Timestamp</th>
                  <th style={{ minWidth: '180px' }}>Action</th>
                  <th style={{ minWidth: '180px' }}>Actor & Role</th>
                  <th style={{ minWidth: '160px' }}>Resource</th>
                  <th style={{ minWidth: '100px' }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const hasMeta = log.metadata && Object.keys(log.metadata).length > 0;

                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        onClick={() => hasMeta && setExpandedLogId(isExpanded ? null : log.id)}
                        style={{ cursor: hasMeta ? 'pointer' : 'default' }}
                      >
                        {/* Expand toggle */}
                        <td style={{ textAlign: 'center', padding: '12px 8px' }}>
                          {hasMeta ? (
                            isExpanded ? (
                              <ChevronDown size={15} color="var(--primary-light)" />
                            ) : (
                              <ChevronRight size={15} color="var(--text-dim)" />
                            )
                          ) : null}
                        </td>

                        {/* Timestamp */}
                        <td>
                          <div style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
                            {new Date(log.timestamp).toLocaleDateString()}
                          </div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </div>
                        </td>

                        {/* Action */}
                        <td>
                          <span style={{
                            fontFamily: 'monospace',
                            fontSize: '0.82rem',
                            fontWeight: 600,
                            color: 'var(--text-main)',
                            padding: '3px 8px',
                            background: 'var(--bg-input)',
                            borderRadius: '4px',
                            border: '1px solid var(--border)',
                          }}>
                            {log.action}
                          </span>
                        </td>

                        {/* Actor & Role */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontSize: '0.84rem', color: 'var(--text-main)' }}>
                              {log.actor_id || 'System / Anonymous'}
                            </span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                              {log.actor_role || 'SYSTEM'}
                              {log.tenant_id ? ` &bull; Tenant: ${log.tenant_id.slice(-6)}` : ''}
                            </span>
                          </div>
                        </td>

                        {/* Resource */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <span style={{ fontSize: '0.82rem', color: 'var(--text-main)', fontWeight: 500 }}>
                              {log.resource}
                            </span>
                            {log.resource_id && (
                              <code style={{ fontSize: '0.72rem', color: 'var(--primary-light)' }}>
                                ID: {log.resource_id}
                              </code>
                            )}
                          </div>
                        </td>

                        {/* Result */}
                        <td>
                          {log.success ? (
                            <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <CheckCircle2 size={11} /> Success
                            </span>
                          ) : (
                            <span className="badge badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                              <XCircle size={11} /> Failed
                            </span>
                          )}
                        </td>
                      </tr>

                      {/* Expandable JSON Metadata Row */}
                      {isExpanded && (
                        <tr>
                          <td colSpan={6} style={{ background: 'rgba(15, 23, 42, 0.5)', padding: '16px 20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
                              <Code size={14} color="var(--primary-light)" />
                              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                                Event Payload & Context Metadata:
                              </span>
                            </div>
                            <pre style={{
                              margin: 0,
                              padding: '12px 14px',
                              borderRadius: '6px',
                              background: '#090d16',
                              border: '1px solid var(--border)',
                              fontSize: '0.76rem',
                              fontFamily: 'monospace',
                              color: '#93c5fd',
                              overflowX: 'auto',
                              maxHeight: '240px',
                            }}>
                              {JSON.stringify(log.metadata, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
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
