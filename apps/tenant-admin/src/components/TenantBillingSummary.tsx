import React, { useEffect, useState, useCallback } from 'react';
import { CreditCard, RefreshCw, AlertTriangle, Receipt, ExternalLink, Globe, Plus, Trash2, Check, ShieldCheck, Sparkles, Tag, X } from 'lucide-react';
import { api } from '../api';
import { DomainItem, TenantBillingSummary as TenantBillingSummaryType, InvoiceItem, DomainSubscriptionStatus, PaymentMethodItem } from '../types';
import { PaymentMethodUpdateForm } from './PaymentMethodUpdateForm';
import { PaymentMethodModal } from './PaymentMethodModal';

interface TenantBillingSummaryProps {
  domains: DomainItem[];
}

function statusBadge(status?: DomainSubscriptionStatus | null) {
  switch (status) {
    case 'trialing':
      return { label: 'Trial (60 Days Free)', bg: '#eef2ff', color: '#4338ca', border: '#c7d2fe' };
    case 'active':
      return { label: 'Active', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' };
    case 'grace':
    case 'past_due':
      return { label: 'Payment Issue', bg: '#fffbeb', color: '#b45309', border: '#fde68a' };
    case 'suspended':
      return { label: 'Suspended', bg: '#fff1f2', color: '#be123c', border: '#fecdd3' };
    case 'canceled':
      return { label: 'Canceled', bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0' };
    default:
      return { label: 'No Subscription', bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0' };
  }
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatAmount(paise: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency.toUpperCase() }).format(paise / 100);
}

function getCardBrandLabel(brand?: string) {
  switch (brand?.toLowerCase()) {
    case 'visa':
      return <span className="font-extrabold text-blue-700 italic tracking-tighter text-xs">VISA</span>;
    case 'mastercard':
      return <span className="font-bold text-amber-600 text-xs">Mastercard</span>;
    case 'amex':
      return <span className="font-bold text-sky-600 text-xs">AMEX</span>;
    case 'discover':
      return <span className="font-bold text-orange-600 text-xs">Discover</span>;
    default:
      return <CreditCard className="w-4 h-4 text-slate-500" />;
  }
}

/**
 * Tenant-wide billing summary for Tenant Home: every domain under this
 * tenant shares ONE combined Stripe subscription/invoice, so this shows the
 * shared status/next-charge once, a breakdown of which domains are on it,
 * the shared payment methods, and the tenant-wide invoice history.
 */
export const TenantBillingSummary: React.FC<TenantBillingSummaryProps> = ({ domains }) => {
  const [summary, setSummary] = useState<TenantBillingSummaryType | null>(null);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showPaymentModal, setShowAddPaymentModal] = useState(false);
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [paymentFormLoading, setPaymentFormLoading] = useState(false);
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Coupon state
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponFeedback, setCouponFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleRedeemCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponInput.trim()) return;
    setCouponLoading(true);
    setCouponFeedback(null);
    try {
      const res = await api.redeemCoupon(couponInput.trim(), domains[0]?.id);
      setCouponFeedback({ type: 'success', message: res.message });
      setCouponInput('');
      await load();
      setTimeout(() => {
        setShowCouponModal(false);
        setCouponFeedback(null);
      }, 2000);
    } catch (err: any) {
      setCouponFeedback({ type: 'error', message: err.message || 'Failed to redeem coupon' });
    } finally {
      setCouponLoading(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const configPromise = Promise.resolve()
        .then(() => api.getBillingConfig?.())
        .catch(() => ({ publishableKey: '', billingEnabled: true }));

      const invoicesPromise = Promise.resolve()
        .then(() => api.listBillingInvoices?.())
        .catch(() => ({ invoices: [] }));

      const paymentMethodsPromise = Promise.resolve()
        .then(() => api.listPaymentMethods?.())
        .catch(() => ({ paymentMethods: [], defaultPaymentMethodId: null }));

      const [summaryRes, invoicesRes, configRes, pmRes] = await Promise.all([
        api.getTenantBillingSummary(),
        invoicesPromise,
        configPromise,
        paymentMethodsPromise,
      ]);
      setSummary(summaryRes);
      setInvoices(invoicesRes?.invoices || []);
      setPaymentMethods(pmRes?.paymentMethods || []);
      if (configRes && configRes.billingEnabled !== undefined) {
        setBillingEnabled(configRes.billingEnabled);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load billing information.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleOpenPaymentForm = async () => {
    const anyDomainId = domains[0]?.id;
    if (!anyDomainId) return;
    setPaymentFormLoading(true);
    setPaymentFormError(null);
    try {
      const [configRes, setupRes] = await Promise.all([
        api.getBillingConfig(),
        api.createPaymentMethodSetupIntent(anyDomainId),
      ]);
      setPublishableKey(configRes.publishableKey);
      setSetupClientSecret(setupRes.clientSecret);
      setShowPaymentForm(true);
    } catch (err: any) {
      setPaymentFormError(err.message || 'Failed to open payment form.');
    } finally {
      setPaymentFormLoading(false);
    }
  };

  const handleSetDefault = async (pmId: string) => {
    setActionLoadingId(pmId);
    try {
      await api.setDefaultPaymentMethod(pmId);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to set default payment method.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteMethod = async (pmId: string) => {
    if (!window.confirm('Are you sure you want to remove this payment method?')) return;
    setActionLoadingId(pmId);
    try {
      await api.deletePaymentMethod(pmId);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to remove payment method.');
    } finally {
      setActionLoadingId(null);
    }
  };

  const badge = !billingEnabled
    ? { label: 'Active (Free Tier)', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' }
    : statusBadge(summary?.status);

  // Total mailboxes across all domains
  const totalActiveMailboxes = domains.reduce((sum, d) => sum + (d.mailboxCount || 0), 0);
  const totalMailboxLimit = domains.reduce((sum, d) => sum + (d.mailboxLimit || 0), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
            <CreditCard className="w-6 h-6 text-indigo-600" />
            <span>Billing</span>
          </h1>
          <p className="text-xs text-slate-500">
            {!billingEnabled
              ? 'Billing is bypassed — all domains and mailboxes have full access with no payment required.'
              : 'One combined bill covers every domain on this account.'}
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
          aria-label="Refresh"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {paymentFormError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span>{paymentFormError}</span>
        </div>
      )}

      {/* Subscription Status Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-slate-500">Subscription Status</span>
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full border"
            style={{ background: badge.bg, color: badge.color, borderColor: badge.border }}
          >
            {badge.label}
          </span>
        </div>

        {!summary?.hasSubscription && !loading && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-600 leading-relaxed">
              {!billingEnabled
                ? 'Billing is currently bypassed for your account. All domains and mailboxes have full access with no payment required.'
                : 'No domain has an active subscription yet. Every domain includes a 60-day free trial with ₹0 charged upfront. Add a payment method to prepare for automated consolidated billing.'}
            </p>
            {billingEnabled && (
              <div className="flex items-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddPaymentModal(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Payment Method</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowCouponModal(true)}
                  className="px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <Tag className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Redeem Promo Code</span>
                </button>
              </div>
            )}
          </div>
        )}

        {summary?.hasSubscription && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">
                  {!billingEnabled
                    ? 'Renewal / Expiry'
                    : summary.status === 'trialing'
                    ? 'Trial Ends (60 Days)'
                    : 'Next Charge'}
                </span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {!billingEnabled
                    ? 'Never (Free / Bypassed)'
                    : formatDate(summary.status === 'trialing' ? summary.trialEnd : summary.currentPeriodEnd)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Domains on this account</span>
                <span className="font-semibold text-slate-800 tabular-nums">{summary.domains.length}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Active Mailboxes (Usage)</span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {totalActiveMailboxes} {totalMailboxLimit ? `/ ${totalMailboxLimit}` : ''}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              {!showPaymentForm && billingEnabled && (
                <button
                  type="button"
                  onClick={() => setShowAddPaymentModal(true)}
                  className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Manage / Add Card</span>
                </button>
              )}
              {!showPaymentForm && billingEnabled && (
                <button
                  type="button"
                  onClick={() => setShowCouponModal(true)}
                  className="px-3.5 py-1.5 border border-indigo-200 hover:bg-indigo-50/50 rounded-lg text-[11px] font-semibold text-indigo-700 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Tag className="w-3.5 h-3.5" />
                  <span>Redeem Promo Code</span>
                </button>
              )}
              {!showPaymentForm && billingEnabled && (
                <button
                  type="button"
                  onClick={handleOpenPaymentForm}
                  disabled={paymentFormLoading}
                  className="px-3.5 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-[11px] font-semibold text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {paymentFormLoading ? 'Loading...' : 'Update Payment Method'}
                </button>
              )}
            </div>

            {showPaymentForm && publishableKey && setupClientSecret && (
              <div className="pt-3 border-t border-slate-100">
                <PaymentMethodUpdateForm
                  publishableKey={publishableKey}
                  clientSecret={setupClientSecret}
                  onDone={() => {
                    setShowPaymentForm(false);
                    load();
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Payment Methods Section */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <CreditCard size={15} className="text-indigo-600" />
            <h2 className="text-xs font-semibold text-slate-700">Payment Methods on File</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowAddPaymentModal(true)}
            className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
          >
            <Plus size={13} />
            <span>Add Card</span>
          </button>
        </div>

        {paymentMethods.length === 0 ? (
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-center">
            <p className="text-xs text-slate-500 mb-2">No payment methods saved.</p>
            <p className="text-[11px] text-slate-400 max-w-sm mx-auto mb-3">
              Add a payment method to ensure seamless renewal after your 60-day domain trials end.
            </p>
            <button
              type="button"
              onClick={() => setShowAddPaymentModal(true)}
              className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/60 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
            >
              Add a Card
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {paymentMethods.map((pm) => (
              <div
                key={pm.id}
                className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100/60 border border-slate-200 rounded-xl transition-colors text-xs"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-7 bg-white border border-slate-200 rounded-md flex items-center justify-center shrink-0">
                    {getCardBrandLabel(pm.brand)}
                  </div>
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900 tracking-wider">
                        •••• •••• •••• {pm.last4}
                      </span>
                      {pm.isDefault && (
                        <span className="text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded">
                          Default
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Expires {pm.expMonth}/{pm.expYear}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {!pm.isDefault && (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(pm.id)}
                      disabled={actionLoadingId === pm.id}
                      className="px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-indigo-600 hover:bg-white rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {actionLoadingId === pm.id ? 'Saving...' : 'Make Default'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeleteMethod(pm.id)}
                    disabled={actionLoadingId === pm.id}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                    title="Remove Card"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-domain breakdown */}
      {summary?.hasSubscription && summary.domains.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Globe size={14} className="text-slate-400" />
              <span className="text-xs font-semibold text-slate-500">Domains on this combined bill</span>
            </div>
            <span className="text-[11px] text-indigo-600 font-medium flex items-center gap-1">
              <Sparkles size={12} />
              60-Day Free Trial included per domain
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            {summary.domains.map((d) => (
              <div
                key={d.domainId}
                className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs"
              >
                <div className="flex flex-col">
                  <span className="font-semibold text-slate-800">{d.domainName}</span>
                  <span className="text-[10px] text-slate-400">
                    Metered per-mailbox billing · Pay only for mailboxes created
                  </span>
                </div>
                <div className="text-right">
                  <span className="font-medium text-slate-700 block">
                    {d.planName || 'Standard'}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {d.seatCount != null ? `${d.seatCount} seats allocated` : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Invoices */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
        <div className="flex items-center gap-2 mb-3">
          <Receipt size={14} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-500">Invoice History</span>
        </div>
        {invoices.length === 0 ? (
          <p className="text-xs text-slate-400">No invoices yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              >
                <div className="flex items-center gap-3">
                  <span className="text-slate-500 tabular-nums">{formatDate(inv.createdAt)}</span>
                  <span className="font-semibold text-slate-800 tabular-nums">{formatAmount(inv.amountPaid, inv.currency)}</span>
                  <span className="text-[10px] uppercase text-slate-400">{inv.status}</span>
                </div>
                {inv.hostedInvoiceUrl && (
                  <a
                    href={inv.hostedInvoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-indigo-600 hover:text-indigo-700 text-[11px] font-medium"
                  >
                    View
                    <ExternalLink size={11} />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add / Manage Payment Method Modal */}
      <PaymentMethodModal
        isOpen={showPaymentModal}
        onClose={() => setShowAddPaymentModal(false)}
        onSuccess={() => {
          load();
        }}
        title="Payment Methods"
      />

      {/* Redeem Coupon Modal */}
      {showCouponModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Tag className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Redeem Promo Code</h3>
                  <p className="text-[11px] text-slate-500">Apply one-time coupons for extended trials or credits</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCouponModal(false);
                  setCouponFeedback(null);
                }}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRedeemCoupon} className="p-6 flex flex-col gap-4 text-xs">
              {couponFeedback && (
                <div
                  className={`p-3 rounded-xl border flex items-center gap-2 ${
                    couponFeedback.type === 'success'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border-rose-200 text-rose-700'
                  }`}
                >
                  {couponFeedback.type === 'success' ? (
                    <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0" />
                  )}
                  <span>{couponFeedback.message}</span>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="font-semibold text-slate-700">Coupon Code</label>
                <input
                  type="text"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                  placeholder="e.g. STARTUP60"
                  className="px-3 py-2 border border-slate-300 rounded-xl font-mono text-xs uppercase focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowCouponModal(false);
                    setCouponFeedback(null);
                  }}
                  className="px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={couponLoading || !couponInput.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  {couponLoading ? 'Redeeming...' : 'Redeem Code'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

