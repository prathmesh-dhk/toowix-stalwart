import React from 'react';
import { Globe } from 'lucide-react';
import { CartDomainRow, Plan, TenantBillingSummary } from '../types';
import { formatDate, formatPaise } from './cart/format';
import { StatusBadge } from './ui/StatusBadge';

export type BillingDomain = Omit<CartDomainRow, 'users'>;

export interface DomainBillingRowProps {
  domain: BillingDomain;
  /** 'row' is a table row in the organisation-wide view; 'tiles' is the single-domain view's metric ribbon. */
  layout: 'row' | 'tiles';
  plan?: Plan | null;
  pendingDowngrade?: TenantBillingSummary['domains'][number]['pendingDowngrade'];
  /** Set only for a domain on a billed subscription. */
  onChangePlan?: () => void;
  /** Set only alongside a pending downgrade. */
  onKeepCurrentPlan?: () => void;
  /** Set only for a domain on a billed subscription. 'tiles' ignores it: that page shows it in its Danger zone. */
  onCancel?: () => void;
  /** Cancelled on its own: off the bill, with Choose a plan again. */
  cancelled?: boolean;
  /** Scheduled to cancel at period end. */
  cancelingAtPeriodEnd?: boolean;
  cancelEffectiveAt?: string | null;
  onKeepSubscription?: () => void;
  onChooseAgain?: () => void;
  /** 'tiles' only: when the subscription next charges. */
  renewsAt?: string | null;
}

/** One domain's billing on the Billing page. Both Billing views render domains through this. */
export const DomainBillingRow: React.FC<DomainBillingRowProps> = ({ domain: d, layout, plan, pendingDowngrade, onChangePlan, onKeepCurrentPlan, onCancel, cancelled, cancelingAtPeriodEnd, cancelEffectiveAt, onKeepSubscription, onChooseAgain, renewsAt }) => {
  const used = d.activeUsers + (d.pendingUsers || 0);
  const pct = Math.min(100, Math.round((used / (d.maxUsers || 1)) * 100));
  const pendingBadge = pendingDowngrade && (
    <div className="text-[11px] font-medium text-amber-700 mt-1">
      Moves to {pendingDowngrade.planName} on {formatDate(pendingDowngrade.effectiveAt)}
      {onKeepCurrentPlan && (
        <button
          type="button"
          onClick={onKeepCurrentPlan}
          className="ml-2 font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
        >
          Keep current plan
        </button>
      )}
    </div>
  );
  const cancelBadge = cancelingAtPeriodEnd && (
    <div className="text-[11px] font-medium text-amber-700 mt-1">
      Cancels on {formatDate(cancelEffectiveAt)}
      {onKeepSubscription && (
        <button
          type="button"
          onClick={onKeepSubscription}
          className="ml-2 font-semibold text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
        >
          Resume subscription
        </button>
      )}
    </div>
  );
  const monthlyPaise = cancelled ? 0 : d.monthlyPaise;
  const action = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
    >
      {label}
    </button>
  );
  const cancelledBadge = cancelled && <StatusBadge status="closed">Cancelled</StatusBadge>;
  const actions =
    cancelled ? (
      onChooseAgain && action('Choose a plan again', onChooseAgain)
    ) : cancelingAtPeriodEnd ? (
      onChangePlan && action('Change plan', onChangePlan)
    ) : (onChangePlan || onCancel) ? (
      <span className="inline-flex gap-1">
        {onChangePlan && action('Change plan', onChangePlan)}
        {onCancel && action('Cancel this domain', onCancel)}
      </span>
    ) : null;

  if (layout === 'tiles') {
    const primaryAction = cancelled
      ? onChooseAgain && { label: 'Choose a plan again', onClick: onChooseAgain }
      : cancelingAtPeriodEnd
      ? onKeepSubscription && { label: 'Resume subscription', onClick: onKeepSubscription }
      : onChangePlan && { label: 'Change plan', onClick: onChangePlan };
    const seatsLeft = Math.max(0, d.maxUsers - used);
    return (
      <>
        {/* Current plan card: Change plan is the primary action; cancelling lives in the page's Danger zone. */}
        <section className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
          <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-start justify-between gap-5">
            <div className="flex flex-col gap-1.5 min-w-0">
              <span className="text-[11px] text-slate-500 uppercase tracking-wider font-semibold">Current plan</span>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold text-slate-900 tracking-tight">{plan?.name || d.planName || 'Standard'}</h2>
                {plan?.badge && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                    {plan.badge}
                  </span>
                )}
                {cancelledBadge}
                {cancelingAtPeriodEnd && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                    Cancels on {formatDate(cancelEffectiveAt)}
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-1.5 tabular-nums">
                <span className="text-2xl font-bold text-slate-900 tracking-tight">{formatPaise(d.ratePaise)}</span>
                <span className="text-xs text-slate-500">per active user / month</span>
              </div>
              <p className="text-xs text-slate-500">
                You pay only for active mailboxes. Up to {d.maxUsers} users
                {plan?.storageQuotaGb ? `, ${plan.storageQuotaGb} GB storage per mailbox` : ''}.
              </p>
              {pendingBadge}
              {cancelBadge}
            </div>
            {primaryAction && (
              <button
                type="button"
                onClick={primaryAction.onClick}
                className="shrink-0 self-start inline-flex items-center justify-center min-h-[40px] px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition-colors cursor-pointer shadow-2xs"
              >
                {primaryAction.label}
              </button>
            )}
          </div>
          <dl className="grid grid-cols-2 md:grid-cols-3 border-t border-slate-100 bg-slate-50/70 text-xs">
            <div className="px-5 sm:px-6 py-3.5 border-r border-slate-100">
              <dt className="text-slate-500">User limit</dt>
              <dd className="font-semibold text-slate-900 tabular-nums mt-0.5">{d.maxUsers} users</dd>
            </div>
            <div className="px-5 sm:px-6 py-3.5 md:border-r border-slate-100">
              <dt className="text-slate-500">{renewsAt ? 'Next charge' : 'Billing cycle'}</dt>
              <dd className="font-semibold text-slate-900 tabular-nums mt-0.5">{renewsAt ? formatDate(renewsAt) : 'Monthly'}</dd>
            </div>
            <div className="px-5 sm:px-6 py-3.5 col-span-2 md:col-span-1 border-t md:border-t-0 border-slate-100">
              <dt className="text-slate-500">Billed to</dt>
              <dd className="font-semibold text-slate-900 mt-0.5">Organization master bill</dd>
            </div>
          </dl>
        </section>

        {/* Usage */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-500">Active users</span>
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className="text-2xl font-bold text-slate-900">{used}</span>
              <span className="text-xs text-slate-500">of {d.maxUsers}</span>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="User limit used">
              <div className={`h-full rounded-full transition-all ${pct >= 90 ? 'bg-amber-500' : 'bg-indigo-600'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] text-slate-500">{pct}% of the user limit</span>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-500">Estimated this month</span>
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className="text-2xl font-bold text-slate-900">{formatPaise(monthlyPaise)}</span>
              <span className="text-xs text-slate-500">/ mo</span>
            </div>
            <span className="text-[11px] text-slate-500 tabular-nums">
              {cancelled ? 'Not on your organization bill' : `${d.activeUsers} active × ${formatPaise(d.ratePaise)}`}
            </span>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-1.5">
            <span className="text-xs font-medium text-slate-500">Seats available</span>
            <div className="flex items-baseline gap-1.5 tabular-nums">
              <span className="text-2xl font-bold text-slate-900">{seatsLeft}</span>
            </div>
            <span className="text-[11px] text-slate-500">Left under the user limit</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <tr className="hover:bg-slate-50/80 transition-colors">
      {/* Domain Name */}
      <td>
        <div className="flex items-center gap-2">
          <Globe size={14} className="text-slate-400 shrink-0" />
          <span className="font-semibold text-slate-900 text-xs">{d.domainName}</span>
        </div>
      </td>

      {/* Plan Tier Badge (Clean read-only tag, no dropdown) */}
      <td>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
          {d.planName || 'Standard'}
        </span>
        {cancelledBadge && <span className="ml-1">{cancelledBadge}</span>}
        {pendingBadge}
        {cancelBadge}
      </td>

      {/* Mailboxes & Capacity Bar */}
      <td>
        <div className="flex flex-col gap-1 max-w-xs">
          <div className="flex items-center justify-between text-xs text-slate-700 tabular-nums">
            <span className="font-medium text-slate-700">
              {used} / {d.maxUsers} users
            </span>
            <span className="text-[10px] text-slate-400 font-medium">{pct}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                pct >= 90 ? 'bg-amber-500' : 'bg-indigo-600'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </td>

      {/* Billing Rate */}
      <td>
        <span className="text-xs text-slate-600 tabular-nums">
          {formatPaise(d.ratePaise)} <span className="text-slate-400">/ Active User</span>
        </span>
      </td>

      {/* Monthly Subtotal */}
      <td style={{ textAlign: 'right' }}>
        <span className="tabular-nums font-bold text-slate-900 text-xs">
          {formatPaise(monthlyPaise)}
          <span className="text-slate-400 font-normal ml-0.5">/mo</span>
        </span>
      </td>

      <td style={{ textAlign: 'right' }}>{actions}</td>
    </tr>
  );
};
