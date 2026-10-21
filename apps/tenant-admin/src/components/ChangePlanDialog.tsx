import React, { useState } from 'react';
import { api } from '../api';
import { Plan } from '../types';
import { BillingDomain } from './DomainBillingRow';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { formatDate, formatPaise } from './cart/format';

export interface ChangePlanDialogProps {
  /** The domain as billed: ratePaise and activeUsers come from its subscription. */
  domain: BillingDomain;
  plans: Plan[];
  currentPeriodEnd: string | null;
  /** During the Trial nothing is charged, so an upgrade has nothing to pay today. */
  trialing?: boolean;
  /** A domain cancelled on its own: any Plan puts it back on the bill now, through Plan selection. */
  chooseAgain?: boolean;
  onClose: () => void;
  onChanged: () => void;
}

/** Moves a billed domain to another Plan: a pricier Plan upgrades now, a cheaper one is scheduled for period end. */
export const ChangePlanDialog: React.FC<ChangePlanDialogProps> = ({ domain, plans, currentPeriodEnd, trialing, onClose, onChanged, chooseAgain }) => {
  const [selected, setSelected] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An equal price has nothing to prorate, so it starts now like an upgrade.
  const isUpgrade = (p: Plan) => p.monthlyPriceInPaise >= domain.ratePaise;

  const confirm = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const change = chooseAgain ? api.selectDomainPlan : isUpgrade(selected) ? api.upgradeDomainPlan : api.downgradeDomainPlan;
      await change(domain.domainId, selected.id);
      onChanged();
    } catch (err: any) {
      setError(err?.message || 'Could not change the plan.');
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`${chooseAgain ? 'Choose a plan' : 'Change plan'} for ${domain.domainName}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} disabled={!selected} loading={busy}>Confirm</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {error && <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">{error}</div>}
        {plans
          .filter((p) => p.isActive)
          .map((p) => {
            const current = !chooseAgain && p.id === domain.planId;
            const tooSmall = p.seatCount < domain.activeUsers;
            const isSelected = selected?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={isSelected}
                disabled={current || tooSmall || busy}
                onClick={() => setSelected(p)}
                className={`text-left p-3 rounded-lg border transition-colors cursor-pointer disabled:cursor-not-allowed ${
                  isSelected ? 'border-indigo-500 bg-indigo-50/60' : 'border-slate-200 hover:border-indigo-300 disabled:hover:border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 text-sm">{p.name}</span>
                  {current && <span className="text-[11px] font-semibold text-indigo-700">Current plan</span>}
                </div>
                <div className="text-xs text-slate-600 mt-1 tabular-nums">
                  {formatPaise(p.monthlyPriceInPaise)} / Active User · {formatPaise(p.monthlyPriceInPaise * domain.activeUsers)} / month
                </div>
                {!current && (
                  <div className={`text-[11px] mt-1 ${tooSmall ? 'text-rose-700' : 'text-slate-500'}`}>
                    {tooSmall
                      ? `Allows up to ${p.seatCount} Active Users; ${domain.domainName} has ${domain.activeUsers}`
                      : chooseAgain
                      ? 'Billed from today; its mail switches back on'
                      : isUpgrade(p)
                      ? trialing
                        ? 'Starts now; nothing is charged until your Trial ends'
                        : 'Starts now; the difference for the rest of this period is charged to your card today'
                      : `Starts on ${formatDate(currentPeriodEnd)}`}
                  </div>
                )}
              </button>
            );
          })}
      </div>
    </Modal>
  );
};
