import React, { useState } from 'react';
import { X, Building2 } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { QuotaTierSelector } from '../ui/QuotaTierSelector';

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
    <div className="modal-backdrop-mock">
      <div className="modal-card max-w-md">
        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
              <Building2 size={16} />
            </div>
            <div>
              <h3 className="modal-title">Provision New Tenant</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Register a dedicated organization and domain
              </p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            {error && (
              <Alert type="error" message={error} onClose={() => setError(null)} />
            )}

            <div>
              <label className="field-label" htmlFor="tenantOrgName">
                Organization Name
              </label>
              <input
                id="tenantOrgName"
                type="text"
                className="form-input"
                placeholder="e.g. Acme Corporation"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor="tenantDomain">
                Primary Email Domain
              </label>
              <input
                id="tenantDomain"
                type="text"
                className="form-input"
                placeholder="e.g. acme.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                required
              />
              <span className="input-helper-text">
                Primary domain routed through Stalwart Mail Server.
              </span>
            </div>

            <QuotaTierSelector
              value={mailboxLimit}
              minAllowed={1}
              maxAllowed={10000}
              label="Mailbox Quota Limit"
              helperText="Maximum number of active mailboxes allowed."
              onChange={(newLimit) => setMailboxLimit(newLimit)}
              disabled={loading}
            />
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
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="md"
              loading={loading}
            >
              Provision Tenant
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
