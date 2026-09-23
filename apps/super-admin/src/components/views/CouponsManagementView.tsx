import React, { useState, useEffect, useCallback } from 'react';
import {
  Ticket,
  Plus,
  RefreshCw,
  Copy,
  Check,
  Search,
  Trash2,
  Ban,
  AlertCircle,
} from 'lucide-react';
import { api } from '../../api';
import { CouponItem, CouponStatus } from '../../types';
import { Button } from '../ui/Button';
import { CreateCouponModal } from '../modals/CreateCouponModal';

interface CouponsManagementViewProps {
  onRefreshTrigger?: () => void;
}

function statusBadge(status: CouponStatus) {
  switch (status) {
    case 'active':
      return { label: 'Active', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' };
    case 'used':
      return { label: 'Redeemed', bg: '#f1f5f9', color: '#475569', border: '#cbd5e1' };
    case 'expired':
      return { label: 'Expired', bg: '#fffbeb', color: '#b45309', border: '#fde68a' };
    case 'revoked':
      return { label: 'Revoked', bg: '#fff1f2', color: '#be123c', border: '#fecdd3' };
    default:
      return { label: status, bg: '#f8fafc', color: '#64748b', border: '#e2e8f0' };
  }
}

function formatDiscount(extraTrialDays: number): string {
  return `+${extraTrialDays} Days Free Trial`;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const CouponsManagementView: React.FC<CouponsManagementViewProps> = () => {
  const [coupons, setCoupons] = useState<CouponItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stats
  const [totalCount, setTotalCount] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [usedCount, setUsedCount] = useState(0);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals & Feedback
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listCoupons({
        status: statusFilter !== 'all' ? statusFilter : undefined,
        search: searchTerm.trim() || undefined,
        limit: 100,
      });
      setCoupons(res.coupons);
      setTotalCount(res.total);
      setActiveCount(res.activeCount);
      setUsedCount(res.usedCount);
    } catch (err: any) {
      setError(err.message || 'Failed to load coupons.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, searchTerm]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCopyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch {
      // fallback
    }
  };

  const handleRevoke = async (id: string) => {
    if (!window.confirm('Are you sure you want to revoke this coupon? It will no longer be redeemable.')) return;
    setActionLoadingId(id);
    try {
      await api.revokeCoupon(id);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke coupon.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to permanently delete this unused coupon?')) return;
    setActionLoadingId(id);
    try {
      await api.deleteCoupon(id);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to delete coupon.');
    } finally {
      setActionLoadingId(null);
    }
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">One-Time Coupon Codes</h2>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200">
              One-Time Use Guaranteed
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Generate and manage promotional codes that grant extra free trial days.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button size="sm" variant="secondary" onClick={load} disabled={loading} title="Refresh coupons">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowCreateModal(true)}
            icon={<Plus className="w-4 h-4" />}
          >
            Generate Coupon
          </Button>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">Total Codes</span>
          <span className="text-2xl font-bold text-slate-900 tabular-nums">{totalCount}</span>
        </div>
        <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-xl flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-emerald-800">Active (Unredeemed)</span>
          <span className="text-2xl font-bold text-emerald-700 tabular-nums">{activeCount}</span>
        </div>
        <div className="p-4 bg-indigo-50/60 border border-indigo-200 rounded-xl flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-indigo-800">Redeemed</span>
          <span className="text-2xl font-bold text-indigo-700 tabular-nums">{usedCount}</span>
        </div>
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col gap-1">
          <span className="text-[11px] font-semibold text-slate-500">Redemption Rate</span>
          <span className="text-2xl font-bold text-slate-700 tabular-nums">
            {totalCount > 0 ? `${Math.round((usedCount / totalCount) * 100)}%` : '0%'}
          </span>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {/* Status Filter Tabs */}
        <div className="flex bg-slate-100 p-1 rounded-xl gap-1 text-xs">
          {[
            { id: 'all', label: 'All' },
            { id: 'active', label: 'Active' },
            { id: 'used', label: 'Redeemed' },
            { id: 'expired', label: 'Expired' },
            { id: 'revoked', label: 'Revoked' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1 rounded-lg font-medium transition-all cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative min-w-[240px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search code or description..."
            className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-xl text-xs focus:outline-hidden focus:border-indigo-500"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Data Table */}
      <div className="data-table-container">
        {loading && coupons.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">Loading coupons...</div>
        ) : coupons.length === 0 ? (
          <div className="p-12 text-center">
            <Ticket size={36} className="mx-auto mb-3 text-slate-300" />
            <div className="text-sm font-semibold text-slate-800 mb-1">No Coupons Found</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              {statusFilter !== 'all' || searchTerm
                ? 'No coupons match your filter or search criteria.'
                : 'Click "Generate Coupon" to create single or bulk one-time promo codes.'}
            </p>
            <Button size="sm" variant="primary" onClick={() => setShowCreateModal(true)}>
              Generate Your First Coupon
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Coupon Code</th>
                  <th>Discount Benefit</th>
                  <th>Limit / Uses</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Redeemed By</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => {
                  const badge = statusBadge(coupon.status);
                  const redemption = coupon.redemptions[0];

                  return (
                    <tr key={coupon.id}>
                      {/* Code */}
                      <td>
                        <div className="flex items-center gap-2">
                          <code className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                            {coupon.code}
                          </code>
                          <button
                            type="button"
                            onClick={() => handleCopyCode(coupon.code)}
                            className="p-1 text-slate-400 hover:text-indigo-600 rounded transition-colors cursor-pointer"
                            title="Copy code"
                          >
                            {copiedCode === coupon.code ? (
                              <Check size={13} className="text-emerald-600" />
                            ) : (
                              <Copy size={13} />
                            )}
                          </button>
                        </div>
                        {coupon.description && (
                          <div className="text-[11px] text-slate-400 mt-0.5 truncate max-w-xs" title={coupon.description}>
                            {coupon.description}
                          </div>
                        )}
                      </td>

                      {/* Benefit */}
                      <td>
                        <span className="font-semibold text-slate-800 text-xs">
                          {formatDiscount(coupon.extraTrialDays)}
                        </span>
                      </td>

                      {/* Limit / Uses */}
                      <td>
                        <div className="flex flex-col">
                          <span className="text-xs font-medium text-slate-700">
                            {coupon.usedCount} / {coupon.maxUses}
                          </span>
                          <span className="text-[10px] text-slate-400">One-Time Code</span>
                        </div>
                      </td>

                      {/* Status */}
                      <td>
                        <span
                          className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border inline-block"
                          style={{ background: badge.bg, color: badge.color, borderColor: badge.border }}
                        >
                          {badge.label}
                        </span>
                        {coupon.expiresAt && coupon.status === 'active' && (
                          <span className="block text-[10px] text-slate-400 mt-0.5">
                            Expires {formatDate(coupon.expiresAt)}
                          </span>
                        )}
                      </td>

                      {/* Created */}
                      <td>
                        <div className="flex flex-col text-xs text-slate-600">
                          <span className="tabular-nums">{formatDate(coupon.createdAt)}</span>
                          {coupon.createdByEmail && (
                            <span className="text-[10px] text-slate-400 truncate max-w-[120px]" title={coupon.createdByEmail}>
                              {coupon.createdByEmail}
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Redeemed By */}
                      <td>
                        {redemption ? (
                          <div className="flex flex-col text-xs">
                            <span className="font-semibold text-slate-800">
                              {redemption.tenantName || 'Tenant'}
                            </span>
                            <span className="text-[10px] text-slate-400 tabular-nums">
                              {formatDate(redemption.redeemedAt)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td style={{ textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleCopyCode(coupon.code)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                            title="Copy code"
                          >
                            <Copy size={13} />
                          </button>

                          {coupon.status === 'active' && (
                            <button
                              type="button"
                              onClick={() => handleRevoke(coupon.id)}
                              disabled={actionLoadingId === coupon.id}
                              className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                              title="Revoke coupon"
                            >
                              <Ban size={13} />
                            </button>
                          )}

                          {coupon.usedCount === 0 && coupon.status !== 'used' && (
                            <button
                              type="button"
                              onClick={() => handleDelete(coupon.id)}
                              disabled={actionLoadingId === coupon.id}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                              title="Delete unused coupon"
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Modal */}
      <CreateCouponModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => {
          load();
        }}
      />
    </section>
  );
};
