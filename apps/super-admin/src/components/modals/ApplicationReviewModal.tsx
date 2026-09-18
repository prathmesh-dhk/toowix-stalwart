import React, { useState } from 'react';
import { RegistrationApplication } from '../../types';
import { X, Building2, Globe, User, Mail, Phone, Calendar } from 'lucide-react';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { StatusBadge } from '../ui/StatusBadge';

interface ApplicationReviewModalProps {
  application: RegistrationApplication | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (appId: string) => Promise<void>;
  onReject: (appId: string, reason: string) => Promise<void>;
}

export const ApplicationReviewModal: React.FC<ApplicationReviewModalProps> = ({
  application,
  isOpen,
  onClose,
  onApprove,
  onReject,
}) => {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen || !application) return null;

  const handleConfirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectionReason.trim()) {
      setError('Please provide a reason for rejecting this application.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onReject(application._id, rejectionReason.trim());
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to reject application');
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    setError(null);
    setLoading(true);
    try {
      await onApprove(application._id);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to approve application');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop-mock">
      <div className="modal-card max-w-xl">
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Review Domain Application</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Reference ID: <span className="font-medium text-slate-700">#{application._id.slice(-8).toUpperCase()}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="modal-close-btn"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body space-y-4">
          {error && (
            <Alert type="error" message={error} onClose={() => setError(null)} />
          )}

          {/* Status Row */}
          <div className="flex items-center justify-between p-3 rounded-md bg-slate-50 border border-slate-200">
            <span className="text-xs font-medium text-slate-600">Application Status:</span>
            {application.status === 'PENDING_REVIEW' && (
              <StatusBadge status="warning">Pending Review</StatusBadge>
            )}
            {application.status === 'APPROVED' && (
              <StatusBadge status="success">Approved</StatusBadge>
            )}
            {application.status === 'REJECTED' && (
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
                {application.companyName}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Globe size={13} /> Requested Domain
              </div>
              <div className="font-semibold text-indigo-600 text-sm">
                {application.requestedDomain}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <User size={13} /> Applicant
              </div>
              <div className="font-medium text-slate-900">
                {application.applicantName}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Mail size={13} /> Contact Email
              </div>
              <div className="font-medium text-slate-900 truncate">
                {application.contactEmail}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Phone size={13} /> Contact Phone
              </div>
              <div className="text-slate-800">
                {application.phone || '—'}
              </div>
            </div>

            <div className="p-3 bg-white rounded-md border border-slate-200">
              <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mb-1">
                <Calendar size={13} /> Submitted At
              </div>
              <div className="text-slate-800">
                {new Date(application.createdAt).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Notes */}
          {application.notes && (
            <div className="p-3 bg-slate-50 rounded-md border border-slate-200 text-xs">
              <div className="text-[11px] font-semibold text-slate-500 mb-1">Notes / Context:</div>
              <div className="text-slate-700 leading-relaxed">{application.notes}</div>
            </div>
          )}

          {/* Rejection Note if already rejected */}
          {application.status === 'REJECTED' && application.rejectionReason && (
            <div className="p-3 bg-red-50 rounded-md border border-red-200 text-xs text-red-800">
              <div className="font-semibold mb-0.5">Rejection Reason:</div>
              <div>{application.rejectionReason}</div>
            </div>
          )}

          {/* Rejection Input */}
          {showRejectInput && (
            <form onSubmit={handleConfirmReject} className="p-3.5 bg-red-50/50 rounded-md border border-red-200 space-y-2.5">
              <label className="field-label text-red-900 mb-1">
                Reason for Rejection (Required)
              </label>
              <textarea
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

          {application.status === 'PENDING_REVIEW' && !showRejectInput && (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="danger"
                size="md"
                onClick={() => setShowRejectInput(true)}
                disabled={loading}
              >
                Reject
              </Button>
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleApprove}
                loading={loading}
              >
                Approve Application
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
