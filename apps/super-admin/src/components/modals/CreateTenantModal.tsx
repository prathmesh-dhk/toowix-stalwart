import React, { useState, useEffect } from 'react';
import { X, Building2, Globe } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { QuotaTierSelector, DEFAULT_QUOTA_TIERS, QuotaTier } from '../ui/QuotaTierSelector';

interface UnmanagedDomain {
  stalwartDomainId: string;
  domainName: string;
  isEnabled: boolean;
}

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
  const [planTiers, setPlanTiers] = useState<QuotaTier[]>(DEFAULT_QUOTA_TIERS);
  const [unmanagedDomains, setUnmanagedDomains] = useState<UnmanagedDomain[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    api
      .listPlans()
      .then((res) => {
        if (res.plans.length > 0) {
          setPlanTiers(res.plans.map((p) => ({ id: p.id, label: `${p.name} (${p.seatCount})`, value: p.seatCount })));
        }
      })
      .catch(() => {
        // Keep the fallback tiers — the picker should never render empty.
      });
    api
      .listUnmanagedStalwartDomains()
      .then((res) => setUnmanagedDomains(res.domains))
      .catch(() => {
        // Non-fatal: the modal still works as plain manual domain entry.
        setUnmanagedDomains([]);
      });
  }, [isOpen]);

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
                className="form-input text-base sm:text-xs"
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
                className="form-input text-base sm:text-xs"
                placeholder="e.g. acme.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                required
              />
              <span className="input-helper-text">
                Primary domain routed through Stalwart Mail Server. Creating a tenant with a domain
                that already exists in Stalwart attaches it — nothing is duplicated.
              </span>
            </div>

            {unmanagedDomains.length > 0 && (
              <div className="p-3 rounded-lg border border-dashed border-slate-200 bg-slate-50/60">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-2">
                  <Globe className="w-3.5 h-3.5 text-indigo-500" />
                  <span>Unmanaged domains already in Stalwart</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {unmanagedDomains.map((d) => (
                    <button
                      key={d.stalwartDomainId}
                      type="button"
                      onClick={() => {
                        setDomain(d.domainName);
                        if (!name.trim()) setName(d.domainName.split('.')[0]);
                      }}
                      className="px-2 py-1 rounded-md text-[11px] font-mono bg-white border border-slate-200 text-slate-700 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
                      title={`Attach ${d.domainName} to this tenant`}
                    >
                      {d.domainName}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <QuotaTierSelector
              value={mailboxLimit}
              minAllowed={1}
              maxAllowed={10000}
              tiers={planTiers}
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
