import React, { useState, useEffect } from 'react';
import { X, Layers } from 'lucide-react';
import { api } from '../../api';
import { Plan, PlanBillingMode } from '../../types';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';

interface PlanFormModalProps {
  isOpen: boolean;
  plan: Plan | null;
  onClose: () => void;
  onSaved: () => void;
}

export const PlanFormModal: React.FC<PlanFormModalProps> = ({ isOpen, plan, onClose, onSaved }) => {
  const [name, setName] = useState('');
  const [badge, setBadge] = useState('');
  const [description, setDescription] = useState('');
  const [seatCount, setSeatCount] = useState(10);
  const [displayOrder, setDisplayOrder] = useState(0);
  const [isDefault, setIsDefault] = useState(false);
  const [billingMode, setBillingMode] = useState<PlanBillingMode>('fixed');
  const [monthlyPriceInRupees, setMonthlyPriceInRupees] = useState('0');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!plan;

  useEffect(() => {
    if (isOpen) {
      setName(plan?.name || '');
      setBadge(plan?.badge || '');
      setDescription(plan?.description || '');
      setSeatCount(plan?.seatCount ?? 10);
      setDisplayOrder(plan?.displayOrder ?? 0);
      setIsDefault(plan?.isDefault ?? false);
      setBillingMode(plan?.billingMode ?? 'fixed');
      setMonthlyPriceInRupees(String((plan?.monthlyPriceInPaise ?? 0) / 100));
      setError(null);
    }
  }, [isOpen, plan]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || seatCount < 1) {
      setError('Plan name is required and seat count must be at least 1.');
      return;
    }
    const priceInRupees = Number(monthlyPriceInRupees);
    if (Number.isNaN(priceInRupees) || priceInRupees < 0) {
      setError('Monthly price must be a valid, non-negative amount.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const body = {
        name: name.trim(),
        badge: badge.trim() || null,
        description: description.trim() || null,
        seatCount: Number(seatCount),
        displayOrder: Number(displayOrder),
        isDefault,
        billingMode,
        monthlyPriceInPaise: Math.round(priceInRupees * 100),
      };
      if (isEdit && plan) {
        await api.updatePlan(plan.id, body);
      } else {
        await api.createPlan(body);
      }
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save plan.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop-mock">
      <div className="modal-card max-w-md">
        <div className="modal-header">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100">
              <Layers size={16} />
            </div>
            <div>
              <h3 className="modal-title">{isEdit ? 'Edit Plan' : 'Create Plan'}</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {isEdit ? `Update the ${plan?.name} seat tier` : 'Add a new seat tier for tenants to choose from'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

            <div>
              <label className="field-label" htmlFor="planName">
                Plan Name
              </label>
              <input
                id="planName"
                type="text"
                className="form-input"
                placeholder="e.g. Business"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="field-label mb-1.5 block">Billing Mode</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBillingMode('fixed')}
                  className={`p-2.5 rounded-lg border text-xs font-semibold text-left transition-colors cursor-pointer min-h-[44px] ${
                    billingMode === 'fixed'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Fixed
                  <span className="block text-[10px] font-normal text-slate-400 mt-0.5">
                    Flat price for the seat count
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setBillingMode('metered')}
                  className={`p-2.5 rounded-lg border text-xs font-semibold text-left transition-colors cursor-pointer min-h-[44px] ${
                    billingMode === 'metered'
                      ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  Pay as you go
                  <span className="block text-[10px] font-normal text-slate-400 mt-0.5">
                    Billed on actual usage
                  </span>
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="planSeatCount">
                  {billingMode === 'metered' ? 'Seat Cap' : 'Seat Count'}
                </label>
                <input
                  id="planSeatCount"
                  type="number"
                  min={1}
                  className="form-input text-base sm:text-xs"
                  value={seatCount}
                  onChange={(e) => setSeatCount(parseInt(e.target.value, 10) || 1)}
                  required
                />
                {billingMode === 'metered' && (
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    A technical safety ceiling only — pricing is per-mailbox usage, not this number.
                  </span>
                )}
              </div>
              <div>
                <label className="field-label" htmlFor="planDisplayOrder">
                  Display Order
                </label>
                <input
                  id="planDisplayOrder"
                  type="number"
                  className="form-input text-base sm:text-xs"
                  value={displayOrder}
                  onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
                />
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor="planPrice">
                {billingMode === 'metered' ? 'Price per seat / month (₹)' : 'Monthly price (₹)'}
              </label>
              <input
                id="planPrice"
                type="number"
                min={0}
                step="0.01"
                className="form-input"
                value={monthlyPriceInRupees}
                onChange={(e) => setMonthlyPriceInRupees(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor="planBadge">
                Badge <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="planBadge"
                type="text"
                className="form-input"
                placeholder="e.g. Standard"
                value={badge}
                onChange={(e) => setBadge(e.target.value)}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="planDescription">
                Description <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="planDescription"
                type="text"
                className="form-input"
                placeholder="e.g. Best for growing teams"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="rounded border-slate-300"
              />
              <span>
                Default plan for new self-registrations
                <span className="block text-[11px] text-slate-400 font-normal">
                  Only one plan can be default — checking this unsets it on any other plan.
                </span>
              </span>
            </label>
          </div>

          <div className="modal-footer">
            <Button type="button" variant="secondary" size="md" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" loading={loading}>
              {isEdit ? 'Save Changes' : 'Create Plan'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
