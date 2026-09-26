import React, { useState, useMemo } from 'react';
import {
  History,
  Search,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Shield,
  Code,
} from 'lucide-react';
import { AuditItem } from '../../types';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';

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
      if (roleFilter !== 'ALL') {
        if (roleFilter === 'ANONYMOUS' && log.actor_role && log.actor_role !== 'ANONYMOUS') {
          return false;
        }
        if (roleFilter !== 'ANONYMOUS' && log.actor_role !== roleFilter) {
          return false;
        }
      }

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
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 shadow-xs flex flex-col gap-4 sm:gap-6">
      {/* Top Header & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-900">Platform Audit Trail</h2>
          <p className="text-xs text-slate-500">
            Immutable cluster-wide log of security events, administrative changes, and tenant provisioning actions
          </p>
        </div>
      </div>

      {/* Top Filter Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Role Filter Segmented Control */}
        <div className="flex overflow-x-auto no-scrollbar bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs gap-1 sm:gap-0 max-w-full">
          <button
            type="button"
            onClick={() => setRoleFilter('ALL')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
              roleFilter === 'ALL'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>All Roles</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-semibold">
              {logs.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setRoleFilter('SUPER_ADMIN')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
              roleFilter === 'SUPER_ADMIN'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Shield size={13} />
            <span>Super Admin</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-100 text-indigo-800 font-semibold">
              {superAdminCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setRoleFilter('TENANT_ADMIN')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
              roleFilter === 'TENANT_ADMIN'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Tenant Admin</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200/60 font-semibold">
              {tenantAdminCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setRoleFilter('ANONYMOUS')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 shrink-0 ${
              roleFilter === 'ANONYMOUS'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>Public / System</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-semibold">
              {anonymousCount}
            </span>
          </button>
        </div>

        {/* Search & Refresh */}
        <div className="flex items-center gap-2.5 w-full lg:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search action, actor, resource..."
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
            title="Refresh audit logs"
            className="shrink-0 min-h-[44px] sm:min-h-0 px-3"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="data-table-container">
        {loading && logs.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            Loading platform audit logs...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center">
            <History size={36} className="mx-auto mb-3 text-slate-300" />
            <div className="text-sm font-semibold text-slate-800 mb-1">
              No Audit Records Found
            </div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              No administrative events match the selected filters or search terms.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table View (>= 768px) */}
            <div className="hidden md:block overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th style={{ width: '32px' }}></th>
                    <th>Timestamp</th>
                    <th>Action</th>
                    <th>Actor & Role</th>
                    <th>Resource</th>
                    <th>Result</th>
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
                          className={hasMeta ? 'cursor-pointer hover:bg-slate-50/80' : ''}
                        >
                          {/* Expand toggle */}
                          <td className="text-center">
                            {hasMeta && (
                              isExpanded ? (
                                <ChevronDown size={14} className="text-indigo-600 inline-block" />
                              ) : (
                                <ChevronRight size={14} className="text-slate-400 inline-block" />
                              )
                            )}
                          </td>

                          {/* Timestamp */}
                          <td>
                            <div className="text-xs text-slate-800">
                              {new Date(log.timestamp).toLocaleDateString()}
                            </div>
                            <div className="text-[11px] text-slate-400 tabular-nums">
                              {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                          </td>

                          {/* Action */}
                          <td>
                            <span className="font-semibold text-xs text-slate-900">
                              {log.action}
                            </span>
                          </td>

                          {/* Actor & Role */}
                          <td>
                            <div className="flex flex-col text-xs">
                              <span className="text-slate-800 text-[11px]">
                                {log.actor_id || 'system'}
                              </span>
                              <span className="text-[10px] text-slate-400 uppercase font-medium">
                                {log.actor_role || 'ANONYMOUS'}
                              </span>
                            </div>
                          </td>

                          {/* Resource */}
                          <td>
                            <div className="flex flex-col text-xs">
                              <span className="text-indigo-600 font-medium text-[11px]">
                                {log.resource || '—'}
                              </span>
                              {log.resource_id && (
                                <span className="text-[10px] text-slate-400">
                                  ID: {log.resource_id.slice(-8)}
                                </span>
                              )}
                            </div>
                          </td>

                          {/* Result */}
                          <td>
                            <StatusBadge status="success">SUCCESS</StatusBadge>
                          </td>
                        </tr>

                        {/* Expanded Metadata Row */}
                        {isExpanded && hasMeta && (
                          <tr>
                            <td colSpan={6} className="bg-slate-50 p-4 border-b border-slate-200">
                              <div className="space-y-2">
                                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                                  <Code size={13} className="text-indigo-600" />
                                  <span>Event Payload & Metadata (ID: {log.id})</span>
                                </div>
                                <pre className="p-3 bg-white border border-slate-200 rounded-md text-[11px] font-mono text-slate-800 overflow-x-auto">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Cards View (< 768px) */}
            <div className="md:hidden space-y-3 p-1">
              {filteredLogs.map((log) => {
                const isExpanded = expandedLogId === log.id;
                const hasMeta = log.metadata && Object.keys(log.metadata).length > 0;

                return (
                  <div
                    key={log.id}
                    className="p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 shadow-xs transition-all space-y-2.5"
                  >
                    {/* Header: Action name and Result StatusBadge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-slate-900 text-sm">
                        {log.action}
                      </div>
                      <StatusBadge status="success">SUCCESS</StatusBadge>
                    </div>

                    {/* Actor, Role and Timestamp */}
                    <div className="flex flex-wrap items-center justify-between text-xs gap-1.5 pt-1 border-t border-slate-100">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-slate-700 font-medium text-[11px] truncate">
                          {log.actor_id || 'system'}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 uppercase font-semibold">
                          {log.actor_role || 'ANONYMOUS'}
                        </span>
                      </div>
                      <span className="text-slate-400 text-[11px] tabular-nums">
                        {new Date(log.timestamp).toLocaleDateString()} {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>

                    {/* Resource details */}
                    <div className="flex items-center justify-between text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                      <span className="text-slate-500 text-[11px]">Resource:</span>
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="text-indigo-600 font-semibold text-xs truncate">
                          {log.resource || '—'}
                        </span>
                        {log.resource_id && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            ({log.resource_id.slice(-8)})
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metadata Toggle if available */}
                    {hasMeta && (
                      <div>
                        <button
                          type="button"
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                          className="w-full flex items-center justify-between text-xs text-indigo-600 hover:text-indigo-800 font-medium py-2 px-1 cursor-pointer border-none bg-transparent min-h-[44px]"
                        >
                          <span className="flex items-center gap-1.5">
                            <Code size={13} />
                            <span>{isExpanded ? 'Hide Payload' : 'View Payload & Metadata'}</span>
                          </span>
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>

                        {isExpanded && (
                          <pre className="mt-1.5 p-3 bg-slate-900 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto max-h-60">
                            {JSON.stringify(log.metadata, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
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
