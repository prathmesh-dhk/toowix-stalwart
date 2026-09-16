import React, { useState, useEffect } from 'react';
import { X, Sliders } from 'lucide-react';
import { api } from '../../api';
import { TenantSummary } from '../../types';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { QuotaTierSelector, DEFAULT_QUOTA_TIERS, QuotaTier } from '../ui/QuotaTierSelector';

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
  const [planTiers, setPlanTiers] = useState<QuotaTier[]>(DEFAULT_QUOTA_TIERS);

  useEffect(() => {
    if (tenant) {
      setLimit(tenant.mailboxLimit || 50);
      setError(null);
    }
  }, [tenant]);

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
  }, [isOpen]);

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
    <div className="modal-backdrop-mock">
      <div className="modal-card max-w-md">
        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
              <Sliders size={16} />
            </div>
            <div>
              <h3 className="modal-title">Adjust Mailbox Quota</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {tenant.name} · {tenant.domain?.domainName || 'No Domain'}
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

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Currently Provisioned:</span>
                <span className="font-semibold text-slate-800 tabular-nums">{currentUsage} mailboxes</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Current Upper Limit:</span>
                <span className="text-slate-600 tabular-nums font-medium">{tenant.mailboxLimit}</span>
              </div>
            </div>

            <QuotaTierSelector
              value={limit}
              minAllowed={minAllowed}
              maxAllowed={10000}
              tiers={planTiers}
              label="New Mailbox Pool Quota"
              onChange={(newLimit) => setLimit(newLimit)}
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
              Save Quota
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
