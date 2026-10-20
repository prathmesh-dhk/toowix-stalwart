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
  /** Set only for a domain on a billed subscription. */
  onCancel?: () => void;
  /** Cancelled on its own: off the bill, with Choose a plan again. */
  cancelled?: boolean;
  onChooseAgain?: () => void;
}

/** One domain's billing on the Billing page. Both Billing views render domains through this. */
export const DomainBillingRow: React.FC<DomainBillingRowProps> = ({ domain: d, layout, plan, pendingDowngrade, onChangePlan, onKeepCurrentPlan, onCancel, cancelled, onChooseAgain }) => {
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
    ) : (onChangePlan || onCancel) ? (
      <span className="inline-flex gap-1">
        {onChangePlan && action('Change plan', onChangePlan)}
        {onCancel && action('Cancel this domain', onCancel)}
      </span>
    ) : null;

  if (layout === 'tiles') {
    return (
      <section className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 shadow-xs">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Tile 1: Plan Tier */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Domain Tier</span>
            <div className="text-base font-bold text-slate-900 mt-1 flex items-center gap-1.5">
              <span>{plan?.name || d.planName || 'Standard'}</span>
              {cancelledBadge}
              {plan?.badge && (
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                  {plan.badge}
                </span>
              )}
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              Capped at {d.maxUsers} seats
            </div>
            {pendingBadge}
            {actions && <div className="mt-2 -ml-2.5">{actions}</div>}
          </div>

          {/* Tile 2: Mailbox Capacity */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Mailbox Usage</span>
            <div className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
              <span>{used} / {d.maxUsers} seats</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">
              {Math.max(0, d.maxUsers - used)} seats available
            </div>
          </div>

          {/* Tile 3: Billing Rate */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Price per Active User</span>
            <div className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
              {formatPaise(d.ratePaise)}
              <span className="text-xs font-normal text-slate-500 ml-1">/ active user</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Pay only for active mailboxes</div>
          </div>

          {/* Tile 4: Monthly Cost */}
          <div className="p-3.5 rounded-xl bg-slate-50/80 border border-slate-200/80">
            <span className="text-[11px] text-slate-500 uppercase tracking-wider font-medium">Domain Monthly Cost</span>
            <div className="text-xl font-bold text-slate-900 mt-1 tabular-nums">
              {formatPaise(monthlyPaise)}
              <span className="text-xs font-normal text-slate-500 ml-1">/ mo</span>
            </div>
            <div className="text-[11px] text-slate-500 mt-1">Consolidated on master bill</div>
          </div>
        </div>
      </section>
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
          {formatPaise(d.ratePaise)} <span className="text-slate-400">/ active user</span>
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
