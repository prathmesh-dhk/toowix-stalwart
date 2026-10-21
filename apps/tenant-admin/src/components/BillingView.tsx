import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
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
  Tag,
  Check,
  X,
  ShieldCheck,
  Clock,
  Users,
  Search,
  ArrowRight,
  HardDrive,
} from 'lucide-react';
import { api } from '../api';
import { CartData, DomainItem, InvoiceItem, PaymentMethodItem, Plan, TenantBillingSummary } from '../types';
import { PaymentMethodModal } from './PaymentMethodModal';
import { formatDate, formatPaise } from './cart/format';
import { BillingDomain, DomainBillingRow } from './DomainBillingRow';
import { ChangePlanDialog } from './ChangePlanDialog';
import { CancelDomainDialog } from './CancelDomainDialog';
import { StatusBadge } from './ui/StatusBadge';

export interface BillingViewProps {
  activeDomain?: DomainItem | null;
  domains?: DomainItem[];
  cart?: CartData | null;
  onOpenCart?: () => void;
  onCartUpdated?: (cart: CartData) => void;
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
 * Enterprise-grade company-wide and domain-scoped billing dashboard.
 * - When activeDomain is passed: focused specifically on that domain's tier, usage, and quota.
 * - When activeDomain is omitted: shows the organization-wide master billing ledger.
 */
export const BillingView: React.FC<BillingViewProps> = ({
  activeDomain,
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
  const [domainSearchQuery, setDomainSearchQuery] = useState('');
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [changingPlanFor, setChangingPlanFor] = useState<BillingDomain | null>(null);
  const [cancellingDomain, setCancellingDomain] = useState<BillingDomain | null>(null);

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

  // A ref, so a parent passing a new callback each render doesn't re-run load (which clears error) in a loop.
  const onCartUpdatedRef = useRef(onCartUpdated);
  onCartUpdatedRef.current = onCartUpdated;

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

      const configPromise = Promise.resolve()
        .then(() => api.getBillingConfig())
        .catch(() => null);

      const [summaryRes, plansRes, invoicesRes, pmRes, cartRes, configRes] = await Promise.all([
        summaryPromise,
        plansPromise,
        invoicesPromise,
        pmPromise,
        cartPromise,
        configPromise,
      ]);

      if (summaryRes) setSummary(summaryRes);
      setBillingEnabled(Boolean(configRes?.billingEnabled));
      if (plansRes?.plans) setPlans(plansRes.plans);
      if (invoicesRes?.invoices) setInvoices(invoicesRes.invoices);
      if (pmRes?.paymentMethods) setPaymentMethods(pmRes.paymentMethods);
      if (cartRes) {
        setInternalCart(cartRes);
        onCartUpdatedRef.current?.(cartRes);
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to load billing information.');
    } finally {
      setLoading(false);
    }
  }, []);

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

  const cancelAll = async () => {
    if (!window.confirm('Cancel your Toowix subscription at the end of the current billing period? This applies to all domains.')) {
      return;
    }
    setActionLoading('cancel');
    setError(null);
    try {
      await api.cancelTenantSubscription();
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel subscription.');
    } finally {
      setActionLoading(null);
    }
  };

  const keepCurrentPlan = async (domainId: string) => {
    if (actionLoading) return;
    setActionLoading(`keep-${domainId}`);
    setError(null);
    try {
      await api.keepCurrentPlan(domainId);
      await load();
    } catch (err: any) {
      setError(err?.message || 'Failed to keep the current plan.');
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
  const domainsList = useMemo((): BillingDomain[] => {
    if (cart?.domains && cart.domains.length > 0) return cart.domains;
    if (summary?.domains && summary.domains.length > 0) {
      return summary.domains.map((d) => ({
        domainId: d.domainId,
        domainName: d.domainName,
        planId: d.planId,
        planName: d.planName || 'Standard',
        maxUsers: d.maxUsers,
        activeUsers: d.activeUserCount,
        pendingUsers: 0,
        ratePaise: d.pricePerUserMonthlyPaise,
        monthlyPaise: d.monthlySubtotalPaise,
      }));
    }
    return (propDomains || []).map((d) => ({
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
  }, [cart?.domains, summary?.domains, propDomains]);

  const filteredDomains = useMemo(() => {
    if (!domainSearchQuery.trim()) return domainsList;
    const q = domainSearchQuery.toLowerCase().trim();
    return domainsList.filter(
      (d) => d.domainName.toLowerCase().includes(q) || (d.planName && d.planName.toLowerCase().includes(q))
    );
  }, [domainsList, domainSearchQuery]);

  const totalActiveUsers = useMemo(() => domainsList.reduce((sum, d) => sum + (d.activeUsers || 0), 0), [domainsList]);
  const totalMailboxLimit = useMemo(() => domainsList.reduce((sum, d) => sum + (d.maxUsers || 0), 0), [domainsList]);

  // Specific domain item when viewing inside a domain
  const targetDomainData = useMemo(() => {
    if (!activeDomain) return null;
    return (
      domainsList.find(
        (d) =>
          d.domainId === activeDomain.id ||
          d.domainName.toLowerCase() === activeDomain.domainName.toLowerCase()
      ) || {
        domainId: activeDomain.id,
        domainName: activeDomain.domainName,
        planId: activeDomain.planId || '',
        planName: activeDomain.planName || 'Standard',
        maxUsers: activeDomain.mailboxLimit ?? 10,
        activeUsers: activeDomain.mailboxCount ?? 0,
        pendingUsers: 0,
        ratePaise: 0,
        monthlyPaise: 0,
      }
    );
  }, [activeDomain, domainsList]);

  const targetDomainPlan = useMemo(() => {
    if (!targetDomainData?.planId) return null;
    return plans.find((p) => p.id === targetDomainData.planId) || null;
  }, [targetDomainData, plans]);

  // Plan changes need a billed subscription: with billing on, the summary lists exactly the billed domains
  // (plus those cancelled on their own, which can be billed again).
  const billedDomain = (domainId: string) => (billingEnabled ? summary?.domains.find((s) => s.domainId === domainId) : undefined);
  const rowBilling = (d: BillingDomain) => {
    const billed = billedDomain(d.domainId);
    if (!billed) return {};
    // Price and count the dialog against what the subscription bills, not the cart's live counts.
    const asBilled = { ...d, ratePaise: billed.pricePerUserMonthlyPaise, activeUsers: billed.activeUserCount };
    if (billed.cancelled) return { cancelled: true, onChooseAgain: () => setChangingPlanFor(asBilled) };
    return {
      pendingDowngrade: billed.pendingDowngrade,
      onChangePlan: () => setChangingPlanFor(asBilled),
      onKeepCurrentPlan: () => keepCurrentPlan(d.domainId),
      onCancel: () => setCancellingDomain(d),
    };
  };
  const domainDialogs = (
    <>
      {changingPlanFor && (
        <ChangePlanDialog
          domain={changingPlanFor}
          plans={plans}
          currentPeriodEnd={summary?.currentPeriodEnd ?? null}
          trialing={summary?.status === 'trialing'}
          chooseAgain={billedDomain(changingPlanFor.domainId)?.cancelled}
          onClose={() => setChangingPlanFor(null)}
          onChanged={() => {
            setChangingPlanFor(null);
            load();
          }}
        />
      )}
      {cancellingDomain && (
        <CancelDomainDialog
          domain={cancellingDomain}
          otherDomainsBilled={!!summary?.domains.some((s) => !s.cancelled && s.domainId !== cancellingDomain.domainId)}
          currentPeriodEnd={summary?.currentPeriodEnd ?? null}
          onClose={() => setCancellingDomain(null)}
          onCancelled={() => {
            setCancellingDomain(null);
            load();
          }}
        />
      )}
    </>
  );

  // Primary payment method label
  const primaryPaymentMethodText = useMemo(() => {
    if (paymentMethods.length > 0) {
      const def = paymentMethods.find((p) => p.isDefault) || paymentMethods[0];
      return `${def.brand?.toLowerCase() || 'card'} •••• ${def.last4}`;
    }
    if (cart?.paymentMethod) {
      return `${cart.paymentMethod.brand?.toLowerCase() || 'card'} •••• ${cart.paymentMethod.last4}`;
    }
    return null;
  }, [paymentMethods, cart?.paymentMethod]);

  // ===========================================================================
  // SCOPED VIEW: WHEN VIEWING BILLING INSIDE A SPECIFIC DOMAIN
  // ===========================================================================
  if (activeDomain && targetDomainData) {
    const used = targetDomainData.activeUsers + (targetDomainData.pendingUsers || 0);
    const max = targetDomainData.maxUsers || 1;
    const pct = Math.min(100, Math.round((used / max) * 100));

    return (
      <div className="flex flex-col gap-6 font-sans">
        {/* Domain-Scoped Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">Billing</h1>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {activeDomain.domainName}
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Subscription tier, mailbox quota, and monthly charges for this domain.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <a
              href="/billing"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, '', '/billing');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 transition-colors shadow-2xs cursor-pointer min-h-[38px]"
            >
              <span>Organization Billing</span>
              <ArrowRight size={13} className="text-slate-400" />
            </a>

            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 transition-colors cursor-pointer disabled:opacity-50 min-h-[38px] min-w-[38px] flex items-center justify-center"
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin text-indigo-600' : ''} />
            </button>
          </div>
        </div>

        {/* Critical Alert Banners */}
        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5 shadow-2xs">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{error}</div>
          </div>
        )}

        {paymentIssue && (
          <div className="flex items-start justify-between gap-3 text-amber-900 bg-amber-50 border border-amber-200 p-4 rounded-xl text-xs shadow-2xs">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <strong>Payment issue on organization account.</strong> Update card details to avoid service interruptions for {activeDomain.domainName}.
              </div>
            </div>
            <button
              type="button"
              onClick={changeCard}
              className="shrink-0 px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer shadow-2xs"
            >
              Update Card
            </button>
          </div>
        )}

        {/* 4-Card Domain Metric Ribbon */}
        <DomainBillingRow domain={targetDomainData} layout="tiles" plan={targetDomainPlan} {...rowBilling(targetDomainData)} />
        {domainDialogs}

        {/* Quota & Resource Allocation Card */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Active Users &amp; User Limit</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Resource and mailbox provisioning limits for {activeDomain.domainName} under the {targetDomainPlan?.name || targetDomainData.planName || 'Standard'} plan.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg tabular-nums">
              {pct}% Utilized
            </span>
          </div>

          {/* Capacity Progress Bar */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-slate-700 font-medium">
              <span>
                Active mailboxes: <strong>{used}</strong> of <strong>{targetDomainData.maxUsers}</strong>
              </span>
              <span className="text-slate-400">
                {Math.max(0, targetDomainData.maxUsers - used)} left under the user limit
              </span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  pct >= 90 ? 'bg-amber-500' : 'bg-indigo-600'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>

          {/* Allocation Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-2">
            <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/80 text-xs">
              <div className="flex items-center gap-2 text-slate-900 font-semibold mb-1">
                <Users size={14} className="text-indigo-600" />
                <span>Active Users</span>
              </div>
              <p className="text-slate-500 leading-relaxed">
                Currently <strong>{used}</strong> provisioned mailbox accounts are billed at {formatPaise(targetDomainData.ratePaise)} per Active User.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/80 text-xs">
              <div className="flex items-center gap-2 text-slate-900 font-semibold mb-1">
                <HardDrive size={14} className="text-indigo-600" />
                <span>Storage Allocation</span>
              </div>
              <p className="text-slate-500 leading-relaxed">
                <strong>{targetDomainPlan?.storageQuotaGb || 10} GB</strong> dedicated mailbox storage quota per mailbox account.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50/70 border border-slate-200/80 text-xs">
              <div className="flex items-center gap-2 text-slate-900 font-semibold mb-1">
                <ShieldCheck size={14} className="text-emerald-600" />
                <span>Security &amp; Protocols</span>
              </div>
              <p className="text-slate-500 leading-relaxed">
                Automated DKIM, SPF, and DMARC verification included with advanced anti-spam protection.
              </p>
            </div>
          </div>
        </section>

        {/* Master Account Billing Coverage & Card Section */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <CreditCard size={15} className="text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-900">Organization Master Subscription</h2>
            </div>
            <button
              type="button"
              onClick={changeCard}
              disabled={actionLoading === 'card'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-indigo-600 hover:text-indigo-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
            >
              <CreditCard size={13} />
              <span>Change payment method</span>
            </button>
          </div>

          <div className="p-4 bg-slate-50/80 border border-slate-200/80 rounded-xl text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-slate-900">Master Account Autopay</span>
                {primaryPaymentMethodText ? (
                  <span className="text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full">
                    {primaryPaymentMethodText}
                  </span>
                ) : (
                  <span className="text-[10px] font-medium text-slate-400">No card on file</span>
                )}
              </div>
              <p className="text-slate-500 max-w-lg leading-relaxed">
                {billedDomain(targetDomainData.domainId)?.cancelled
                  ? `${activeDomain.domainName} is cancelled and not on your organization bill.`
                  : `${activeDomain.domainName} is covered under your company master subscription. Charges (${formatPaise(targetDomainData.monthlyPaise)}/mo) are automatically consolidated on your organization bill.`}
              </p>
            </div>

            <a
              href="/billing"
              onClick={(e) => {
                e.preventDefault();
                window.history.pushState({}, '', '/billing');
                window.dispatchEvent(new PopStateEvent('popstate'));
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 shrink-0"
            >
              <span>View All Domains &amp; Invoices</span>
              <ArrowRight size={13} />
            </a>
          </div>

          <div className="text-[10px] text-slate-400 flex items-center gap-1.5 pt-1">
            <ShieldCheck size={13} className="text-slate-400 shrink-0" />
            <span>Recurring billing adheres to RBI e-mandate guidelines with bank-grade 256-bit encryption.</span>
          </div>
        </section>

        {/* Payment Method Modal */}
        <PaymentMethodModal
          isOpen={showCardModal}
          onClose={() => setShowCardModal(false)}
          title="Payment Method"
          onSuccess={() => {
            setShowCardModal(false);
            load();
          }}
        />
      </div>
    );
  }

  // ===========================================================================
  // ORGANIZATION-WIDE VIEW: WHEN VIEWING COMPANY BILLING AT /billing
  // ===========================================================================
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
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Billing</h1>
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-semibold text-slate-700 transition-colors shadow-2xs cursor-pointer min-h-[38px]"
          >
            <Tag className="w-3.5 h-3.5 text-indigo-600" />
            <span>Redeem Promo</span>
          </button>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 transition-colors cursor-pointer disabled:opacity-50 min-h-[38px] min-w-[38px] flex items-center justify-center"
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin text-indigo-600' : ''} />
          </button>
        </div>
      </div>

      {/* Critical Alert Banners */}
      {error && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 flex items-start gap-2.5 shadow-2xs">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="flex-1 font-medium">{error}</div>
        </div>
      )}

      {summary?.paymentActionUrl && !suspended && (
        <div className="flex items-start justify-between gap-3 text-amber-900 bg-amber-50 border border-amber-200 p-4 rounded-xl text-xs shadow-2xs">
          <div className="flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong>Your bank needs you to approve this payment.</strong> Complete the 3-D Secure check to pay your invoice. Mail keeps working for now.
            </div>
          </div>
          <a
            href={summary.paymentActionUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 inline-flex items-center gap-1 px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer shadow-2xs"
          >
            Authenticate payment <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      )}

      {paymentIssue && !summary?.paymentActionUrl && (
        <div className="flex items-start justify-between gap-3 text-amber-900 bg-amber-50 border border-amber-200 p-4 rounded-xl text-xs shadow-2xs">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="leading-relaxed">
              <strong>Payment failed.</strong>{' '}
              {summary?.gracePeriodEndsAt
                ? // Past the end but not yet suspended: the grace sweep runs every 15 minutes.
                  `Mail stops ${new Date(summary.gracePeriodEndsAt) <= new Date() ? 'today' : `on ${formatDate(summary.gracePeriodEndsAt)}`} unless you pay.`
                : "We couldn't process your payment method. Mail keeps working for now — update your card to avoid interruption."}
            </div>
          </div>
          <button
            type="button"
            onClick={changeCard}
            className="shrink-0 px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer shadow-2xs"
          >
            Update Card
          </button>
        </div>
      )}

      {suspended && (
        <div className="flex items-center justify-between gap-3 text-rose-800 bg-rose-50 border border-rose-200 p-4 rounded-xl text-xs shadow-2xs">
          <div className="flex items-center gap-2.5">
            <XCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>Mail service is suspended due to non-payment. Update your card to restore it.</span>
          </div>
          <button
            type="button"
            onClick={changeCard}
            className="shrink-0 px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer shadow-2xs"
          >
            Resolve Payment
          </button>
        </div>
      )}

      {isCanceling && (
        <div className="flex items-center justify-between gap-3 text-slate-800 bg-slate-100 border border-slate-200 p-4 rounded-xl text-xs shadow-2xs">
          <div className="flex items-center gap-2.5">
            <Clock className="w-4 h-4 text-slate-500 shrink-0" />
            <span>Cancels at the end of the current period ({formatDate(summary?.currentPeriodEnd)}).</span>
          </div>
          <button
            type="button"
            onClick={resumeSubscription}
            disabled={actionLoading === 'resume'}
            className="shrink-0 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
          >
            {actionLoading === 'resume' ? 'Resuming…' : 'Resume subscription'}
          </button>
        </div>
      )}

      {/* Clean 4-Metric Billing Overview Ribbon */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Tile 1: Status */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Status</span>
            <div className="text-base font-bold text-slate-900 mt-1 flex items-center gap-1.5">
              {!trial?.started ? (
                <StatusBadge status="inactive">Not started</StatusBadge>
              ) : trial.isTrialing ? (
                <span className="font-semibold text-slate-900">60-day trial</span>
              ) : paymentIssue ? (
                <StatusBadge status="warning">Payment issue</StatusBadge>
              ) : suspended ? (
                <StatusBadge status="failed">Suspended</StatusBadge>
              ) : (
                <StatusBadge status="active">Active</StatusBadge>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-1 tabular-nums">
              {trial?.isTrialing
                ? `Trial ends ${formatDate(trial.endsAt)}`
                : summary?.currentPeriodEnd
                ? `Renews ${formatDate(summary.currentPeriodEnd)}`
                : 'Continuous subscription'}
            </div>
          </div>

          {/* Tile 2: Estimated Bill */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Estimated Monthly Bill</span>
            <div className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
              {formatPaise(cart?.estimatedMonthlyPaise ?? 0)}
              <span className="text-xs font-normal text-slate-500 ml-1">/ mo</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Based on active mailboxes</div>
          </div>

          {/* Tile 3: Mailbox Capacity */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Mailbox Capacity</span>
            <div className="text-xl font-bold text-slate-900 mt-1 tabular-nums flex items-baseline gap-1">
              <span>{totalActiveUsers}</span>
              <span className="text-xs font-normal text-slate-400">/ {totalMailboxLimit} user limit</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Across {domainsList.length} domain{domainsList.length === 1 ? '' : 's'}
            </div>
          </div>

          {/* Tile 4: Payment Method */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Payment Method</span>
            <div className="text-sm font-bold text-slate-900 mt-1 truncate">
              {primaryPaymentMethodText ? (
                <span className="font-semibold text-slate-900">{primaryPaymentMethodText}</span>
              ) : (
                <span className="text-slate-400 font-normal">—</span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {primaryPaymentMethodText ? 'Autopay on file' : 'No card attached'}
            </div>
          </div>
        </div>

        {/* Overview Action Bar */}
        {(cart?.requiresActivation || (trial?.started && !summary?.cancelAtPeriodEnd) || isCanceling) && (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100 mt-4 text-xs">
            <div className="flex items-center gap-2">
              {cart?.requiresActivation && (
                <button
                  type="button"
                  onClick={handleOpenCart}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold cursor-pointer inline-flex items-center gap-1.5 shadow-2xs transition-colors"
                >
                  <ShoppingCart size={13} />
                  <span>
                    Activate {cart.pendingMailboxes.length} waiting mailbox{cart.pendingMailboxes.length === 1 ? '' : 'es'}
                  </span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {trial?.started && !summary?.cancelAtPeriodEnd && (
                <button
                  type="button"
                  onClick={cancelAll}
                  disabled={actionLoading === 'cancel'}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {actionLoading === 'cancel' ? 'Canceling…' : 'Cancel subscription'}
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {/* Domains & Mailboxes Ledger Table */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">Domains &amp; plans</h2>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                {domainsList.length}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Pay only for active mailboxes · the Plan's user limit caps Active Users
            </p>
          </div>

          {domainsList.length > 4 && (
            <div className="relative w-full sm:w-64">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Filter domains or plans..."
                value={domainSearchQuery}
                onChange={(e) => setDomainSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600 bg-white shadow-2xs"
              />
            </div>
          )}
        </div>

        {domainsList.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            <Globe size={28} className="mx-auto mb-2 text-slate-300" />
            <p>No domains connected yet.</p>
          </div>
        ) : filteredDomains.length === 0 ? (
          <div className="p-6 text-center text-slate-400 text-xs">
            No domains match "{domainSearchQuery}".
          </div>
        ) : (
          <div className="data-table-container border border-slate-200 rounded-lg overflow-hidden">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Plan Tier</th>
                  <th>Mailboxes &amp; Capacity</th>
                  <th>Billing Rate</th>
                  <th style={{ textAlign: 'right' }}>Monthly Subtotal</th>
                  <th><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredDomains.map((d) => (
                  <DomainBillingRow key={d.domainId} domain={d} layout="row" {...rowBilling(d)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {domainDialogs}

        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 pt-1">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
          <span>Plan limits cap how many users a domain can have — you're only billed for users who are actually active.</span>
        </div>
      </section>

      {/* Payment Methods Section (Single Source of Truth) */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs flex flex-col gap-4">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <CreditCard size={15} className="text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-900">Payment Methods on File</h2>
          </div>

          {(trial?.started || paymentMethods.length > 0 || cart?.hasPaymentMethod) && (
            <button
              type="button"
              onClick={changeCard}
              disabled={actionLoading === 'card'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-indigo-600 hover:text-indigo-700 rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
            >
              <Plus size={13} />
              <span>Change payment method</span>
            </button>
          )}
        </div>

        {paymentMethods.length === 0 && !cart?.paymentMethod ? (
          <div className="p-6 bg-slate-50 border border-slate-100 rounded-xl text-center">
            <CreditCard size={32} className="mx-auto mb-2 text-slate-300" />
            <p className="text-xs font-semibold text-slate-700 mb-1">No payment methods saved.</p>
            <p className="text-[11px] text-slate-400 max-w-sm mx-auto mb-4">
              Add a payment card to ensure uninterrupted mail delivery when your 60-day trial transitions to regular billing.
            </p>
            <button
              type="button"
              onClick={changeCard}
              disabled={actionLoading === 'card'}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-2xs"
            >
              Add Payment Method
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {paymentMethods.length > 0 ? (
              paymentMethods.map((pm) => (
                <div
                  key={pm.id}
                  className="flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100/60 border border-slate-200 rounded-xl transition-colors text-xs"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-8 bg-white border border-slate-200 rounded-md flex items-center justify-center shrink-0 shadow-2xs">
                      {getCardBrandBadge(pm.brand)}
                    </div>
                    <div className="flex flex-col gap-0.5">
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
                        className="px-2.5 py-1 text-[11px] font-semibold text-slate-600 hover:text-indigo-600 hover:bg-white rounded-lg transition-colors cursor-pointer border border-transparent hover:border-slate-200 disabled:opacity-50"
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
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))
            ) : (
              // Fallback preview from cart
              cart?.paymentMethod && (
                <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-8 bg-white border border-slate-200 rounded-md flex items-center justify-center shrink-0 shadow-2xs">
                      {getCardBrandBadge(cart.paymentMethod.brand)}
                    </div>
                    <div className="flex flex-col gap-0.5">
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
                    Update card
                  </button>
                </div>
              )
            )}
          </div>
        )}

        <div className="text-[10px] text-slate-400 flex items-center gap-1.5 pt-1">
          <ShieldCheck size={13} className="text-slate-400 shrink-0" />
          <span>Transactions protected with bank-grade 256-bit encryption. Recurring billing adheres to RBI e-mandate guidelines.</span>
        </div>
      </section>

      {/* Invoices History Section */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs flex flex-col gap-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
          <Receipt size={15} className="text-slate-400" />
          <h2 className="text-sm font-bold text-slate-900">Billing history</h2>
        </div>

        {invoices.length === 0 ? (
          <div className="py-6 text-center text-slate-400 text-xs">
            <Receipt size={28} className="mx-auto mb-2 text-slate-300" />
            <p>No invoices yet.</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Statements will automatically appear here once your billing cycle commences.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block data-table-container border border-slate-200 rounded-lg overflow-hidden">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Amount Paid</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}>Invoice</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((inv) => (
                    <tr key={inv.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="text-slate-600 font-medium tabular-nums">{formatDate(inv.createdAt)}</td>
                      <td className="font-bold text-slate-900 tabular-nums">{formatAmount(inv.amountPaid, inv.currency)}</td>
                      <td>
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">{inv.status}</span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {inv.hostedInvoiceUrl ? (
                          <a
                            href={inv.hostedInvoiceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-700 font-semibold text-xs"
                          >
                            <span>View</span>
                            <ExternalLink size={12} />
                          </a>
                        ) : (
                          <span className="text-slate-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Stacked Cards View */}
            <div className="md:hidden space-y-2.5">
              {invoices.map((inv) => (
                <div
                  key={inv.id}
                  className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-3 text-xs"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-semibold text-slate-900 tabular-nums text-sm">
                      {formatAmount(inv.amountPaid, inv.currency)}
                    </span>
                    <span className="text-slate-500 tabular-nums text-[11px]">{formatDate(inv.createdAt)}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mt-0.5">
                      Status: {inv.status}
                    </span>
                  </div>
                  {inv.hostedInvoiceUrl && (
                    <a
                      href={inv.hostedInvoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-h-[44px] px-3.5 py-2 bg-white border border-slate-200 rounded-lg inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 font-semibold text-xs shadow-2xs"
                    >
                      <span>Invoice</span>
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* Payment Method Modal */}
      <PaymentMethodModal
        isOpen={showCardModal}
        onClose={() => setShowCardModal(false)}
        title="Payment Method"
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
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              >
                <X className="w-5 h-5" />
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
                  className="px-3 py-2.5 min-h-[44px] border border-slate-300 rounded-xl font-mono text-base sm:text-xs uppercase focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none"
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
                  className="min-h-[44px] px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={couponLoading || !couponInput.trim()}
                  className="min-h-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold transition-colors cursor-pointer disabled:opacity-50"
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
