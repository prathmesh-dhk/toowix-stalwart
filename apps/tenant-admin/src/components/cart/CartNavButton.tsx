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

  const badgeColor = needsAttention ? 'bg-amber-500' : 'bg-indigo-500';
  const iconColor = needsAttention ? 'text-amber-600' : count > 0 ? 'text-indigo-600' : 'text-slate-500';

  const title = needsAttention
    ? `${count} mailbox${count === 1 ? '' : 'es'} waiting for activation`
    : count > 0
      ? `${count} new billing change${count === 1 ? '' : 's'}`
      : 'View cart';

  return (
    <>
      {/* Mobile: clean icon with floating badge overlay */}
      <button
        type="button"
        onClick={onClick}
        title={title}
        className="relative sm:hidden p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
      >
        <ShoppingCart className={`w-5 h-5 ${iconColor}`} />
        {count > 0 && (
          <span
            className={`absolute -top-0.5 -right-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold rounded-full text-white ${badgeColor}`}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {/* Desktop: pill button with label */}
      <button
        type="button"
        onClick={onClick}
        title={title}
        className={`hidden sm:inline-flex relative items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border ${
          needsAttention
            ? 'bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100'
            : count > 0
              ? 'bg-indigo-50 border-indigo-200 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-300 shadow-sm'
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        <ShoppingCart className={`w-4 h-4 shrink-0 ${iconColor}`} />
        <span>Cart</span>
        {count > 0 && (
          <span
            className={`inline-flex items-center justify-center px-1.5 text-[10px] font-bold rounded-full text-white min-w-[18px] h-[18px] ${badgeColor}`}
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>
    </>
  );
};
