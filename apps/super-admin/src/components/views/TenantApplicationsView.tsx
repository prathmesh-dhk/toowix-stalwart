import React, { useState, useMemo } from 'react';
import {
  ClipboardList,
  Search,
  XCircle,
  Clock,
  Globe,
  ChevronRight,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { RegistrationApplication } from '../../types';

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
  const [filterStatus, setFilterStatus] = useState<'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'>('PENDING_REVIEW');
  const [searchQuery, setSearchQuery] = useState('');

  // Tab counts
  const pendingCount = useMemo(() => applications.filter((a) => a.status === 'PENDING_REVIEW').length, [applications]);
  const approvedCount = useMemo(() => applications.filter((a) => a.status === 'APPROVED').length, [applications]);
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
    <div className="bg-white border border-slate-200/80 rounded-3xl p-7 sm:p-9 shadow-xs flex flex-col gap-6">
      {/* Title & Subtitle */}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl sm:text-[28px] font-bold text-slate-900 tracking-tight">
          Domain Applications
        </h1>
        <p className="text-slate-500 text-sm font-normal">
          Review and approve inbound domain requests. Verify DNS credentials and organization details.
        </p>
      </div>

      {/* Filter Pills & Controls Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Status Filter Segmented Control */}
        <div className="inline-flex items-center bg-slate-100/70 p-1.5 rounded-2xl border border-slate-200/60 gap-1.5 self-start">
          <button
            type="button"
            onClick={() => setFilterStatus('PENDING_REVIEW')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              filterStatus === 'PENDING_REVIEW'
                ? 'bg-white text-indigo-700 shadow-xs border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/40'
            }`}
          >
            <Clock className={`w-4 h-4 ${filterStatus === 'PENDING_REVIEW' ? 'text-indigo-600' : 'text-slate-500'}`} />
            <span>Pending Review</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                filterStatus === 'PENDING_REVIEW'
                  ? 'bg-indigo-100/90 text-indigo-700'
                  : 'bg-slate-200/80 text-slate-600'
              }`}
            >
              {pendingCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('APPROVED')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              filterStatus === 'APPROVED'
                ? 'bg-white text-emerald-700 shadow-xs border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/40'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>Approved</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                filterStatus === 'APPROVED'
                  ? 'bg-emerald-100/90 text-emerald-700'
                  : 'bg-emerald-100/60 text-emerald-700'
              }`}
            >
              {approvedCount}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setFilterStatus('REJECTED')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
              filterStatus === 'REJECTED'
                ? 'bg-white text-slate-800 shadow-xs border border-slate-200/60'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/40'
            }`}
          >
            <XCircle className="w-4 h-4 text-slate-400" />
            <span>Rejected</span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                filterStatus === 'REJECTED'
                  ? 'bg-slate-200/90 text-slate-700'
                  : 'bg-slate-200/60 text-slate-600'
              }`}
            >
              {rejectedCount}
            </span>
          </button>
        </div>

        {/* Right Controls: Search & Refresh */}
        <div className="flex items-center gap-2.5">
          <div className="relative w-full sm:w-72 md:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search company, domain, email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-slate-200 rounded-xl focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none transition-all placeholder:text-slate-400 text-slate-800 shadow-2xs"
            />
          </div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="px-4 py-2 bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-2 transition-all cursor-pointer shadow-2xs shrink-0 disabled:opacity-50"
            title="Refresh application queue"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-600 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Applications Table Card */}
      <div className="border border-slate-200/80 rounded-2xl overflow-hidden bg-white shadow-xs">
        {loading && applications.length === 0 ? (
          <div className="p-16 text-center flex flex-col items-center justify-center gap-3 text-slate-400 text-xs font-medium">
            <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
            <span>Loading domain applications...</span>
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="p-16 text-center flex flex-col items-center justify-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
              <ClipboardList className="w-6 h-6 stroke-[1.8]" />
            </div>
            <h3 className="text-base font-bold text-slate-900 mb-1">
              {filterStatus === 'PENDING_REVIEW'
                ? 'No Applications Pending Review'
                : filterStatus === 'APPROVED'
                ? 'No Approved Applications'
                : 'No Rejected Applications'}
            </h3>
            <p className="text-xs text-slate-500 max-w-sm">
              {filterStatus === 'PENDING_REVIEW'
                ? 'All inbound domain requests have been reviewed and processed.'
                : filterStatus === 'APPROVED'
                ? 'No domain applications have been approved yet.'
                : 'No domain registration applications have been rejected.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/60 border-b border-slate-100">
                  <th className="px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                    Domain
                  </th>
                  <th className="px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                    Applicant
                  </th>
                  <th className="px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-400">
                    Submitted
                  </th>
                  <th className="px-6 py-3.5 text-xs font-bold uppercase tracking-wider text-slate-400 text-center">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredApps.map((app) => {
                  return (
                    <tr
                      key={app._id || app.id}
                      className="hover:bg-slate-50/60 transition-colors"
                    >
                      {/* Domain Column */}
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3.5">
                          <div className="w-10 h-10 rounded-xl bg-indigo-50/80 border border-indigo-100/60 text-indigo-600 flex items-center justify-center shrink-0">
                            <Globe className="w-5 h-5 stroke-[1.8]" />
                          </div>
                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 text-sm truncate">
                                {app.requestedDomain}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5 font-normal">
                              <Globe className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="truncate">{app.companyName || app.requestedDomain}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Applicant Column */}
                      <td className="px-6 py-4">
                        <span className="text-sm font-medium text-slate-700 truncate block">
                          {app.contactEmail}
                        </span>
                      </td>

                      {/* Submitted Date & Time Column */}
                      <td className="px-6 py-4">
                        <div className="flex flex-col text-xs">
                          <span className="font-semibold text-slate-700">
                            {new Date(app.createdAt || app.submittedAt || Date.now()).toLocaleDateString('en-US')}
                          </span>
                          <span className="text-[11px] text-slate-400 mt-0.5">
                            {new Date(app.createdAt || app.submittedAt || Date.now()).toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true,
                            })}
                          </span>
                        </div>
                      </td>

                      {/* Actions Column */}
                      <td className="px-6 py-4 text-center">
                        <button
                          type="button"
                          onClick={() => onReviewApplication(app)}
                          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          <span>Review Application</span>
                          <ChevronRight className="w-4 h-4 stroke-[2.3]" />
                        </button>
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
