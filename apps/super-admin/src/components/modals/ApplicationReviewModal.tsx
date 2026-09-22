import React, { useState, useEffect } from 'react';
import { RegistrationApplication, DomainDnsStatus, DnsLiveCheckResult } from '../../types';
import { api } from '../../api';
import { dnsStatusBadgeProps as badgeProps } from '../../utils/dnsStatus';
import {
  X,
  Building2,
  Globe,
  User,
  Mail,
  Phone,
  Calendar,
  Search,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  FileText,
  Download,
  PlayCircle,
} from 'lucide-react';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { StatusBadge } from '../ui/StatusBadge';

interface ApplicationReviewModalProps {
  application: RegistrationApplication | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (appId: string) => Promise<void>;
  onReject: (appId: string, reason: string) => Promise<void>;
  onChanged?: () => void;
}

export const ApplicationReviewModal: React.FC<ApplicationReviewModalProps> = ({
  application,
  isOpen,
  onClose,
  onApprove,
  onReject,
  onChanged,
}) => {
  const [appData, setAppData] = useState<RegistrationApplication | null>(application);
  const [dnsStatus, setDnsStatus] = useState<DomainDnsStatus | null>(null);
  const [liveCheck, setLiveCheck] = useState<DnsLiveCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'approve' | 'approve_activate' | 'activate' | 'retry' | 'reject' | null>(null);
  const [zoneFileCopied, setZoneFileCopied] = useState(false);
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Synchronize with prop changes & fetch fresh domain details
  useEffect(() => {
    if (!isOpen || !application) {
      setAppData(null);
      setDnsStatus(null);
      setLiveCheck(null);
      setError(null);
      setShowRejectInput(false);
      setRejectionReason('');
      return;
    }

    setAppData(application);
    setError(null);

    const initDnsDetails = async () => {
      let currentApp = application;
      if (typeof api.getRegistrationApplication === 'function') {
        try {
          const res = await api.getRegistrationApplication(application._id);
          if (res?.application) {
            currentApp = res.application;
            setAppData(res.application);
          }
        } catch {
          // Non-fatal, continue with application prop
        }
      }

      const tenantId = currentApp.tenantId || (currentApp.domain as any)?.tenantId;
      const domainId = currentApp.domainId || currentApp.domain?.id;

      if (tenantId && domainId) {
        setDnsLoading(true);
        try {
          if (typeof api.getDomainDnsStatus === 'function') {
            const statusRes = await api.getDomainDnsStatus(tenantId, domainId);
            setDnsStatus(statusRes);
          }
        } catch {
          // Non-fatal if domain DNS status not yet available
        } finally {
          setDnsLoading(false);
        }

        setChecking(true);
        try {
          if (typeof api.checkDomainDnsLive === 'function') {
            const checkRes = await api.checkDomainDnsLive(tenantId, domainId);
            setLiveCheck(checkRes);
          }
        } catch {
          // Non-fatal
        } finally {
          setChecking(false);
        }
      }
    };

    initDnsDetails();
  }, [isOpen, application?._id]);

  if (!isOpen || !appData) return null;

  const resolvedTenantId = appData.tenantId || (appData.domain as any)?.tenantId;
  const resolvedDomainId = appData.domainId || appData.domain?.id;

  const currentDnsStatus = dnsStatus?.dnsStatus || appData.domain?.dnsStatus || 'not_started';
  const badge = badgeProps(currentDnsStatus);
  const zoneFileText = dnsStatus?.dnsZoneFile || appData.domain?.dnsZoneFile || null;
  const recordsReady = liveCheck?.allFound === true;
  const canActivateDirectly = appData.status === 'APPROVED' && currentDnsStatus === 'not_started' && Boolean(resolvedTenantId && resolvedDomainId);
  const canRetry = Boolean(resolvedTenantId && resolvedDomainId) && (currentDnsStatus === 'activating' || currentDnsStatus === 'conflict' || currentDnsStatus === 'activation_failed');

  const checkRecords = async () => {
    if (!resolvedTenantId || !resolvedDomainId) return;
    setChecking(true);
    try {
      if (typeof api.checkDomainDnsLive === 'function') {
        const res = await api.checkDomainDnsLive(resolvedTenantId, resolvedDomainId);
        setLiveCheck(res);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to check DNS records.');
    } finally {
      setChecking(false);
    }
  };

  const handleCopyZoneFile = () => {
    if (!zoneFileText) return;
    navigator.clipboard.writeText(zoneFileText);
    setZoneFileCopied(true);
    setTimeout(() => setZoneFileCopied(false), 2000);
  };

  const handleExportZoneFile = () => {
    if (!zoneFileText) return;
    const blob = new Blob([zoneFileText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${appData.requestedDomain}-zone.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionReason.trim()) {
      setError('Please provide a reason for rejecting this application.');
      return;
    }
    setError(null);
    setActionLoading('reject');
    try {
      await onReject(appData._id, rejectionReason.trim());
      if (onChanged) onChanged();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to reject application');
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async () => {
    setError(null);
    setActionLoading('approve');
    try {
      await onApprove(appData._id);
      if (onChanged) onChanged();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to approve application');
    } finally {
      setActionLoading(null);
    }
  };

  const handleApproveAndActivate = async () => {
    setError(null);
    setActionLoading('approve_activate');
    try {
      await onApprove(appData._id);
      if (resolvedTenantId && resolvedDomainId && typeof api.activateDomainDns === 'function') {
        const actRes = await api.activateDomainDns(resolvedTenantId, resolvedDomainId);
        setDnsStatus(actRes);
      }
      if (onChanged) onChanged();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Approved application, but domain activation encountered an issue.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleActivate = async () => {
    if (!resolvedTenantId || !resolvedDomainId) return;
    setActionLoading('activate');
    setError(null);
    try {
      const res = await api.activateDomainDns(resolvedTenantId, resolvedDomainId);
      setDnsStatus(res);
      if (onChanged) onChanged();
    } catch (err: any) {
      setError(err.message || 'Domain activation failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetry = async () => {
    if (!resolvedTenantId || !resolvedDomainId) return;
    setActionLoading('retry');
    setError(null);
    try {
      const res = await api.retryVerifyDomainDns(resolvedTenantId, resolvedDomainId);
      setDnsStatus(res);
      if (onChanged) onChanged();
    } catch (err: any) {
      setError(err.message || 'Retry / verify failed.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="modal-backdrop-mock">
      <div className="modal-card max-w-2xl">
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Review Domain Application</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Reference ID: <span className="font-medium text-slate-700">#{appData._id.slice(-8).toUpperCase()}</span>
            </p>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body space-y-4 max-h-[75vh] overflow-y-auto">
          {error && (
            <Alert type="error" message={error} onClose={() => setError(null)} />
          )}

          {/* Status Row */}
          <div className="flex items-center justify-between p-3 rounded-md bg-slate-50 border border-slate-200">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-600">Application Status:</span>
              {appData.tenantId ? (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Existing Organisation
                </span>
              ) : (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                  New Registration
                </span>
              )}
            </div>
            {appData.status === 'PENDING_REVIEW' && (
              <StatusBadge status="warning">Pending Review</StatusBadge>
            )}
            {appData.status === 'APPROVED' && (
              <StatusBadge status="success">Approved</StatusBadge>
            )}
            {appData.status === 'REJECTED' && (
              <StatusBadge status="danger">Rejected</StatusBadge>
            )}
          </div>

          {/* Organization Details Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Building2 size={13} /> Organization
              </div>
              <div className="font-semibold text-slate-900 text-sm">
                {appData.companyName}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Globe size={13} /> Requested Domain
              </div>
              <div className="font-semibold text-indigo-600 text-sm">
                {appData.requestedDomain}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <User size={13} /> Applicant
              </div>
              <div className="font-medium text-slate-900">
                {appData.applicantName}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Mail size={13} /> Contact Email
              </div>
              <div className="font-medium text-slate-900 truncate">
                {appData.contactEmail}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Phone size={13} /> Contact Phone
              </div>
              <div className="text-slate-800">
                {appData.phone || '—'}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Calendar size={13} /> Submitted At
              </div>
              <div className="text-slate-800">
                {new Date(appData.createdAt).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Notes */}
          {appData.notes && (
            <div className="p-3 bg-slate-50 rounded-md border border-slate-200 text-xs">
              <div className="text-[11px] font-semibold text-slate-500 mb-1">Notes / Context:</div>
              <div className="text-slate-700 leading-relaxed">{appData.notes}</div>
            </div>
          )}

          {/* Rejection Note if already rejected */}
          {appData.status === 'REJECTED' && appData.rejectionReason && (
            <div className="p-3 bg-red-50 rounded-md border border-red-200 text-xs text-red-800">
              <div className="font-semibold mb-0.5">Rejection Reason:</div>
              <div>{appData.rejectionReason}</div>
            </div>
          )}

          {/* ========================================================================= */}
          {/* DNS PROVISIONING, READINESS & ZONE FILE SECTION                           */}
          {/* ========================================================================= */}
          {(resolvedTenantId && resolvedDomainId) || zoneFileText ? (
            <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe size={15} className="text-indigo-600" />
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    DNS Provisioning & Mail Readiness
                  </span>
                </div>
                <StatusBadge status={badge.status} label={badge.label} />
              </div>

              {dnsLoading && <p className="text-xs text-slate-500">Loading DNS details…</p>}

              {/* Status explanation */}
              {currentDnsStatus === 'not_started' && !dnsLoading && (
                <p className="text-xs text-slate-600 leading-relaxed">
                  This domain has canonical DNS records generated. Once the tenant finishes their DNS setup with their domain provider, mail service can be fully activated.
                </p>
              )}

              {/* Tenant DNS Readiness live check widget */}
              {resolvedTenantId && resolvedDomainId && (
                <div className="flex flex-col gap-2 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <Search size={13} className="text-slate-500" />
                      Tenant DNS Readiness
                    </span>
                    <button
                      type="button"
                      onClick={checkRecords}
                      disabled={checking}
                      className="btn-secondary btn-sm text-[11px] inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <RefreshCw size={11} className={checking ? 'animate-spin' : ''} />
                      {checking ? 'Checking…' : 'Re-check'}
                    </button>
                  </div>

                  {liveCheck && (
                    <div
                      className={`p-3 rounded-lg border space-y-2 ${
                        liveCheck.allFound
                          ? 'bg-emerald-50 border-emerald-200'
                          : 'bg-amber-50 border-amber-200'
                      }`}
                    >
                      <div
                        className={`flex items-center gap-1.5 text-xs font-semibold ${
                          liveCheck.allFound ? 'text-emerald-800' : 'text-amber-800'
                        }`}
                      >
                        {liveCheck.allFound ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                        <span>
                          {liveCheck.allFound
                            ? 'All required DNS records are live publicly — ready to activate.'
                            : `${liveCheck.results.filter((r) => !r.found).length} of ${liveCheck.results.length} required records not detected yet. The tenant has not finished DNS setup — Activate is disabled until they do.`}
                        </span>
                      </div>
                      {!liveCheck.allFound && (
                        <div className="space-y-1">
                          {liveCheck.results
                            .filter((r) => !r.found)
                            .map((r, i) => (
                              <div
                                key={i}
                                className="flex items-center gap-2 font-mono text-[11px] px-2 py-1 rounded bg-white/70 text-amber-900"
                              >
                                <XCircle size={11} className="text-amber-600 shrink-0" />
                                <span className="font-semibold">{r.type}</span>
                                <span className="text-slate-500 truncate">{r.name}</span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Conflict banner */}
              {currentDnsStatus === 'conflict' && dnsStatus?.dnsConflicts && dnsStatus.dnsConflicts.length > 0 && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg space-y-2 text-xs">
                  <div className="flex items-center gap-1.5 text-rose-700 font-semibold">
                    <AlertTriangle size={13} />
                    <span>Existing conflicting DNS records detected</span>
                  </div>
                  <div className="space-y-1">
                    {dnsStatus.dnsConflicts.map((c, i) => (
                      <div key={i} className="font-mono text-[11px] text-rose-800 bg-white border border-rose-200 rounded px-2 py-1">
                        {c.type} {c.name}: {c.foundValue}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Active banner */}
              {currentDnsStatus === 'active' && (
                <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-xs font-medium">
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                  <span>Domain is fully active. Mail service is live and routing traffic.</span>
                </div>
              )}

              {/* Raw DNS Zone File */}
              {zoneFileText && (
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                      <FileText size={12} className="text-slate-500" />
                      Manual Setup — Raw DNS Zone File
                    </label>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleCopyZoneFile}
                        className="btn-secondary btn-sm text-[11px] inline-flex items-center gap-1"
                      >
                        {zoneFileCopied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                        {zoneFileCopied ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={handleExportZoneFile}
                        className="btn-secondary btn-sm text-[11px] inline-flex items-center gap-1"
                      >
                        <Download size={11} />
                        Export .txt
                      </button>
                    </div>
                  </div>
                  <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                    {zoneFileText}
                  </pre>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Matches the exact DNS zone records provided to the tenant in their admin console.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600 flex items-start gap-2.5">
              <Globe size={15} className="text-slate-400 shrink-0 mt-0.5" />
              <span>
                Approving this registration will initialize the organisation account, generate its unique DKIM signing keys, and produce the canonical DNS zone file.
              </span>
            </div>
          )}

          {/* Rejection Input */}
          {showRejectInput && (
            <form onSubmit={handleConfirmReject} className="p-3.5 bg-red-50/50 rounded-md border border-red-200 space-y-2.5">
              <label htmlFor="rejectionReason" className="field-label text-red-900 mb-1">
                Reason for Rejection (Required)
              </label>
              <textarea
                id="rejectionReason"
                className="form-textarea w-full text-xs"
                rows={3}
                placeholder="State the reason for rejection (e.g. invalid domain verification or duplicate organization)."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                required
              />
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowRejectInput(false)}
                  disabled={actionLoading === 'reject'}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  loading={actionLoading === 'reject'}
                  disabled={!rejectionReason.trim()}
                >
                  Confirm Rejection
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer flex items-center justify-between">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={actionLoading !== null}
          >
            Close
          </Button>

          <div className="flex items-center gap-2">
            {/* When already approved: allow activating or retrying */}
            {canRetry && (
              <Button
                size="md"
                variant="secondary"
                onClick={handleRetry}
                loading={actionLoading === 'retry'}
              >
                <RefreshCw size={14} className={actionLoading === 'retry' ? 'animate-spin' : ''} />
                <span>Retry / Verify</span>
              </Button>
            )}

            {canActivateDirectly && (
              <Button
                size="md"
                variant="primary"
                onClick={handleActivate}
                loading={actionLoading === 'activate'}
                disabled={!recordsReady}
                title={recordsReady ? undefined : 'Waiting for tenant to finish DNS setup — records not yet detected publicly'}
              >
                <PlayCircle size={15} />
                <span>Activate Domain</span>
              </Button>
            )}

            {/* When pending review */}
            {appData.status === 'PENDING_REVIEW' && !showRejectInput && (
              <>
                <Button
                  type="button"
                  variant="danger"
                  size="md"
                  onClick={() => setShowRejectInput(true)}
                  disabled={actionLoading !== null}
                >
                  Reject
                </Button>

                {recordsReady && resolvedTenantId && resolvedDomainId ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={handleApproveAndActivate}
                    loading={actionLoading === 'approve_activate'}
                  >
                    <PlayCircle size={15} />
                    <span>Approve & Activate</span>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={handleApprove}
                    loading={actionLoading === 'approve'}
                  >
                    Approve Application
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
