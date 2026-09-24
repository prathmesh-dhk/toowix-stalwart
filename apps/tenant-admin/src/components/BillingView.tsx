import React, { useEffect, useState, useCallback } from 'react';
import {
  CreditCard,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Receipt,
  ExternalLink,
  ShoppingCart,
  XCircle,
  Globe,
  Plus,
  Trash2,
  Sparkles,
  Tag,
  Check,
  X,
  ShieldCheck,
  Clock,
  Users,
} from 'lucide-react';
import { api } from '../api';
import { CartData, DomainItem, InvoiceItem, PaymentMethodItem, Plan, TenantBillingSummary } from '../types';
import { PaymentMethodModal } from './PaymentMethodModal';
import { formatPaise } from './cart/format';

export interface BillingViewProps {
  domains?: DomainItem[];
  cart?: CartData | null;
  onOpenCart?: () => void;
  onCartUpdated?: (cart: CartData) => void;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatAmount(paise: number, currency: string): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency.toUpperCase() }).format(paise / 100);
}

function getCardBrandBadge(brand?: string) {
  const b = brand?.toLowerCase();
  switch (b) {
    case 'visa':
      return <span className="font-black text-blue-700 italic tracking-tighter text-xs">VISA</span>;
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
 * Enterprise-grade company-wide billing dashboard.
 * Unified model: one master Stripe subscription, one card with RBI e-mandate,
 * one 60-day trial across all domains, and automatic usage billing per active mailbox.
 */
export const BillingView: React.FC<BillingViewProps> = ({
  domains: propDomains,
  cart: propCart,
  onOpenCart,
  onCartUpdated,
}) => {
  const [summary, setSummary] = useState<TenantBillingSummary | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodItem[]>([]);
  const [internalCart, setInternalCart] = useState<CartData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showCardModal, setShowCardModal] = useState(false);

  // Promo code modal state
  const [showCouponModal, setShowCouponModal] = useState(false);
  const [couponInput, setCouponInput] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponFeedback, setCouponFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const cart = propCart ?? internalCart;

  const handleOpenCart = useCallback(() => {
    if (onOpenCart) {
      onOpenCart();
    } else if (typeof window !== 'undefined') {
      window.history.pushState({}, '', '/cart');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, [onOpenCart]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const invoicesPromise = Promise.resolve()
        .then(() => (api.listBillingInvoices ? api.listBillingInvoices() : { invoices: [] as InvoiceItem[] }))
        .catch(() => ({ invoices: [] as InvoiceItem[] }));

      const pmPromise = Promise.resolve()
        .then(() => (api.listPaymentMethods ? api.listPaymentMethods() : { paymentMethods: [] as PaymentMethodItem[], defaultPaymentMethodId: null }))
        .catch(() => ({ paymentMethods: [] as PaymentMethodItem[], defaultPaymentMethodId: null }));

      const plansPromise = Promise.resolve()
        .then(() => (api.listPlans ? api.listPlans() : { plans: [] as Plan[] }))
        .catch(() => ({ plans: [] as Plan[] }));

      const cartPromise = Promise.resolve()
        .then(() => (api.getCart ? api.getCart() : null))
        .catch(() => null);

      const summaryPromise = Promise.resolve()
        .then(() => (api.getTenantBillingSummary ? api.getTenantBillingSummary() : null))
        .catch(() => null);

      const [summaryRes, plansRes, invoicesRes, pmRes, cartRes] = await Promise.all([
        summaryPromise,
        plansPromise,
        invoicesPromise,
        pmPromise,
        cartPromise,
      ]);

      if (summaryRes) setSummary(summaryRes);
      if (plansRes?.plans) setPlans(plansRes.plans);
      if (invoicesRes?.invoices) setInvoices(invoicesRes.invoices);
      if (pmRes?.paymentMethods) setPaymentMethods(pmRes.paymentMethods);
      if (cartRes) {
        setInternalCart(cartRes);
        onCartUpdated?.(cartRes);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load billing information.');
    } finally {
      setLoading(false);
    }
  }, [onCartUpdated]);

  useEffect(() => {
    load();
  }, [load]);

  const changeCard = async () => {
    setActionLoading('card');
    setError(null);
    try {
      const res = await api.startCardUpdate();
      if ('url' in res) {
        window.location.href = res.url;
        return;
      }
      setShowCardModal(true);
    } catch (err: any) {
      setError(err?.message || 'Could not open the card screen.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetDefaultPaymentMethod = async (pmId: string) => {
    setActionLoading(`pm-def-${pmId}`);
    try {
      await api.setDefaultPaymentMethod(pmId);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to set default payment method.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeletePaymentMethod = async (pmId: string) => {
    if (!window.confirm('Remove this payment method from your organization?')) return;
    setActionLoading(`pm-del-${pmId}`);
    try {
      await api.deletePaymentMethod(pmId);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to remove payment method.');
    } finally {
      setActionLoading(null);
    }
  };

  const changePlan = async (domainId: string, planId: string) => {
    const domain = cart?.domains.find((d) => d.domainId === domainId);
    const current = plans.find((p) => p.id === domain?.planId);
    const target = plans.find((p) => p.id === planId);
    if (!target) return;
    setActionLoading(`plan-${domainId}`);
    setError(null);
    try {
      if (!current || target.seatCount > current.seatCount) {
        await api.upgradeDomainPlan(domainId, planId);
      } else {
        await api.downgradeDomainPlan(domainId, planId);
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to change plan.');
    } finally {
      setActionLoading(null);
    }
  };

  const cancelAll = async () => {
    if (!window.confirm('Cancel your Toowix subscription at the end of the current billing period? This applies to all domains.')) {
      return;
    }
    setActionLoading('cancel');
    setError(null);
    try {
      for (const d of cart?.domains || []) {
        await api.cancelDomainSubscription(d.domainId).catch(() => undefined);
      }
      if (api.cancelTenantSubscription) {
        await api.cancelTenantSubscription().catch(() => undefined);
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel subscription.');
    } finally {
      setActionLoading(null);
    }
  };

  const resumeSubscription = async () => {
    setActionLoading('resume');
    setError(null);
    try {
      if (api.resumeTenantSubscription) {
        await api.resumeTenantSubscription();
      }
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to resume subscription.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRedeemCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponInput.trim()) return;
    setCouponLoading(true);
    setCouponFeedback(null);
    try {
      const res = await api.redeemCoupon(couponInput.trim());
      setCouponFeedback({ type: 'success', message: res.message });
      setCouponInput('');
      await load();
      setTimeout(() => {
        setShowCouponModal(false);
        setCouponFeedback(null);
      }, 2000);
    } catch (err: any) {
      setCouponFeedback({ type: 'error', message: err?.message || 'Failed to redeem promo code' });
    } finally {
      setCouponLoading(false);
    }
  };

  const trial = cart?.trial;
  const status = summary?.status;
  const paymentIssue = status === 'past_due' || status === 'grace';
  const suspended = status === 'suspended';
  const isCanceling = Boolean(summary?.cancelAtPeriodEnd);

  // Domains list: prefer cart domains; fallback to summary domains or propDomains
  const domainsList =
    cart?.domains && cart.domains.length > 0
      ? cart.domains
      : summary?.domains && summary.domains.length > 0
      ? summary.domains.map((d) => ({
          domainId: d.domainId,
          domainName: d.domainName,
          planId: (d as any).planId || '',
          planName: d.planName || 'Standard',
          maxUsers: d.seatCount ?? 0,
          activeUsers: d.seatCount ?? 0,
          pendingUsers: 0,
          ratePaise: 0,
          monthlyPaise: 0,
        }))
      : (propDomains || []).map((d) => ({
          domainId: d.id,
          domainName: d.domainName,
          planId: d.planId || '',
          planName: d.planName || 'Standard',
          maxUsers: d.mailboxLimit ?? 0,
          activeUsers: d.mailboxCount ?? 0,
          pendingUsers: 0,
          ratePaise: 0,
          monthlyPaise: 0,
        }));
  const totalActiveUsers = domainsList.reduce((sum, d) => sum + (d.activeUsers || 0), 0);
  const totalMailboxLimit = domainsList.reduce((sum, d) => sum + (d.maxUsers || 0), 0);
  const usagePercentage = totalMailboxLimit > 0 ? Math.min(100, Math.round((totalActiveUsers / totalMailboxLimit) * 100)) : 0;

  return (
    <div className="flex flex-col gap-6 font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <span>Billing</span>
              </h1>
              <p className="text-xs text-slate-500">
                One combined bill covers every domain on this account.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setShowCouponModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 transition-colors shadow-2xs cursor-pointer"
          >
            <Tag className="w-3.5 h-3.5 text-indigo-600" />
            <span>Redeem Promo</span>
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 transition-colors cursor-pointer disabled:opacity-50"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-indigo-600' : ''} />
          </button>
        </div>
      </div>

      {/* Critical Alert Banners */}
      {error && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{error}</div>
        </div>
      )}

      {paymentIssue && (
        <div className="flex items-start justify-between gap-3 text-amber-900 bg-amber-50 border border-amber-200 p-3.5 rounded-xl text-xs">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong>Payment failed.</strong> We couldn't process your payment method. Mail keeps working for now — update your card to avoid interruption.
            </div>
          </div>
          <button
            type="button"
            onClick={changeCard}
            className="shrink-0 px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer"
          >
            Update Card
          </button>
        </div>
      )}

      {suspended && (
        <div className="flex items-center justify-between gap-3 text-rose-800 bg-rose-50 border border-rose-200 p-3.5 rounded-xl text-xs">
          <div className="flex items-center gap-2.5">
            <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Mail service is suspended due to non-payment. Update your card to restore it.</span>
          </div>
          <button
            type="button"
            onClick={changeCard}
            className="shrink-0 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer"
          >
            Resolve Payment
          </button>
        </div>
      )}

      {isCanceling && (
        <div className="flex items-center justify-between gap-3 text-slate-800 bg-slate-100 border border-slate-200 p-3.5 rounded-xl text-xs">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Cancels at the end of the current period ({formatDate(summary?.currentPeriodEnd)}).</span>
          </div>
          <button
            type="button"
            onClick={resumeSubscription}
            disabled={actionLoading === 'resume'}
            className="shrink-0 px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {actionLoading === 'resume' ? 'Resuming…' : 'Resume subscription'}
          </button>
        </div>
      )}

      {/* 4-Card Hero Metric Grid */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <div>
          <span className="text-slate-400 block mb-0.5">Status</span>
          <span className="font-semibold text-slate-800">
            {!trial?.started ? 'Not started' : trial.isTrialing ? '60-day trial' : paymentIssue ? 'Payment issue' : suspended ? 'Suspended' : 'Active'}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block mb-0.5">{trial?.isTrialing ? 'Trial ends' : 'Next billing date'}</span>
          <span className="font-semibold text-slate-800 tabular-nums">
            {trial?.isTrialing ? formatDate(trial.endsAt) : formatDate(summary?.currentPeriodEnd)}
          </span>
        </div>
        <div>
          <span className="text-slate-400 block mb-0.5">Estimated monthly bill</span>
          <span className="font-semibold text-slate-800 tabular-nums">{formatPaise(cart?.estimatedMonthlyPaise ?? 0)}</span>
        </div>
        <div>
          <span className="text-slate-400 block mb-0.5">Payment method</span>
          <span className="font-semibold text-slate-800">
            {cart?.paymentMethod ? `${cart.paymentMethod.brand} •••• ${cart.paymentMethod.last4}` : '—'}
          </span>
        </div>
        <div className="col-span-2 sm:col-span-4 flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 mt-1">
          {cart?.requiresActivation && (
            <button
              type="button"
              onClick={handleOpenCart}
              className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-semibold cursor-pointer inline-flex items-center gap-1.5"
            >
              <ShoppingCart size={13} />
              <span>
                Activate {cart.pendingMailboxes.length} waiting mailbox{cart.pendingMailboxes.length === 1 ? '' : 'es'}
              </span>
            </button>
          )}
          {trial?.started && (
            <button
              type="button"
              onClick={changeCard}
              disabled={actionLoading === 'card'}
              className="px-3.5 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-[11px] font-semibold text-slate-700 cursor-pointer disabled:opacity-50"
            >
              Change payment method
            </button>
          )}
          {trial?.started && !summary?.cancelAtPeriodEnd && (
            <button
              type="button"
              onClick={cancelAll}
              disabled={actionLoading === 'cancel'}
              className="px-3.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 rounded-lg cursor-pointer disabled:opacity-50"
            >
              {actionLoading === 'cancel' ? 'Canceling…' : 'Cancel subscription'}
            </button>
          )}
          {summary?.cancelAtPeriodEnd && (
            <span className="text-[11px] text-slate-500">Cancels at the end of the current period ({formatDate(summary.currentPeriodEnd)}).</span>
          )}
        </div>
      </div>

      {/* Domains & Assigned Plans Section */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">Domains &amp; plans</span>
          <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">
            Pay only for active mailboxes · Plan caps maximum seats
          </span>
        </div>

        {domainsList.length === 0 ? (
          <p className="text-xs text-slate-400">No domains yet.</p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {domainsList.map((d) => (
              <div
                key={d.domainId}
                className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <span className="font-semibold text-slate-800 block truncate">{d.domainName}</span>
                  <span className="text-slate-500">
                    {d.planName || 'No plan'} · {d.activeUsers + (d.pendingUsers || 0)} / {d.maxUsers} users · {formatPaise(d.ratePaise)} per active user
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="tabular-nums font-semibold text-slate-800">{formatPaise(d.monthlyPaise)}/mo</span>
                  <select
                    aria-label={`Change plan for ${d.domainName}`}
                    value={d.planId || ''}
                    disabled={actionLoading === `plan-${d.domainId}`}
                    onChange={(e) => e.target.value && e.target.value !== d.planId && changePlan(d.domainId, e.target.value)}
                    className="px-2.5 py-1 border border-slate-200 rounded-lg text-[11px] text-slate-700 bg-white hover:border-slate-300 focus:outline-none focus:border-indigo-600 cursor-pointer disabled:opacity-50"
                  >
                    {!d.planId && <option value="">Select plan</option>}
                    {plans
                      .filter((p) => p.isActive)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (up to {p.seatCount})
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

        <p className="text-[11px] text-slate-400 flex items-start gap-1.5 pt-1">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
          <span>Plan limits cap how many users a domain can have — you're only billed for users who are actually active.</span>
        </p>
      </div>

      {/* Payment Methods Section */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard size={15} className="text-indigo-600" />
            <h2 className="text-xs font-semibold text-slate-700">Payment Methods on File</h2>
          </div>
          <button
            type="button"
            onClick={changeCard}
            className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
          >
            <Plus size={13} />
            <span>Add / Change Card</span>
          </button>
        </div>

        {paymentMethods.length === 0 && !cart?.paymentMethod ? (
          <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-center">
            <p className="text-xs text-slate-500 mb-1">No payment methods saved.</p>
            <p className="text-[11px] text-slate-400 max-w-sm mx-auto mb-3">
              Add a payment method to ensure seamless renewal after your 60-day domain trial ends.
            </p>
            <button
              type="button"
              onClick={changeCard}
              className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
            >
              Add Card
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {paymentMethods.length > 0 ? (
              paymentMethods.map((pm) => (
                <div
                  key={pm.id}
                  className="flex items-center justify-between p-3 bg-slate-50 hover:bg-slate-100/60 border border-slate-200 rounded-xl transition-colors text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-7 bg-white border border-slate-200 rounded-md flex items-center justify-center shrink-0">
                      {getCardBrandBadge(pm.brand)}
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
                        onClick={() => handleSetDefaultPaymentMethod(pm.id)}
                        disabled={actionLoading === `pm-def-${pm.id}`}
                        className="px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:text-indigo-600 hover:bg-white rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {actionLoading === `pm-def-${pm.id}` ? 'Saving...' : 'Make Default'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeletePaymentMethod(pm.id)}
                      disabled={actionLoading === `pm-del-${pm.id}`}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                      title="Remove Card"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              // Fallback preview from cart
              cart?.paymentMethod && (
                <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-7 bg-white border border-slate-200 rounded-md flex items-center justify-center shrink-0">
                      {getCardBrandBadge(cart.paymentMethod.brand)}
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900 tracking-wider">
                          •••• •••• •••• {cart.paymentMethod.last4}
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded">
                          Default
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400">Autopay card on file</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={changeCard}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
                  >
                    Change card
                  </button>
                </div>
              )
            )}
          </div>
        )}

        <p className="text-[10px] text-slate-400 flex items-center gap-1.5 pt-1">
          <ShieldCheck size={12} className="text-slate-400 shrink-0" />
          <span>Transactions protected with bank-grade 256-bit encryption. Recurring billing adheres to RBI e-mandate guidelines.</span>
        </p>
      </div>

      {/* Invoices History */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Receipt size={14} className="text-slate-400" />
          <span className="text-xs font-semibold text-slate-500">Billing history</span>
        </div>
        {invoices.length === 0 ? (
          <p className="text-xs text-slate-400">No invoices yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs">
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

      {/* Payment Method Modal */}
      <PaymentMethodModal
        isOpen={showCardModal}
        onClose={() => setShowCardModal(false)}
        title="Change payment method"
        onSuccess={() => {
          setShowCardModal(false);
          load();
        }}
      />

      {/* Promo Code Modal */}
      {showCouponModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="relative w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Tag className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Redeem Promo Code</h3>
                  <p className="text-[11px] text-slate-500">Apply promotional coupons for extended trial days</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowCouponModal(false);
                  setCouponFeedback(null);
                }}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
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
