import React, { useState, useEffect } from 'react';
import { TenantSummary } from '../../types';
import { api } from '../../api';
import { X, CheckCircle2, AlertCircle, Copy, Check, Mail, ExternalLink, RefreshCw, PlayCircle } from 'lucide-react';

interface TenantActivationModalProps {
  tenant: TenantSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onActivated?: () => void;
}

export const TenantActivationModal: React.FC<TenantActivationModalProps> = ({
  tenant,
  isOpen,
  onClose,
  onActivated,
}) => {
  const [loading, setLoading] = useState(false);
  const [activationResult, setActivationResult] = useState<{
    link: string;
    contactEmail?: string;
    emailSent?: boolean;
    emailError?: string;
  } | null>(null);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendStatus, setResendStatus] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && tenant) {
      setActivationResult(null);
      setActivationError(null);
      setCopied(false);
      setResendStatus(null);
    }
  }, [isOpen, tenant]);

  if (!isOpen || !tenant) return null;

  const handleExecuteActivation = async () => {
    setLoading(true);
    setActivationError(null);
    try {
      const res = await api.activateTenant(tenant.id);
      setActivationResult({
        link: res.activationLink,
        contactEmail: res.contactEmail,
        emailSent: res.emailSent,
        emailError: res.emailError,
      });
      if (onActivated) onActivated();
    } catch (err: any) {
      setActivationError(err.message || 'Failed to activate tenant.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopyLink = () => {
    if (!activationResult?.link) return;
    navigator.clipboard.writeText(activationResult.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleResendEmail = async () => {
    setResending(true);
    setResendStatus(null);
    try {
      const res = await api.resendActivationEmail(tenant.id);
      setActivationResult((prev) =>
        prev
          ? {
              ...prev,
              link: res.activationLink,
              contactEmail: res.contactEmail,
              emailSent: res.emailSent,
              emailError: res.emailError,
            }
          : null
      );
      setResendStatus(
        res.emailSent
          ? `Activation email resent to ${res.contactEmail}.`
          : `New token generated (Email offline: ${res.emailError || 'SMTP error'}). Link updated below.`
      );
    } catch (err: any) {
      setResendStatus(`Failed to resend email: ${err.message}`);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1050 }}>
      <div className="modal-content" style={{ maxWidth: '560px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>
              Tenant Activation
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '4px 0 0 0' }}>
              {tenant.name} &bull; <span style={{ fontFamily: 'monospace', color: 'var(--primary-light)' }}>{tenant.domain?.domainName}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: 4 }}
          >
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 0' }}>
            <div className="status-dot status-dot-active" style={{ width: 16, height: 16, margin: '0 auto 12px' }} />
            <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-main)' }}>Activating Tenant on Stalwart...</h4>
            <p style={{ margin: '6px 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Preflighting Stalwart domain registration and generating secure onboarding token.
            </p>
          </div>
        ) : activationError ? (
          <div style={{ padding: '16px', background: 'var(--danger-bg)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239, 68, 68, 0.3)', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#fca5a5', fontWeight: 600, marginBottom: '6px' }}>
              <AlertCircle size={18} />
              <span>Activation Preflight Failed</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#fca5a5', lineHeight: 1.4 }}>
              {activationError}
            </p>
            <div style={{ marginTop: '14px' }}>
              <button className="btn btn-primary btn-sm" onClick={handleExecuteActivation}>
                <RefreshCw size={13} /> Retry Activation
              </button>
            </div>
          </div>
        ) : activationResult ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 16px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              <CheckCircle2 size={20} color="var(--success)" />
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#34d399' }}>Tenant Activated Successfully</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  Domain is linked on Stalwart and tenant status is Active.
                </div>
              </div>
            </div>

            {/* Email Dispatch Info */}
            <div style={{ padding: '12px 16px', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Recipient Email:</span>
                <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{activationResult.contactEmail || 'Registered contact'}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.85rem', marginTop: '6px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Email Dispatch:</span>
                <span style={{ color: activationResult.emailSent ? 'var(--success)' : 'var(--warning)', fontWeight: 600 }}>
                  {activationResult.emailSent ? 'Dispatched via SMTP' : 'Email offline / link generated'}
                </span>
              </div>
              {activationResult.emailError && (
                <div style={{ fontSize: '0.75rem', color: '#fca5a5', marginTop: '6px' }}>
                  Notice: {activationResult.emailError}
                </div>
              )}
            </div>

            {/* Direct Activation Link */}
            <div>
              <label className="form-label" style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '6px', display: 'block' }}>
                Activation Link (Valid for 48 hours)
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  value={activationResult.link}
                  className="form-input"
                  style={{ fontSize: '0.8rem', fontFamily: 'monospace' }}
                />
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCopyLink}
                  title="Copy activation link"
                  style={{ display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}
                >
                  {copied ? <Check size={16} color="var(--success)" /> : <Copy size={16} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            {resendStatus && (
              <div style={{ fontSize: '0.8rem', color: 'var(--primary-light)', padding: '6px 0' }}>
                {resendStatus}
              </div>
            )}
          </div>
        ) : (
          <div>
            <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: '20px' }}>
              Activating <strong>{tenant.name}</strong> will finalize its dedicated domain link on Stalwart Mail, update tenant status to <strong>Active</strong>, and issue an activation token for administrative password setup.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleExecuteActivation}
                style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'linear-gradient(135deg, #10b981, #059669)' }}
              >
                <PlayCircle size={15} />
                <span>Confirm & Activate</span>
              </button>
            </div>
          </div>
        )}

        {activationResult && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '24px', paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Close
            </button>

            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleResendEmail}
                disabled={resending}
                style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <Mail size={14} />
                <span>{resending ? 'Sending...' : 'Resend Email'}</span>
              </button>
              <a
                href={activationResult.link}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary"
                style={{ display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
              >
                <span>Open Link</span>
                <ExternalLink size={14} />
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
