import React, { useState } from 'react';
import { X, Ticket, Sparkles } from 'lucide-react';
import { api } from '../../api';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';

interface CreateCouponModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const SAFE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function generateRandomCodePreview(prefix = 'TWX'): string {
  const cleanPrefix = prefix.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'TWX';
  let p1 = '';
  let p2 = '';
  for (let i = 0; i < 4; i++) {
    p1 += SAFE_ALPHABET[Math.floor(Math.random() * SAFE_ALPHABET.length)];
    p2 += SAFE_ALPHABET[Math.floor(Math.random() * SAFE_ALPHABET.length)];
  }
  return `${cleanPrefix}-${p1}-${p2}`;
}

// A coupon does one thing: grant extra free trial days. Earlier revisions also offered
// "percentage discount" and "fixed credit" types, but neither ever touched Stripe or billing —
// redeeming one just showed a success message with no real effect on the account. Cut rather
// than shipped as a working-looking feature that silently did nothing.
export const CreateCouponModal: React.FC<CreateCouponModalProps> = ({ isOpen, onClose, onCreated }) => {
  const [mode, setMode] = useState<'single' | 'batch'>('single');
  const [code, setCode] = useState('');
  const [batchCount, setBatchCount] = useState(5);
  const [batchPrefix, setBatchPrefix] = useState('TWX');
  const [maxUses, setMaxUses] = useState(1);
  const [extraTrialDays, setExtraTrialDays] = useState(30);
  const [expiresAt, setExpiresAt] = useState('');
  const [description, setDescription] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGenerateRandomCode = () => {
    setCode(generateRandomCodePreview('TWX'));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!Number.isInteger(extraTrialDays) || extraTrialDays < 1 || extraTrialDays > 365) {
        throw new Error('Extra trial days must be between 1 and 365.');
      }
      if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 10000) {
        throw new Error('Redemption limit must be between 1 and 10,000.');
      }

      const isoExpiry = expiresAt ? new Date(expiresAt).toISOString() : null;

      if (mode === 'single') {
        await api.createCoupon({
          code: code.trim() || undefined,
          extraTrialDays,
          expiresAt: isoExpiry,
          description: description.trim() || null,
          maxUses,
        });
      } else {
        await api.createBatchCoupons({
          count: Number(batchCount),
          prefix: batchPrefix.trim() || 'TWX',
          extraTrialDays,
          expiresAt: isoExpiry,
          description: description.trim() || null,
          maxUses,
        });
      }

      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create coupon(s).');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
              <Ticket className="w-4 h-4" />
            </div>
            <h2 className="text-sm font-bold text-slate-900">
              {mode === 'single' ? 'Create coupon' : 'Create coupon batch'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto flex flex-col gap-4 text-xs">
          {error && <Alert type="error" message={error} />}

          {/* Mode Switcher */}
          <div className="flex bg-slate-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setMode('single')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                mode === 'single' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Single code
            </button>
            <button
              type="button"
              onClick={() => setMode('batch')}
              className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                mode === 'batch' ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Batch
            </button>
          </div>

          {/* Extra trial days — the one thing a coupon does */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-700 font-semibold">Extra free trial days</label>
            <div className="flex gap-1.5">
              {[7, 14, 30, 60].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setExtraTrialDays(d)}
                  className={`flex-1 py-2 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                    extraTrialDays === d
                      ? 'border-indigo-600 bg-indigo-600 text-white'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  +{d}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={365}
                value={extraTrialDays}
                onChange={(e) => setExtraTrialDays(Math.max(1, Math.min(365, parseInt(e.target.value || '1', 10))))}
                className="w-16 px-2 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-center focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Code Configuration */}
          {mode === 'single' ? (
            <div className="flex flex-col gap-1.5">
              <label className="text-slate-700 font-semibold flex items-center justify-between">
                <span>Coupon code</span>
                <span className="text-[11px] text-slate-400 font-normal">Auto-generated if empty</span>
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. FOUNDER60"
                  maxLength={32}
                  className="flex-1 min-w-0 px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs uppercase focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="button"
                  onClick={handleGenerateRandomCode}
                  className="px-3 py-2 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-medium transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                  title="Generate random code"
                >
                  <Sparkles size={13} className="text-indigo-600" />
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-slate-700 font-semibold">Number of codes</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={batchCount}
                  onChange={(e) => setBatchCount(Math.max(1, Math.min(100, parseInt(e.target.value || '1', 10))))}
                  className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:border-indigo-500"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-slate-700 font-semibold">Prefix</label>
                <input
                  type="text"
                  value={batchPrefix}
                  onChange={(e) => setBatchPrefix(e.target.value.toUpperCase().slice(0, 8))}
                  placeholder="e.g. SUMMER"
                  maxLength={8}
                  className="px-3 py-2 border border-slate-200 rounded-xl font-mono text-xs uppercase focus:outline-hidden focus:border-indigo-500"
                />
              </div>
            </div>
          )}

          {/* Redemption limit */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-700 font-semibold flex items-center justify-between">
              <span>Uses per code</span>
              <span className="text-[11px] text-slate-400 font-normal">
                {maxUses === 1 ? 'One-time use' : `${maxUses} organizations`}
              </span>
            </label>
            <div className="flex gap-1.5">
              {[1, 10, 100].map((limit) => (
                <button
                  key={limit}
                  type="button"
                  onClick={() => setMaxUses(limit)}
                  className={`flex-1 py-2 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer ${
                    maxUses === limit ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {limit}
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={10000}
                value={maxUses}
                onChange={(e) => setMaxUses(Math.max(1, Math.min(10000, Number(e.target.value) || 1)))}
                className="w-16 px-2 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-center focus:outline-hidden focus:border-indigo-500"
              />
            </div>
          </div>

          {/* Expiration Date */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-700 font-semibold flex items-center justify-between">
              <span>Expires</span>
              <span className="text-[11px] text-slate-400 font-normal">Optional</span>
            </label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-xl text-xs text-slate-700 focus:outline-hidden focus:border-indigo-500"
            />
          </div>

          {/* Campaign Description / Note */}
          <div className="flex flex-col gap-1.5">
            <label className="text-slate-700 font-semibold flex items-center justify-between">
              <span>Note</span>
              <span className="text-[11px] text-slate-400 font-normal">Internal only</span>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Y Combinator 2026 batch"
              maxLength={280}
              className="px-3 py-2 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:border-indigo-500"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={loading}>
              {loading ? 'Generating...' : mode === 'single' ? 'Generate coupon' : `Generate ${batchCount} coupons`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
