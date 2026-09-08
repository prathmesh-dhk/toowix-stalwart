import React, { useState, useEffect } from 'react';
import { TenantSummary } from '../../types';
import { api } from '../../api';
import { X, CheckCircle2, Copy, Check, ExternalLink, RefreshCw, PlayCircle } from 'lucide-react';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';

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
          : `New token generated. Link updated below.`
      );
    } catch (err: any) {
      setResendStatus(`Failed to resend email: ${err.message}`);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="modal-backdrop-mock">
      <div className="modal-card max-w-lg">
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Tenant Activation</h3>
            <p className="text-xs text-slate-500 mt-0.5 font-mono">{tenant.name} · {tenant.domain?.domainName}</p>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="modal-body space-y-4">
          {activationError && (
            <Alert type="error" message={activationError} onClose={() => setActivationError(null)} />
          )}
          {resendStatus && (
            <Alert type="info" message={resendStatus} onClose={() => setResendStatus(null)} />
          )}

          {!activationResult ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-600 leading-relaxed">
                Activating this tenant provisions the domain in Stalwart Mail Server and generates a one-time activation link for the tenant administrator.
              </p>

              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Organization:</span>
                  <span className="font-semibold text-slate-800">{tenant.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Domain:</span>
                  <span className="font-mono text-indigo-600">{tenant.domain?.domainName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Mailbox Limit:</span>
                  <span className="font-mono text-slate-800">{tenant.mailboxLimit}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-xs font-medium">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <span>Tenant activated and provisioned in Stalwart.</span>
              </div>

              <div>
                <label className="field-label mb-1">One-Time Activation URL</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={activationResult.link}
                    className="form-input flex-1 font-mono text-xs bg-slate-50"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleCopyLink}
                  >
                    {copied ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </Button>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleResendEmail}
                  disabled={resending}
                >
                  <RefreshCw size={13} className={resending ? 'animate-spin' : ''} />
                  <span>{resending ? 'Resending...' : 'Resend Email'}</span>
                </Button>

                <a
                  href={activationResult.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-600 hover:text-indigo-700 font-medium inline-flex items-center gap-1"
                >
                  <span>Open wizard</span>
                  <ExternalLink size={12} />
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          <Button
            size="md"
            variant="secondary"
            onClick={onClose}
          >
            {activationResult ? 'Done' : 'Cancel'}
          </Button>

          {!activationResult && (
            <Button
              size="md"
              variant="primary"
              onClick={handleExecuteActivation}
              loading={loading}
            >
              <PlayCircle size={15} />
              <span>Activate & Provision</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
