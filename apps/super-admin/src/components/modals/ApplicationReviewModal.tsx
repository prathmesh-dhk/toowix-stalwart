import React, { useState } from 'react';
import { RegistrationApplication } from '../../types';
import { X, CheckCircle2, XCircle, Building2, Globe, User, Mail, Phone, Calendar, AlertCircle } from 'lucide-react';

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
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '640px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Review Tenant Application</h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '4px 0 0 0' }}>
              Reference ID: <span style={{ fontFamily: 'monospace' }}>#{application._id.slice(-8).toUpperCase()}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div style={{ background: 'var(--danger-bg)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '10px 14px', borderRadius: 'var(--radius-md)', color: '#fca5a5', marginBottom: '16px', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          {/* Status Badge */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Application Status:</span>
            {application.status === 'PENDING_REVIEW' && (
              <span className="badge badge-warning">Pending Review</span>
            )}
            {application.status === 'APPROVED' && (
              <span className="badge badge-success">
                <CheckCircle2 size={13} /> Approved
              </span>
            )}
            {application.status === 'REJECTED' && (
              <span className="badge badge-danger">
                <XCircle size={13} /> Rejected
              </span>
            )}
          </div>

          {/* Organization Details */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
            <div style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <Building2 size={13} /> Organization Name
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-main)' }}>
                {application.companyName}
              </div>
            </div>

            <div style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <Globe size={13} /> Requested Domain
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--primary-light)', fontFamily: 'monospace' }}>
                {application.requestedDomain}
              </div>
            </div>

            <div style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <User size={13} /> Applicant Name
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: 500 }}>
                {application.applicantName}
              </div>
            </div>

            <div style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <Mail size={13} /> Contact Email
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-main)', fontWeight: 500 }}>
                {application.contactEmail}
              </div>
            </div>

            <div style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <Phone size={13} /> Phone
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>
                {application.phone || '—'}
              </div>
            </div>

            <div style={{ padding: '12px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                <Calendar size={13} /> Submitted Date
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>
                {new Date(application.createdAt).toLocaleString()}
              </div>
            </div>
          </div>

          {/* Notes / Context */}
          {application.notes && (
            <div style={{ padding: '12px 14px', background: 'rgba(255, 255, 255, 0.02)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginBottom: '4px' }}>Organization Details / Notes:</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-main)', lineHeight: 1.4 }}>
                {application.notes}
              </div>
            </div>
          )}

          {/* Rejection reason if already rejected */}
          {application.status === 'REJECTED' && application.rejectionReason && (
            <div style={{ padding: '12px 14px', background: 'var(--danger-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
              <div style={{ fontSize: '0.75rem', color: '#fca5a5', fontWeight: 600, marginBottom: '4px' }}>Rejection Reason:</div>
              <div style={{ fontSize: '0.85rem', color: '#fca5a5' }}>{application.rejectionReason}</div>
            </div>
          )}

          {/* Rejection input when toggled */}
          {showRejectInput && (
            <form onSubmit={handleConfirmReject} style={{ padding: '14px', background: 'rgba(239, 68, 68, 0.08)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
              <label className="form-label" style={{ color: '#fca5a5' }}>
                Reason for Rejection (Required)
              </label>
              <textarea
                className="form-input"
                rows={3}
                placeholder="e.g. Domain registration could not be verified or duplicate organization requested."
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                required
                style={{ resize: 'vertical', width: '100%', marginBottom: '12px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowRejectInput(false)}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-danger btn-sm"
                  disabled={loading || !rejectionReason.trim()}
                >
                  {loading ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Modal Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={loading}
          >
            Close
          </button>

          {application.status === 'PENDING_REVIEW' && !showRejectInput && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setShowRejectInput(true)}
                disabled={loading}
              >
                Reject
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleApprove}
                disabled={loading}
              >
                {loading ? 'Approving...' : 'Approve Application'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
