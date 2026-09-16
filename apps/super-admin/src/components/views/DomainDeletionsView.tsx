import React, { useState, useMemo } from 'react';
import {
  Trash2,
  Search,
  Clock,
  CheckCircle2,
  XCircle,
  Globe,
  Building2,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';
import { DomainDeletionRequest, DomainDeletionStatus } from '../../types';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';

interface DomainDeletionsViewProps {
  requests: DomainDeletionRequest[];
  loading: boolean;
  onRefresh: () => void;
  onReviewRequest: (request: DomainDeletionRequest) => void;
}

export const DomainDeletionsView: React.FC<DomainDeletionsViewProps> = ({
  requests,
  loading,
  onRefresh,
  onReviewRequest,
}) => {
  const [filterStatus, setFilterStatus] = useState<DomainDeletionStatus | 'all'>('pending');
  const [searchQuery, setSearchQuery] = useState('');

  // Tab counts
  const pendingCount = useMemo(() => requests.filter((r) => r.status === 'pending').length, [requests]);
  const approvedCount = useMemo(() => requests.filter((r) => r.status === 'approved').length, [requests]);
  const rejectedCount = useMemo(() => requests.filter((r) => r.status === 'rejected').length, [requests]);

  // Filtered requests
  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      if (filterStatus !== 'all' && req.status !== filterStatus) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesDomain = req.domainName?.toLowerCase().includes(query);
        const matchesTenant = req.tenantName?.toLowerCase().includes(query) || req.tenantId?.toLowerCase().includes(query);
        const matchesRequester = req.requestedBy?.email?.toLowerCase().includes(query);
        const matchesReason = req.reason?.toLowerCase().includes(query);
        return matchesDomain || matchesTenant || matchesRequester || matchesReason;
      }
      return true;
    });
  }, [requests, filterStatus, searchQuery]);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-6">
      {/* Top Header & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-rose-600" />
            <h2 className="text-lg font-semibold text-slate-900">Domain Deletion Requests</h2>
          </div>
          <p className="text-xs text-slate-500">
            Review and execute permanent cascading removal for tenant domains with zero active mailboxes.
          </p>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 self-start sm:self-auto"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </Button>
      </div>

      {/* Top Filter Bar & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Status Filter Segmented Control */}
        <div className="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => setFilterStatus('pending')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              filterStatus === 'pending'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Clock size={13} />
            <span>Pending Review</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 font-semibold">
              {pendingCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('approved')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              filterStatus === 'approved'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <CheckCircle2 size={13} />
            <span>Approved</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-emerald-100 text-emerald-800 font-semibold">
              {approvedCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('rejected')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              filterStatus === 'rejected'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <XCircle size={13} />
            <span>Rejected</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-semibold">
              {rejectedCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 cursor-pointer ${
              filterStatus === 'all'
                ? 'bg-white text-indigo-600 font-semibold shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <span>All</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700 font-semibold">
              {requests.length}
            </span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search domain, tenant, requester…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
          />
        </div>
      </div>

      {/* Requests Table */}
      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4">Domain</th>
                <th className="py-3 px-4">Organization</th>
                <th className="py-3 px-4">Requested By</th>
                <th className="py-3 px-4">Submitted At</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading && requests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
                    <span>Loading deletion requests…</span>
                  </td>
                </tr>
              ) : filteredRequests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-500">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 mx-auto mb-2">
                      <Trash2 size={20} />
                    </div>
                    <p className="font-semibold text-slate-700">No deletion requests found</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {searchQuery ? 'No results matched your search criteria.' : 'There are no deletion requests in this view.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredRequests.map((req) => (
                  <tr
                    key={req.id}
                    className="hover:bg-slate-50/60 transition-colors group cursor-pointer"
                    onClick={() => onReviewRequest(req)}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <Globe size={14} className="text-indigo-500 shrink-0" />
                        <span className="font-mono font-semibold text-slate-900">{req.domainName}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <Building2 size={13} className="text-slate-400 shrink-0" />
                        <span>{req.tenantName || req.tenantId}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">
                      {req.requestedBy?.email || 'Tenant Admin'}
                    </td>
                    <td className="py-3 px-4 text-slate-500">
                      {new Date(req.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-4">
                      {req.status === 'pending' && <StatusBadge status="warning">Pending</StatusBadge>}
                      {req.status === 'approved' && <StatusBadge status="success">Approved</StatusBadge>}
                      {req.status === 'rejected' && <StatusBadge status="danger">Rejected</StatusBadge>}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onReviewRequest(req);
                        }}
                        className="flex items-center gap-1 group-hover:border-slate-300"
                      >
                        <span>Review</span>
                        <ChevronRight size={13} className="text-slate-400" />
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
