import React, { useState, useMemo } from 'react';
import {
  ClipboardList,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Globe,
  ChevronRight,
  RefreshCw,
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
  const [filterStatus, setFilterStatus] = useState<'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING_REVIEW');
  const [searchQuery, setSearchQuery] = useState('');

  // Tab counts
  const pendingCount = useMemo(() => applications.filter((a) => a.status === 'PENDING_REVIEW').length, [applications]);
  const approvedCount = useMemo(() => applications.filter((a) => a.status === 'APPROVED').length, [applications]);
  const rejectedCount = useMemo(() => applications.filter((a) => a.status === 'REJECTED').length, [applications]);
  const allCount = applications.length;

  // Filtered applications
  const filteredApps = useMemo(() => {
    return applications.filter((app) => {
      // Filter by status tab
      if (filterStatus !== 'ALL' && app.status !== filterStatus) {
        return false;
      }
      // Filter by search query
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header controls: Search & Status Filters */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '16px',
      }}>
        {/* Status Filter Pills */}
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
            onClick={() => setFilterStatus('PENDING_REVIEW')}
            style={{
              background: filterStatus === 'PENDING_REVIEW' ? 'var(--primary)' : 'transparent',
              color: filterStatus === 'PENDING_REVIEW' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <Clock size={13} />
            <span>Pending Review</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: filterStatus === 'PENDING_REVIEW' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {pendingCount}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setFilterStatus('APPROVED')}
            style={{
              background: filterStatus === 'APPROVED' ? 'var(--primary)' : 'transparent',
              color: filterStatus === 'APPROVED' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <CheckCircle2 size={13} />
            <span>Approved</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: filterStatus === 'APPROVED' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {approvedCount}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setFilterStatus('REJECTED')}
            style={{
              background: filterStatus === 'REJECTED' ? 'var(--primary)' : 'transparent',
              color: filterStatus === 'REJECTED' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <XCircle size={13} />
            <span>Rejected</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: filterStatus === 'REJECTED' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {rejectedCount}
            </span>
          </button>

          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setFilterStatus('ALL')}
            style={{
              background: filterStatus === 'ALL' ? 'var(--primary)' : 'transparent',
              color: filterStatus === 'ALL' ? '#fff' : 'var(--text-dim)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>All Submissions</span>
            <span style={{
              fontSize: '0.72rem',
              padding: '1px 6px',
              borderRadius: '999px',
              background: filterStatus === 'ALL' ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.06)',
            }}>
              {allCount}
            </span>
          </button>
        </div>

        {/* Search input and refresh action */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ position: 'relative', width: '280px' }}>
            <Search size={15} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-dim)' }} />
            <input
              type="text"
              className="form-input"
              placeholder="Search company, domain, email..."
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
            title="Refresh application queue"
            style={{ height: '36px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Applications Table Card */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading && applications.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-dim)' }}>
            Loading applications queue...
          </div>
        ) : filteredApps.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center' }}>
            <ClipboardList size={36} color="var(--text-dim)" style={{ margin: '0 auto 12px auto', opacity: 0.6 }} />
            <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '4px' }}>
              {filterStatus === 'PENDING_REVIEW'
                ? 'No Applications Pending Review'
                : 'No Applications Match the Current Criteria'}
            </div>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-dim)', maxWidth: '400px', margin: '0 auto' }}>
              {filterStatus === 'PENDING_REVIEW'
                ? 'All tenant registration requests have been reviewed and processed.'
                : 'Try adjusting your search query or selecting a different status filter above.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="custom-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ minWidth: '220px' }}>Organization & Domain</th>
                  <th style={{ minWidth: '200px' }}>Applicant</th>
                  <th style={{ minWidth: '130px' }}>Submitted</th>
                  <th style={{ minWidth: '130px' }}>Status</th>
                  <th style={{ minWidth: '140px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredApps.map((app) => {
                  const isPending = app.status === 'PENDING_REVIEW';
                  const isApproved = app.status === 'APPROVED';
                  const isRejected = app.status === 'REJECTED';

                  return (
                    <tr key={app._id}>
                      {/* Organization & Domain */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.92rem' }}>
                            {app.companyName}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Globe size={13} color="var(--primary-light)" />
                            <code style={{ fontSize: '0.8rem', color: 'var(--primary-light)' }}>
                              {app.requestedDomain}
                            </code>
                          </div>
                        </div>
                      </td>

                      {/* Applicant Contact */}
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          <span style={{ fontSize: '0.86rem', color: 'var(--text-main)', fontWeight: 500 }}>
                            {app.applicantName}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                            {app.contactEmail}
                          </span>
                          {app.phone && (
                            <span style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                              Tel: {app.phone}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Submitted Date */}
                      <td>
                        <div style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>
                          {new Date(app.createdAt).toLocaleDateString()}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                          {new Date(app.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </td>

                      {/* Status */}
                      <td>
                        {isPending && (
                          <span className="badge badge-amber" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <Clock size={11} /> Pending Review
                          </span>
                        )}
                        {isApproved && (
                          <span className="badge badge-green" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <CheckCircle2 size={11} /> Approved
                          </span>
                        )}
                        {isRejected && (
                          <span className="badge badge-red" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                            <XCircle size={11} /> Rejected
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className={isPending ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                          onClick={() => onReviewApplication(app)}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                        >
                          <span>{isPending ? 'Review Application' : 'View Details'}</span>
                          <ChevronRight size={14} />
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
