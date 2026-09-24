import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Lock, CheckCircle2, AlertCircle, X, Loader2, Tag, Mail, Building2, LogOut } from 'lucide-react';
import toowixLogo from '../../assets/toowix-logo.svg';
import { api } from '../../api';
import { CartData, CouponValidationResult, PaymentMethodItem, UserContext } from '../../types';
import { PaymentMethodSelector } from '../PaymentMethodSelector';
import { formatPaise } from './format';

interface CartPageProps {
  onBack: () => void;
  user?: UserContext | null;
  onLogout?: () => void;
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
}

/**
 * Full-page cart. It lists every domain with the users added on it and what they cost, and — until
 * the tenant's trial has started — "Ready for checkout" opens Stripe to confirm a card (₹1, refunded)
 * which starts the single 60-day trial and switches the waiting mailboxes on. Once the trial runs it
 * simply keeps tracking usage; users are never blocked on this page.
 */
export const CartPage: React.FC<CartPageProps> = ({ onBack, user, onLogout }) => {
  const [tenantName, setTenantName] = useState<string>('Organization');
  const [cart, setCart] = useState<CartData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'success' | 'info' | 'error'; text: string } | null>(null);
  const [working, setWorking] = useState(false);
  const [showSandbox, setShowSandbox] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promo, setPromo] = useState<CouponValidationResult | null>(null);

  useEffect(() => {
    api
      .getTenantMe?.()
      .then((res) => {
        if (res?.tenant?.name) setTenantName(res.tenant.name);
      })
      .catch(() => {});
  }, []);

  const adminEmail = user?.email || 'admin@toowix.com';
  const adminInitials = adminEmail.slice(0, 2).toUpperCase();

  const load = useCallback(async () => {
    try {
      setCart(await api.getCart());
      setLoadError(null);
    } catch (err: any) {
      setLoadError(err?.message || 'Could not load your cart.');
    }
  }, []);

  const redeemPromo = useCallback(
    async (appliedCode: string | undefined) => {
      if (!appliedCode) return;
      try {
        await api.redeemCoupon(appliedCode);
      } catch {
        /* the trial is already running — a coupon that can't be applied shouldn't undo that */
      }
    },
    []
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    const card = params.get('card');
    const sessionId = params.get('session_id');
    if (checkout || card) window.history.replaceState({}, '', '/cart');

    if (card === 'success' && sessionId) {
      setWorking(true);
      api
        .completeCardUpdate(sessionId)
        .then((res) => {
          setCart(res.cart);
          setNotice({ tone: 'success', text: 'Your payment method has been updated.' });
        })
        .catch((err: any) => {
          setNotice({ tone: 'error', text: err?.message || 'We could not save your new card.' });
          load();
        })
        .finally(() => setWorking(false));
      return;
    }
    if (card === 'cancelled') setNotice({ tone: 'info', text: 'Card update was cancelled — your existing card is unchanged.' });

    if (checkout === 'success' && sessionId) {
      setWorking(true);
      api
        .completeCartCheckout(sessionId)
        .then((res) => {
          setCart(res.cart);
          setNotice({ tone: 'success', text: 'Card confirmed — your 60-day free trial has started and your mailboxes are active.' });
        })
        .catch((err: any) => {
          setNotice({ tone: 'error', text: err?.message || 'We could not confirm your card. Nothing was charged.' });
          load();
        })
        .finally(() => setWorking(false));
      return;
    }
    if (checkout === 'cancelled') setNotice({ tone: 'info', text: 'Checkout was cancelled — nothing was charged.' });
    load();
  }, [load]);

  const applyPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!promoCode.trim()) return;
    setPromoError(null);
    try {
      const res = await api.validateCoupon(promoCode.trim());
      if (res.valid) setPromo(res);
      else setPromoError(res.message || 'Invalid promo code');
    } catch (err: any) {
      setPromoError(err?.message || 'Invalid promo code');
    }
  };

  const checkout = async () => {
    setWorking(true);
    setNotice(null);
    try {
      const res = await api.startCartCheckout(promo?.code);
      if ('url' in res) {
        window.location.href = res.url;
        return;
      }
      setShowSandbox(true);
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Could not start checkout.' });
    } finally {
      setWorking(false);
    }
  };

  const sandboxPaid = async (pm?: PaymentMethodItem) => {
    setShowSandbox(false);
    setWorking(true);
    try {
      const res = await api.activateCart({
        paymentMethodId: pm?.id,
        brand: pm?.brand,
        last4: pm?.last4,
        expMonth: pm?.expMonth,
        expYear: pm?.expYear,
      });
      await redeemPromo(promo?.code);
      setCart(res.cart);
      setNotice({ tone: 'success', text: 'Card confirmed — your 60-day free trial has started and your mailboxes are active.' });
    } catch (err: any) {
      setNotice({ tone: 'error', text: err?.message || 'Could not activate your mailboxes.' });
    } finally {
      setWorking(false);
    }
  };

  const domains = cart?.domains ?? [];
  const totalUsers = domains.reduce((sum, d) => sum + d.activeUsers + d.pendingUsers, 0);
  const trialStarted = !!cart?.trial.started;
  const extraDays = promo?.extraTrialDays || 0;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans antialiased selection:bg-indigo-100 selection:text-indigo-900">
      <header className="fixed top-0 inset-x-0 z-40 bg-white border-b border-slate-200 h-16">
        <div className="h-full px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-3 select-none cursor-pointer group"
              title="Back to dashboard"
            >
              <img src={toowixLogo} alt="Toowix" className="w-8 h-8 object-contain" />
              <span className="font-semibold text-slate-900 text-sm tracking-tight leading-tight select-none group-hover:text-indigo-600 transition-colors">
                TOOWIX ADMIN
              </span>
            </button>
            <span className="text-slate-300 font-light text-base hidden md:inline select-none">/</span>
            <div className="hidden md:inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200/80 text-xs">
              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-800 tracking-tight">{tenantName}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to dashboard</span>
            </button>
            <div className="flex items-center gap-3 pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-semibold">
                {adminInitials}
              </div>
              <div className="hidden lg:flex flex-col text-left">
                <span className="text-xs font-medium text-slate-900 leading-tight">{adminEmail}</span>
                <span className="text-[11px] text-slate-400 font-normal leading-tight">Administrator</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-24 pb-16">
        <div className="mb-6 text-left">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Your Cart</h1>
          <p className="text-xs text-slate-500 mt-1">Every domain in your organisation and the users on it — one trial, one card, one invoice.</p>
        </div>

        {notice && (
          <div
            role="status"
            className={`mb-6 p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
              notice.tone === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : notice.tone === 'error'
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-slate-100 border-slate-200 text-slate-700'
            }`}
          >
            {notice.tone === 'success' ? (
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-rose-600" />
            )}
            <span>{notice.text}</span>
          </div>
        )}
        {loadError && <div className="mb-4 p-3 rounded-xl border bg-rose-50 border-rose-200 text-xs text-rose-800">{loadError}</div>}

        <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] lg:grid-cols-[1fr_360px] gap-6 items-start">
          {/* Domains + users */}
          <section className="flex flex-col gap-4">
            {!cart ? (
              <p className="text-xs text-slate-400">Loading…</p>
            ) : domains.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-xs text-slate-500 shadow-xs">
                Your cart is empty — add a domain to get started.
              </div>
            ) : (
              domains.map((d) => (
                <article key={d.domainId} className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                  <div className="p-4 flex items-center gap-3.5">
                    <div
                      className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-bold shrink-0"
                      aria-hidden
                    >
                      {d.domainName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-sm font-semibold text-slate-900 truncate">{d.domainName}</h2>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {d.planName ? `${d.planName} plan` : 'No plan selected'} · {formatPaise(d.ratePaise)} per active user / month
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {d.activeUsers + d.pendingUsers} of {d.maxUsers} users
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-sm font-bold text-slate-900 tabular-nums">{formatPaise(d.monthlyPaise)}</span>
                        <span className="block text-[11px] text-slate-400">per month</span>
                      </div>
                    </div>
                  </div>
                  <ul className="border-t border-slate-100 divide-y divide-slate-100 bg-slate-50/40">
                    {d.users.length === 0 ? (
                      <li className="px-4 py-2.5 text-xs text-slate-400 italic">No users added yet.</li>
                    ) : (
                      d.users.map((u) => (
                        <li key={u.id} className="px-4 py-2 flex items-center justify-between gap-3 text-xs hover:bg-slate-50 transition-colors">
                          <span className="flex items-center gap-2 min-w-0">
                            <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <span className="truncate text-slate-700 font-medium">{u.address}</span>
                          </span>
                          <span className="flex items-center gap-2.5 shrink-0">
                            <span className="tabular-nums text-xs text-slate-500">{formatPaise(d.ratePaise)}/mo</span>
                            {(() => {
                              if (!u.pendingActivation) {
                                return (
                                  <span
                                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                                      u.status === 'active'
                                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
                                        : 'bg-slate-100 text-slate-600 border-slate-200'
                                    }`}
                                  >
                                    {u.status}
                                  </span>
                                );
                              }
                              const pending = cart?.pendingMailboxes.find((p) => p.id === u.id);
                              const daysLeft = pending?.expiresAt
                                ? Math.max(0, Math.ceil((new Date(pending.expiresAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
                                : null;
                              return (
                                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold border bg-amber-50 text-amber-700 border-amber-200/80">
                                  waiting for activation {daysLeft !== null ? `· expires in ${daysLeft}d` : ''}
                                </span>
                              );
                            })()}
                          </span>
                        </li>
                      ))
                    )}
                  </ul>
                </article>
              ))
            )}

            {cart && cart.recentChanges.length > 0 && (
              <section className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2.5">Recent billing activity</h2>
                <ul className="divide-y divide-slate-100">
                  {cart.recentChanges.map((c) => (
                    <li key={c.id} className="py-1.5 flex justify-between text-xs gap-3">
                      <span className="truncate text-slate-600">{c.label}</span>
                      {c.monthlyDeltaPaise !== 0 && (
                        <span className={`tabular-nums shrink-0 font-medium ${c.monthlyDeltaPaise > 0 ? 'text-slate-800' : 'text-emerald-700'}`}>
                          {c.monthlyDeltaPaise > 0 ? '+' : '−'}
                          {formatPaise(Math.abs(c.monthlyDeltaPaise))}/mo
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>

          {/* Order summary */}
          <aside className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col gap-4 lg:sticky lg:top-24">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-900">Order Summary</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {totalUsers} user{totalUsers === 1 ? '' : 's'} across {domains.length} domain{domains.length === 1 ? '' : 's'}
              </p>
            </div>
            <hr className="border-slate-100" />
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-semibold text-slate-700">
                Subtotal <span className="text-[11px] font-normal text-slate-400">(INR / month)</span>
              </span>
              <span className="text-lg font-bold text-slate-900 tabular-nums">{formatPaise(cart?.estimatedMonthlyPaise ?? 0)}</span>
            </div>
            <p className="text-[11px] text-slate-400 text-center leading-tight">Billed only for active users. Subtotal does not include applicable taxes.</p>

            {trialStarted ? (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200/80 text-xs text-emerald-900">
                <strong>{cart!.trial.isTrialing ? `60-day trial · ${cart!.trial.daysRemaining} days left` : 'Subscription active'}</strong>
                {cart!.trial.isTrialing && (
                  <span className="block text-emerald-700 text-[11px] mt-0.5">
                    Ends {formatDate(cart!.trial.endsAt)} — one date for every domain and user.
                  </span>
                )}
                {cart!.paymentMethod && (
                  <span className="block text-emerald-700 text-[11px] mt-0.5">
                    Card: {cart!.paymentMethod.brand} •••• {cart!.paymentMethod.last4}
                  </span>
                )}
              </div>
            ) : (
              <div className="bg-slate-50/70 border border-slate-100 rounded-lg p-3 flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Due today</span>
                  <span className="tabular-nums font-semibold text-slate-800">{formatPaise(0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Free trial</span>
                  <span className="font-semibold text-indigo-600">{60 + extraDays} days</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed border-t border-slate-200/60 pt-2">
                  Stripe will ask you to confirm your card (Indian cards also approve automatic monthly billing with your bank). Nothing is charged today — your
                  trial starts when you confirm, and you are billed for active users after it ends.
                </p>
              </div>
            )}

            {!trialStarted &&
              (promo ? (
                <div className="flex items-center justify-between text-xs p-2.5 rounded-lg bg-emerald-50 border border-emerald-200/80 text-emerald-800">
                  <span className="flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-indigo-600" />
                    <strong>{promo.code}</strong> · +{extraDays} trial days
                  </span>
                  <button type="button" onClick={() => setPromo(null)} className="underline text-[11px] text-emerald-700 hover:text-emerald-900 cursor-pointer">
                    Remove
                  </button>
                </div>
              ) : promoOpen ? (
                <form onSubmit={applyPromo} className="flex flex-col gap-1.5">
                  <div className="flex gap-1.5">
                    <input
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="Promo code"
                      aria-label="Promo code"
                      className="flex-1 h-8 px-2.5 border border-slate-200 rounded-lg text-xs font-mono uppercase bg-white focus:outline-none focus:border-indigo-600"
                    />
                    <button
                      type="submit"
                      className="h-8 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                    >
                      Apply
                    </button>
                  </div>
                  {promoError && <p className="text-[11px] text-rose-600">{promoError}</p>}
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setPromoOpen(true)}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:underline self-center cursor-pointer"
                >
                  Have a promo code?
                </button>
              ))}

            {trialStarted ? (
              <button
                type="button"
                onClick={onBack}
                className="w-full h-10 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer flex items-center justify-center"
              >
                Back to dashboard
              </button>
            ) : (
              <button
                type="button"
                onClick={checkout}
                disabled={working || totalUsers === 0}
                className="w-full h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold shadow-xs hover:shadow transition-all cursor-pointer disabled:opacity-50 inline-flex items-center justify-center gap-2"
              >
                {working && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Ready for Checkout</span>
              </button>
            )}

            <div className="flex flex-col items-center gap-0.5 text-center pt-1">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>Secure Payment</span>
              </span>
              <span className="text-[10px] text-slate-400 leading-tight">
                Payments are processed securely by Stripe. Cards, UPI and net banking supported where available.
              </span>
            </div>
          </aside>
        </div>
      </main>

      {showSandbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[2px] p-4" role="dialog" aria-label="Card confirmation">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">Confirm your card (sandbox)</h2>
              <button
                type="button"
                onClick={() => setShowSandbox(false)}
                aria-label="Close"
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <PaymentMethodSelector onSuccess={sandboxPaid} showSkip={false} submitLabel="Confirm card & start trial" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
