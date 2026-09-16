import React, { useState, useEffect } from 'react';
import { X, Layers } from 'lucide-react';
import { api } from '../../api';
import { Plan } from '../../types';
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label" htmlFor="planSeatCount">
                  Seat Count
                </label>
                <input
                  id="planSeatCount"
                  type="number"
                  min={1}
                  className="form-input"
                  value={seatCount}
                  onChange={(e) => setSeatCount(parseInt(e.target.value, 10) || 1)}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="planDisplayOrder">
                  Display Order
                </label>
                <input
                  id="planDisplayOrder"
                  type="number"
                  className="form-input"
                  value={displayOrder}
                  onChange={(e) => setDisplayOrder(parseInt(e.target.value, 10) || 0)}
                />
              </div>
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
