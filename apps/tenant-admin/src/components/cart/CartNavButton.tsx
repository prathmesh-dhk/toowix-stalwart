import React from 'react';
import { ShoppingCart } from 'lucide-react';
import { CartData } from '../../types';

interface CartNavButtonProps {
  cart: CartData | null;
  /** Billing changes newer than this (ISO) count as unseen. */
  lastSeenAt: string | null;
  onClick: () => void;
}

/** Badge = mailboxes waiting for activation, or (once the trial runs) billing changes you haven't looked at. */
export function cartBadgeCount(cart: CartData | null, lastSeenAt: string | null): number {
  if (!cart) return 0;
  if (cart.requiresActivation) return cart.pendingMailboxes.length;
  const seen = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
  return cart.recentChanges.filter((c) => new Date(c.at).getTime() > seen).length;
}

export const CartNavButton: React.FC<CartNavButtonProps> = ({ cart, lastSeenAt, onClick }) => {
  const count = cartBadgeCount(cart, lastSeenAt);
  const needsAttention = !!cart?.requiresActivation;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
        needsAttention
          ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
          : count > 0
            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 shadow-sm'
            : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
      title={
        needsAttention
          ? `${count} mailbox${count === 1 ? '' : 'es'} waiting for activation`
          : count > 0
            ? `${count} new billing change${count === 1 ? '' : 's'}`
            : 'View cart'
      }
    >
      <ShoppingCart className={`w-4 h-4 ${needsAttention ? 'text-amber-600' : count > 0 ? 'text-indigo-600' : 'text-slate-500'}`} />
      <span>Cart</span>
      {count > 0 && (
        <span
          className={`inline-flex items-center justify-center px-1.5 text-[10px] font-bold rounded-full text-white min-w-[18px] h-[18px] ${
            needsAttention ? 'bg-amber-600' : 'bg-indigo-600'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
};
