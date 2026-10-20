import React, { useState } from 'react';
import { api } from '../api';
import { BillingDomain } from './DomainBillingRow';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { formatDate } from './cart/format';

export interface CancelDomainDialogProps {
  domain: BillingDomain;
  /** Other domains still billed: this one comes off the bill now. Otherwise the whole subscription ends at period end. */
  otherDomainsBilled: boolean;
  currentPeriodEnd: string | null;
  onClose: () => void;
  onCancelled: () => void;
}

/** Confirms cancelling one domain, saying what the backend will do. */
export const CancelDomainDialog: React.FC<CancelDomainDialogProps> = ({ domain, otherDomainsBilled, currentPeriodEnd, onClose, onCancelled }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.cancelDomainSubscription(domain.domainId);
      onCancelled();
    } catch (err: any) {
      setError(err?.message || 'Could not cancel the domain.');
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={`Cancel ${domain.domainName}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={confirm} loading={busy}>Confirm</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm text-slate-700">
        {error && <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">{error}</div>}
        <p>
          {otherDomainsBilled
            ? `${domain.domainName}'s mail stops now and it comes off your bill.`
            : `This cancels your subscription at the end of the period, on ${formatDate(currentPeriodEnd)}. Mail keeps working until then.`}
        </p>
      </div>
    </Modal>
  );
};
