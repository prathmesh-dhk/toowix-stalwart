import React, { useEffect, useState, useCallback } from 'react';
import {
  CreditCard,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Receipt,
  ExternalLink,
  XCircle,
} from 'lucide-react';
import { api } from '../api';
import { DomainItem, DomainSubscription, Plan, InvoiceItem, DomainSubscriptionStatus } from '../types';
import { PaymentMethodUpdateForm } from './PaymentMethodUpdateForm';

interface BillingViewProps {
  activeDomain?: DomainItem | null;
}

function statusBadge(status?: DomainSubscriptionStatus | null) {
  switch (status) {
    case 'trialing':
      return { label: 'Trial', bg: '#eef2ff', color: '#4338ca', border: '#c7d2fe' };
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
  const amount = paise / 100;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency.toUpperCase() }).format(amount);
}

export const BillingView: React.FC<BillingViewProps> = ({ activeDomain }) => {
  const [billing, setBilling] = useState<{ domainId: string; domainName: string; subscription: DomainSubscription | null } | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [paymentFormLoading, setPaymentFormLoading] = useState(false);

  const loadBilling = useCallback(async () => {
    if (!activeDomain) return;
    setLoading(true);
    setError(null);
    try {
      const [billingRes, plansRes, invoicesRes] = await Promise.all([
        api.getDomainBillingStatus(activeDomain.id),
        api.listPlans(),
        api.listBillingInvoices(),
      ]);
      setBilling(billingRes);
      setPlans(plansRes.plans);
      setInvoices(invoicesRes.invoices);
    } catch (err: any) {
      setError(err.message || 'Failed to load billing information.');
    } finally {
      setLoading(false);
    }
  }, [activeDomain]);

  useEffect(() => {
    setShowPaymentForm(false);
    setSetupClientSecret(null);
    loadBilling();
  }, [loadBilling]);

  if (!activeDomain) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
            <CreditCard className="w-6 h-6 text-indigo-600" />
            <span>Billing</span>
          </h1>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-xs text-slate-400">
          Add a domain to see billing.
        </div>
      </div>
    );
  }

  const sub = billing?.subscription || null;
  const badge = statusBadge(sub?.status);
  const currentPlan = plans.find((p) => p.id === sub?.planId);
  const pendingDowngradePlan = plans.find((p) => p.id === sub?.pendingDowngradePlanId);
  const otherPlans = plans.filter((p) => p.id !== sub?.planId && p.isActive);

  const handleStartCheckout = async () => {
    setActionLoading('checkout');
    setActionError(null);
    try {
      const res = await api.startDomainCheckout(activeDomain.id);
      window.location.href = res.url;
    } catch (err: any) {
      setActionError(err.message || 'Failed to start checkout.');
      setActionLoading(null);
    }
  };

  const handleOpenPaymentForm = async () => {
    setPaymentFormLoading(true);
    setActionError(null);
    try {
      const [configRes, setupRes] = await Promise.all([
        api.getBillingConfig(),
        api.createPaymentMethodSetupIntent(activeDomain.id),
      ]);
      setPublishableKey(configRes.publishableKey);
      setSetupClientSecret(setupRes.clientSecret);
      setShowPaymentForm(true);
    } catch (err: any) {
      setActionError(err.message || 'Failed to open payment form.');
    } finally {
      setPaymentFormLoading(false);
    }
  };

  const handleUpgrade = async (planId: string) => {
    setActionLoading(`plan-${planId}`);
    setActionError(null);
    try {
      const targetPlan = plans.find((p) => p.id === planId);
      const isUpgrade = !currentPlan || (targetPlan && targetPlan.seatCount > currentPlan.seatCount);
      if (isUpgrade) {
        await api.upgradeDomainPlan(activeDomain.id, planId);
      } else {
        await api.downgradeDomainPlan(activeDomain.id, planId);
      }
      await loadBilling();
    } catch (err: any) {
      setActionError(err.message || 'Failed to change plan.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Cancel this domain\'s subscription at the end of the current billing period?')) return;
    setActionLoading('cancel');
    setActionError(null);
    try {
      await api.cancelDomainSubscription(activeDomain.id);
      await loadBilling();
    } catch (err: any) {
      setActionError(err.message || 'Failed to cancel subscription.');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
            <CreditCard className="w-6 h-6 text-indigo-600" />
            <span>Billing</span>
          </h1>
          <p className="text-xs text-slate-500">{activeDomain.domainName}</p>
        </div>
        <button
          type="button"
          onClick={loadBilling}
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
      {actionError && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Status card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold text-slate-500">Subscription Status</span>
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full border"
            style={{ background: badge.bg, color: badge.color, borderColor: badge.border }}
          >
            {badge.label}
          </span>
        </div>

        {!sub && !loading && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-600 leading-relaxed">
              This domain has no active subscription. Add a payment method to get 1 month free, then monthly
              billing begins automatically.
            </p>
            <button
              type="button"
              onClick={handleStartCheckout}
              disabled={actionLoading === 'checkout' || !activeDomain.planId}
              className="self-start px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs transition-all cursor-pointer disabled:opacity-50"
            >
              {actionLoading === 'checkout' ? 'Redirecting...' : 'Add Payment Method'}
            </button>
          </div>
        )}

        {sub && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">Plan</span>
                <span className="font-semibold text-slate-800">{currentPlan?.name || '—'}</span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">
                  {sub.status === 'trialing' ? 'Trial Ends' : 'Next Charge'}
                </span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {formatDate(sub.status === 'trialing' ? sub.trialEnd : sub.currentPeriodEnd)}
                </span>
              </div>
            </div>

            {(sub.status === 'grace' || sub.status === 'past_due') && (
              <div className="flex items-center gap-2 text-amber-700 bg-amber-50 border border-amber-200 p-3 rounded-xl text-xs">
                <AlertTriangle size={14} className="shrink-0" />
                <span>
                  Your last payment failed. Mail service is unaffected for now, but update your payment method
                  soon to avoid interruption.
                </span>
              </div>
            )}

            {sub.status === 'suspended' && (
              <div className="flex items-center gap-2 text-rose-700 bg-rose-50 border border-rose-200 p-3 rounded-xl text-xs">
                <XCircle size={14} className="shrink-0" />
                <span>Mail service for this domain is suspended due to non-payment.</span>
              </div>
            )}

            {sub.status === 'active' && !sub.cancelAtPeriodEnd && (
              <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-xs">
                <CheckCircle2 size={14} className="shrink-0" />
                <span>Subscription is active and in good standing.</span>
              </div>
            )}

            {sub.cancelAtPeriodEnd && (
              <div className="flex items-center gap-2 text-slate-600 bg-slate-50 border border-slate-200 p-3 rounded-xl text-xs">
                <AlertTriangle size={14} className="shrink-0" />
                <span>Cancels at the end of the current period ({formatDate(sub.currentPeriodEnd)}).</span>
              </div>
            )}

            {pendingDowngradePlan && (
              <p className="text-[11px] text-slate-400">
                Scheduled to switch to <strong className="text-slate-600">{pendingDowngradePlan.name}</strong> at
                renewal.
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              {!showPaymentForm && (
                <button
                  type="button"
                  onClick={handleOpenPaymentForm}
                  disabled={paymentFormLoading}
                  className="px-3.5 py-1.5 border border-slate-200 hover:bg-slate-50 rounded-lg text-[11px] font-semibold text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {paymentFormLoading ? 'Loading...' : 'Update Payment Method'}
                </button>
              )}
              {!sub.cancelAtPeriodEnd && sub.status !== 'canceled' && (
                <button
                  type="button"
                  onClick={handleCancel}
                  disabled={actionLoading === 'cancel'}
                  className="px-3.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {actionLoading === 'cancel' ? 'Canceling...' : 'Cancel Subscription'}
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
                    loadBilling();
                  }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Plan picker */}
      {sub && sub.status !== 'canceled' && otherPlans.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <span className="text-xs font-semibold text-slate-500 block mb-3">Change Plan</span>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {otherPlans.map((plan) => (
              <button
                key={plan.id}
                type="button"
                onClick={() => handleUpgrade(plan.id)}
                disabled={actionLoading === `plan-${plan.id}`}
                className="p-3 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 text-left transition-all cursor-pointer disabled:opacity-50"
              >
                <span className="text-xs font-bold text-slate-800 block">{plan.name}</span>
                <span className="text-[10px] text-slate-400">
                  {plan.billingMode === 'metered' ? 'Pay as you go' : `${plan.seatCount} seats`}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Invoices */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
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
                  <span className="font-semibold text-slate-800 tabular-nums">
                    {formatAmount(inv.amountPaid, inv.currency)}
                  </span>
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
    </div>
  );
};
