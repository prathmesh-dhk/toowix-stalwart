import React, { useState } from 'react';
import { DomainDeletionRequest } from '../../types';
import { X, Building2, Globe, User, Calendar, Trash2, AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { StatusBadge } from '../ui/StatusBadge';

interface DomainDeletionReviewModalProps {
  request: DomainDeletionRequest | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (requestId: string) => Promise<void>;
  onReject: (requestId: string, reason: string) => Promise<void>;
}

export const DomainDeletionReviewModal: React.FC<DomainDeletionReviewModalProps> = ({
  request,
  isOpen,
  onClose,
  onApprove,
  onReject,
}) => {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen || !request) return null;

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionReason.trim()) {
      setError('Please provide a reason for rejecting this domain deletion request.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onReject(request.id, rejectionReason.trim());
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to reject deletion request');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    const ok = window.confirm(
      `Are you sure you want to approve deletion for domain "${request.domainName}"?\n\nThis will permanently cancel any live Stripe subscriptions, delete DNS credentials, Stalwart domain records, and the domain database entry.`
    );
    if (!ok) return;

    setError(null);
    setLoading(true);
    try {
      await onApprove(request.id);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to approve deletion request');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop-mock">
      <div className="modal-card max-w-xl">
        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-rose-50 border border-rose-200/60 flex items-center justify-center text-rose-600 shrink-0">
              <Trash2 size={18} />
            </div>
            <div>
              <h3 className="modal-title">Review Domain Deletion</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Request ID: <span className="font-mono text-slate-700">#{request.id.slice(-8).toUpperCase()}</span>
              </p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn" aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body space-y-4">
          {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

          {/* Status Row */}
          <div className="flex items-center justify-between p-3 rounded-md bg-slate-50 border border-slate-200">
            <span className="text-xs font-medium text-slate-600">Request Status:</span>
            {request.status === 'pending' && (
              <StatusBadge status="warning">Pending Review</StatusBadge>
            )}
            {request.status === 'approved' && (
              <StatusBadge status="success">Approved & Deleted</StatusBadge>
            )}
            {request.status === 'rejected' && (
              <StatusBadge status="danger">Rejected</StatusBadge>
            )}
          </div>

          {/* Warning Banner for Pending Requests */}
          {request.status === 'pending' && (
            <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-amber-800">
                <ShieldAlert size={14} className="text-amber-600 shrink-0" />
                <span>Cascading Deletion Actions Upon Approval</span>
              </div>
              <ul className="list-disc pl-4 space-y-0.5 text-amber-800/90 text-[11px]">
                <li>Cancel active Stripe billing subscription for this domain immediately.</li>
                <li>Purge saved DNS provider credentials and zone records.</li>
                <li>Remove domain and DKIM signing keys from Stalwart Mail Server.</li>
                <li>Delete Domain record and reassign primary domain for tenant if necessary.</li>
              </ul>
            </div>
          )}

          {/* Request Details Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Globe size={13} /> Domain
              </div>
              <div className="font-semibold text-indigo-600 text-sm font-mono">
                {request.domainName}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Building2 size={13} /> Tenant / Organization
              </div>
              <div className="font-semibold text-slate-900 text-sm">
                {request.tenantName || request.tenantId}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <User size={13} /> Requested By
              </div>
              <div className="font-medium text-slate-900 truncate">
                {request.requestedBy?.email || 'Tenant Admin'}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Calendar size={13} /> Submitted At
              </div>
              <div className="text-slate-800">
                {new Date(request.createdAt).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Tenant's Reason */}
          {request.reason && (
            <div className="p-3 bg-slate-50 rounded-md border border-slate-200 text-xs">
              <div className="text-[11px] font-semibold text-slate-500 mb-1">Tenant's Stated Reason:</div>
              <div className="text-slate-700 leading-relaxed">{request.reason}</div>
            </div>
          )}

          {/* Reviewed Info if resolved */}
          {request.reviewedAt && (
            <div className="p-3 bg-slate-50 rounded-md border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
              <span>Reviewed on {new Date(request.reviewedAt).toLocaleString()}</span>
              {request.reviewedBy && (
                <span className="font-medium">by {request.reviewedBy.email}</span>
              )}
            </div>
          )}

          {/* Rejection Note if already rejected */}
          {request.status === 'rejected' && request.rejectionReason && (
            <div className="p-3 bg-red-50 rounded-md border border-red-200 text-xs text-red-800">
              <div className="font-semibold mb-0.5">Rejection Reason:</div>
              <div>{request.rejectionReason}</div>
            </div>
          )}

          {/* Rejection Form */}
          {showRejectInput && (
            <form onSubmit={handleConfirmReject} className="p-3.5 bg-red-50/50 rounded-md border border-red-200 space-y-2.5">
              <label className="field-label text-red-900 mb-1">
                Reason for Rejection (Required)
              </label>
              <textarea
                className="form-textarea w-full text-xs"
                rows={3}
                placeholder="State the reason for rejecting this request (e.g., active mailboxes require migration, or tenant requested cancellation of request)."
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
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  loading={loading}
                  disabled={!rejectionReason.trim()}
                >
                  Confirm Rejection
                </Button>
              </div>
            </form>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={loading}
          >
            Close
          </Button>

          {request.status === 'pending' && !showRejectInput && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="danger"
                size="md"
                onClick={() => setShowRejectInput(true)}
                disabled={loading}
              >
                Reject Request
              </Button>
              <Button
                type="button"
                variant="danger"
                size="md"
                onClick={handleApprove}
                loading={loading}
              >
                Approve & Delete Domain
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
