import React, { useEffect, useState, useCallback } from 'react';
import { CreditCard, RefreshCw, AlertTriangle, Receipt, ExternalLink, Globe } from 'lucide-react';
import { api } from '../api';
import { DomainItem, TenantBillingSummary as TenantBillingSummaryType, InvoiceItem, DomainSubscriptionStatus } from '../types';
import { PaymentMethodUpdateForm } from './PaymentMethodUpdateForm';

interface TenantBillingSummaryProps {
  domains: DomainItem[];
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
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency.toUpperCase() }).format(paise / 100);
}

/**
 * Tenant-wide billing summary for Tenant Home: every domain under this
 * tenant shares ONE combined Stripe subscription/invoice, so this shows the
 * shared status/next-charge once, a breakdown of which domains are on it,
 * the shared payment method, and the tenant-wide invoice history — as
 * opposed to BillingView.tsx (unchanged), which stays domain-scoped for
 * per-domain plan upgrade/downgrade/cancel from within a Domain Dashboard.
 */
export const TenantBillingSummary: React.FC<TenantBillingSummaryProps> = ({ domains }) => {
  const [summary, setSummary] = useState<TenantBillingSummaryType | null>(null);
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [paymentFormLoading, setPaymentFormLoading] = useState(false);
  const [paymentFormError, setPaymentFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, invoicesRes] = await Promise.all([api.getTenantBillingSummary(), api.listBillingInvoices()]);
      setSummary(summaryRes);
      setInvoices(invoicesRes.invoices);
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
    // The payment method is Customer-level (shared across every domain), so
    // any one domain's SetupIntent endpoint works — pick the first available.
    const anyDomainId = domains[0]?.id;
    if (!anyDomainId) return;
    setPaymentFormLoading(true);
    setPaymentFormError(null);
    try {
      const [configRes, setupRes] = await Promise.all([api.getBillingConfig(), api.createPaymentMethodSetupIntent(anyDomainId)]);
      setPublishableKey(configRes.publishableKey);
      setSetupClientSecret(setupRes.clientSecret);
      setShowPaymentForm(true);
    } catch (err: any) {
      setPaymentFormError(err.message || 'Failed to open payment form.');
    } finally {
      setPaymentFormLoading(false);
    }
  };

  const badge = statusBadge(summary?.status);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2.5">
            <CreditCard className="w-6 h-6 text-indigo-600" />
            <span>Billing</span>
          </h1>
          <p className="text-xs text-slate-500">One combined bill covers every domain on this account.</p>
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

      {/* Status + shared payment method */}
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

        {!summary?.hasSubscription && !loading && (
          <p className="text-xs text-slate-500">
            No domain has an active subscription yet. Add a payment method from a domain's Billing tab to get started.
          </p>
        )}

        {summary?.hasSubscription && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block mb-0.5">
                  {summary.status === 'trialing' ? 'Trial Ends' : 'Next Charge'}
                </span>
                <span className="font-semibold text-slate-800 tabular-nums">
                  {formatDate(summary.status === 'trialing' ? summary.trialEnd : summary.currentPeriodEnd)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block mb-0.5">Domains on this bill</span>
                <span className="font-semibold text-slate-800 tabular-nums">{summary.domains.length}</span>
              </div>
            </div>

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

      {/* Per-domain breakdown */}
      {summary?.hasSubscription && summary.domains.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} className="text-slate-400" />
            <span className="text-xs font-semibold text-slate-500">Domains on this bill</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {summary.domains.map((d) => (
              <div
                key={d.domainId}
                className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs"
              >
                <span className="font-semibold text-slate-800">{d.domainName}</span>
                <span className="text-slate-500">
                  {d.planName || '—'}
                  {d.seatCount != null ? ` · ${d.seatCount} seats` : ''}
                </span>
              </div>
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
    </div>
  );
};
