import React, { useState, useEffect } from 'react';
import { X, Mail, AlertTriangle } from 'lucide-react';
import { api } from '../../api';
import { TenantSummary } from '../../types';

interface UpdateQuotaModalProps {
  isOpen: boolean;
  tenant: TenantSummary | null;
  onClose: () => void;
  onQuotaUpdated: () => void;
}

export const UpdateQuotaModal: React.FC<UpdateQuotaModalProps> = ({
  isOpen,
  tenant,
  onClose,
  onQuotaUpdated,
}) => {
  const [limit, setLimit] = useState<number>(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tenant) {
      setLimit(tenant.mailboxLimit || 50);
      setError(null);
    }
  }, [tenant]);

  if (!isOpen || !tenant) return null;

  const currentUsage = tenant.mailboxCount || 0;
  const minAllowed = currentUsage;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (limit < minAllowed) {
      setError(`Mailbox limit cannot be less than current active mailboxes (${minAllowed}).`);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.updateMailboxLimit(tenant.id, Number(limit));
      onQuotaUpdated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update mailbox quota.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1050 }}>
      <div className="modal-content" style={{ maxWidth: '480px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              background: 'rgba(56, 189, 248, 0.12)',
              color: 'var(--primary-light)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Mail size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>
                Adjust Mailbox Quota
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '2px 0 0 0' }}>
                {tenant.name} &bull; <code style={{ color: 'var(--primary-light)' }}>{tenant.domain?.domainName || 'No Domain'}</code>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', padding: '4px' }}
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div style={{
            background: 'var(--danger-bg)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            color: '#fca5a5',
            marginBottom: '16px',
            fontSize: '0.85rem',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <AlertTriangle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{
            background: 'var(--bg-input)',
            borderRadius: 'var(--radius-md)',
            padding: '14px',
            marginBottom: '20px',
            border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-dim)' }}>Currently In Use:</span>
              <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{currentUsage} mailboxes</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-dim)' }}>Current Maximum:</span>
              <span style={{ fontWeight: 600, color: 'var(--primary-light)' }}>{tenant.mailboxLimit} mailboxes</span>
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: '24px' }}>
            <label className="form-label" style={{ fontWeight: 600 }}>
              New Mailbox Limit
            </label>
            <input
              type="number"
              className="form-input"
              min={minAllowed}
              max={10000}
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              required
              autoFocus
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginTop: '6px' }}>
              Minimum allowed is {minAllowed} (cannot be set lower than active mailboxes).
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || limit < minAllowed}
            >
              {loading ? 'Saving Changes...' : 'Update Quota'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
