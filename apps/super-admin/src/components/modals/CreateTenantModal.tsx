import React, { useState } from 'react';
import { X, Building2, Globe, Mail, AlertTriangle } from 'lucide-react';
import { api } from '../../api';

interface CreateTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTenantCreated: () => void;
}

export const CreateTenantModal: React.FC<CreateTenantModalProps> = ({
  isOpen,
  onClose,
  onTenantCreated,
}) => {
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [mailboxLimit, setMailboxLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !domain.trim()) {
      setError('Organization name and email domain are required.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.createTenant({
        name: name.trim(),
        domain: domain.trim().toLowerCase(),
        mailboxLimit: Number(mailboxLimit),
      });
      setName('');
      setDomain('');
      setMailboxLimit(50);
      onTenantCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create tenant.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 1050 }}>
      <div className="modal-content" style={{ maxWidth: '520px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
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
              <Building2 size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.2rem', fontWeight: 600, margin: 0, color: 'var(--text-main)' }}>
                Provision New Tenant
              </h3>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-dim)', margin: '2px 0 0 0' }}>
                Manually register a dedicated organization and domain
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
          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Building2 size={14} /> Organization Name
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Acme Corporation"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <label className="form-label" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Globe size={14} /> Dedicated Email Domain
            </label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. acme.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              required
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginTop: '4px' }}>
              Each tenant is provisioned with a dedicated email domain in Stalwart Mail.
            </span>
          </div>

          <div className="form-group" style={{ marginBottom: '24px' }}>
            <label className="form-label" style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Mail size={14} /> Mailbox Quota Limit
            </label>
            <input
              type="number"
              className="form-input"
              min="1"
              max="10000"
              value={mailboxLimit}
              onChange={(e) => setMailboxLimit(Number(e.target.value))}
              required
            />
            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', display: 'block', marginTop: '4px' }}>
              Maximum number of mailboxes this tenant can allocate. Can be adjusted later.
            </span>
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
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
              disabled={loading}
            >
              {loading ? 'Provisioning...' : 'Create Tenant'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
