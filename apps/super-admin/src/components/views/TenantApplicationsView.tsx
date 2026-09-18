import React, { useState, useMemo } from 'react';
import {
  ClipboardList,
  Search,
  XCircle,
  Clock,
  Globe,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';
import { RegistrationApplication } from '../../types';
import { Button } from '../ui/Button';
import { StatusBadge } from '../ui/StatusBadge';

interface TenantApplicationsViewProps {
  applications: RegistrationApplication[];
  loading: boolean;
  onRefresh: () => void;
  onReviewApplication: (app: RegistrationApplication) => void;
}

export const TenantApplicationsView: React.FC<TenantApplicationsViewProps> = ({
  applications,
  loading,
  onRefresh,
  onReviewApplication,
}) => {
  const [filterStatus, setFilterStatus] = useState<'PENDING_REVIEW' | 'REJECTED'>('PENDING_REVIEW');
  const [searchQuery, setSearchQuery] = useState('');

  // Tab counts
  const pendingCount = useMemo(() => applications.filter((a) => a.status === 'PENDING_REVIEW').length, [applications]);
  const rejectedCount = useMemo(() => applications.filter((a) => a.status === 'REJECTED').length, [applications]);

  // Filtered applications
  const filteredApps = useMemo(() => {
    return applications.filter((app) => {
      if (app.status !== filterStatus) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesName = app.companyName?.toLowerCase().includes(query);
        const matchesDomain = app.requestedDomain?.toLowerCase().includes(query);
        const matchesApplicant = app.applicantName?.toLowerCase().includes(query);
        const matchesEmail = app.contactEmail?.toLowerCase().includes(query);
        return matchesName || matchesDomain || matchesApplicant || matchesEmail;
      }
      return true;
    });
  }, [applications, filterStatus, searchQuery]);

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-6">
      {/* Top Header & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold text-slate-900">Domain Applications</h2>
          <p className="text-xs text-slate-500">
            Review, verify authoritative DNS credentials, and approve inbound organization domain requests
          </p>
        </div>
      </div>

      {/* Top Filter Bar & Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Status Filter Segmented Control */}
        <div className="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
          <button
            type="button"
            onClick={() => setFilterStatus('PENDING_REVIEW')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              filterStatus === 'PENDING_REVIEW'
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
            onClick={() => setFilterStatus('REJECTED')}
            className={`px-3 py-1.5 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
              filterStatus === 'REJECTED'
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
        </div>

        {/* Right Controls: Search & Refresh */}
        <div className="flex items-center gap-2.5">
          <div className="relative w-64">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search company, domain, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="form-input pl-9 h-9 text-xs"
            />
          </div>

          <Button
            size="sm"
            variant="secondary"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh application queue"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </Button>
        </div>
      </div>

      {/* Data Table Container */}
      <div className="data-table-container">
        {loading && applications.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            Loading domain applications...
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="p-12 text-center">
            <ClipboardList size={36} className="mx-auto mb-3 text-slate-300" />
            <div className="text-sm font-semibold text-slate-800 mb-1">
              {filterStatus === 'PENDING_REVIEW'
                ? 'No Applications Pending Review'
                : 'No Rejected Applications'}
            </div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {filterStatus === 'PENDING_REVIEW'
                ? 'All domain registration requests have been reviewed and processed.'
                : 'No domain registration applications have been rejected.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Organization & Domain</th>
                  <th>Applicant</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredApps.map((app) => {
                  const isPending = app.status === 'PENDING_REVIEW';
                  return (
                    <tr key={app._id || app.id}>
                      {/* Organization & Domain */}
                      <td>
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900 text-xs">
                            {app.companyName}
                          </span>
                          <div className="flex items-center gap-1 text-[11px] text-indigo-600 font-medium mt-0.5">
                            <Globe size={11} className="text-slate-400" />
                            <span>{app.requestedDomain}</span>
                          </div>
                        </div>
                      </td>

                      {/* Applicant Contact */}
                      <td>
                        <div className="flex flex-col text-xs">
                          <span className="font-medium text-slate-900">
                            {app.applicantName}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {app.contactEmail}
                          </span>
                          {app.phone && (
                            <span className="text-[10px] text-slate-400">
                              Tel: {app.phone}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Submitted Date */}
                      <td>
                        <div className="text-xs text-slate-800">
                          {new Date(app.createdAt).toLocaleDateString()}
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {new Date(app.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      {/* Status */}
                      <td>
                        {app.status === 'PENDING_REVIEW' && (
                          <StatusBadge status="warning">Pending Review</StatusBadge>
                        )}
                        {app.status === 'APPROVED' && (
                          <StatusBadge status="success">Approved</StatusBadge>
                        )}
                        {app.status === 'REJECTED' && (
                          <StatusBadge status="danger">Rejected</StatusBadge>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <Button
                          size="sm"
                          variant={isPending ? 'primary' : 'secondary'}
                          onClick={() => onReviewApplication(app)}
                        >
                          <span>{isPending ? 'Review Application' : 'View Details'}</span>
                          <ChevronRight size={13} />
                        </Button>
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
