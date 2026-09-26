import React, { useState, useEffect } from 'react';
import {
  CreditCard,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Plus,
  Loader2,
  ArrowRight,
  Tag,
} from 'lucide-react';
import { api } from '../api';
import { Plan, PaymentMethodItem, CouponValidationResult } from '../types';
import { PaymentMethodUpdateForm } from './PaymentMethodUpdateForm';

interface PaymentMethodSelectorProps {
  selectedPlan?: Plan | null;
  domainName?: string;
  autoAttachDomainId?: string;
  onSuccess: (paymentMethod?: PaymentMethodItem) => void;
  onSkip?: () => void;
  submitLabel?: string;
  showSkip?: boolean;
}

function detectCardBrand(num: string): string {
  const clean = num.replace(/\D/g, '');
  if (/^4/.test(clean)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(clean)) return 'mastercard';
  if (/^3[47]/.test(clean)) return 'amex';
  if (/^6(011|5)/.test(clean)) return 'discover';
  return 'visa';
}

function formatCardNumber(val: string): string {
  const digits = val.replace(/\D/g, '').slice(0, 16);
  const parts = [];
  for (let i = 0; i < digits.length; i += 4) {
    parts.push(digits.substring(i, i + 4));
  }
  return parts.join(' ');
}

function formatExpiry(val: string): string {
  const digits = val.replace(/\D/g, '').slice(0, 4);
  if (digits.length >= 2) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }
  return digits;
}

export const PaymentMethodSelector: React.FC<PaymentMethodSelectorProps> = ({
  selectedPlan,
  domainName,
  autoAttachDomainId,
  onSuccess,
  onSkip,
  submitLabel,
  showSkip = true,
}) => {
  const [loading, setLoading] = useState(true);
  const [savedCards, setSavedCards] = useState<PaymentMethodItem[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<string>('');
  const [isAddingNew, setIsAddingNew] = useState(false);

  // Stripe SetupIntent state (for production Stripe Elements)
  const [publishableKey, setPublishableKey] = useState<string | null>(null);
  const [setupClientSecret, setSetupClientSecret] = useState<string | null>(null);
  const [stripeReady, setStripeReady] = useState(false);

  // Fallback / Sandbox card input state
  const [cardholderName, setCardholderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [isDefault, setIsDefault] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Promo / Coupon code state
  const [couponCode, setCouponCode] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [appliedCoupon, setAppliedCoupon] = useState<CouponValidationResult | null>(null);
  const [showCouponInput, setShowCouponInput] = useState(false);

  const handleApplyCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!couponCode.trim()) return;
    setCouponLoading(true);
    setCouponError(null);
    try {
      const res = await api.validateCoupon(couponCode.trim());
      if (res.valid) {
        setAppliedCoupon(res);
      } else {
        setCouponError(res.message || 'Invalid coupon code');
      }
    } catch (err: any) {
      setCouponError(err.message || 'Failed to validate coupon code');
    } finally {
      setCouponLoading(false);
    }
  };

  // Load payment methods and billing configuration
  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const [methodsRes, configRes] = await Promise.all([
          api.listPaymentMethods().catch(() => ({ paymentMethods: [], defaultPaymentMethodId: null })),
          api.getBillingConfig().catch(() => ({ publishableKey: '', billingEnabled: false })),
        ]);

        if (!isMounted) return;

        const methods = methodsRes?.paymentMethods || [];
        setSavedCards(methods);

        if (methods.length > 0) {
          const def = methods.find((m) => m.isDefault) || methods[0];
          setSelectedCardId(def.id);
          setIsAddingNew(false);
        } else {
          setIsAddingNew(true);
        }

        if (configRes?.publishableKey && configRes.publishableKey.trim() !== '') {
          setPublishableKey(configRes.publishableKey);
          // Pre-fetch setup intent for tenant
          try {
            const setupRes = await api.createTenantSetupIntent();
            if (isMounted && setupRes?.clientSecret && setupRes.clientSecret !== 'bypassed') {
              setSetupClientSecret(setupRes.clientSecret);
              setStripeReady(true);
            }
          } catch {
            // Setup intent not available or mocked
          }
        }
      } catch (err: any) {
        if (isMounted) setError(err.message || 'Failed to load payment methods');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleUseSavedCard = async () => {
    if (!selectedCardId) {
      setError('Please select a payment method');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (autoAttachDomainId) {
        await api.attachDomainWithSavedPayment(autoAttachDomainId);
      }
      if (appliedCoupon) {
        await api.redeemCoupon(appliedCoupon.code, autoAttachDomainId).catch(() => {});
      }
      const chosen = savedCards.find((c) => c.id === selectedCardId);
      onSuccess(chosen);
    } catch (err: any) {
      setError(err?.message || 'Failed to attach payment method');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveSandboxCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanNumber = cardNumber.replace(/\s/g, '');
    if (cleanNumber.length < 13 || cleanNumber.length > 19) {
      setError('Please enter a valid 16-digit card number.');
      return;
    }

    const [mmStr, yyStr] = expiry.split('/');
    const mm = parseInt(mmStr, 10);
    const yy = parseInt(yyStr, 10);
    if (!mm || mm < 1 || mm > 12 || !yy) {
      setError('Please enter a valid expiration date (MM/YY).');
      return;
    }

    if (cvc.length < 3) {
      setError('Please enter a valid security code (CVC).');
      return;
    }

    setSubmitting(true);
    try {
      const brand = detectCardBrand(cleanNumber);
      const last4 = cleanNumber.slice(-4);
      const fullYear = yy < 100 ? 2000 + yy : yy;

      const res = await api.savePaymentMethod({
        brand,
        last4,
        expMonth: mm,
        expYear: fullYear,
        isDefault,
      });

      if (autoAttachDomainId) {
        await api.attachDomainWithSavedPayment(autoAttachDomainId);
      }

      if (appliedCoupon) {
        await api.redeemCoupon(appliedCoupon.code, autoAttachDomainId).catch(() => {});
      }

      onSuccess(res.paymentMethod);
    } catch (err: any) {
      setError(err?.message || 'Failed to save payment method');
    } finally {
      setSubmitting(false);
    }
  };

  const cardBrand = detectCardBrand(cardNumber);

  if (loading) {
    return (
      <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
        <span className="text-xs font-medium">Checking payment methods...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      {/* Plan & Pricing Summary Banner */}
      {selectedPlan && (
        <div className="p-4 bg-indigo-50/70 border border-indigo-200/80 rounded-2xl flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">
              Selected Plan: {selectedPlan.name}
            </span>
            <span className="text-xs text-slate-600">
              {selectedPlan.monthlyPriceInPaise > 0
                ? `₹${selectedPlan.monthlyPriceInPaise / 100} / mailbox / mo`
                : 'Free tier'}{' '}
              · Up to {selectedPlan.seatCount} mailboxes
            </span>
          </div>
          <div className="text-right">
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
              {appliedCoupon
                ? `${60 + (appliedCoupon.extraTrialDays || 0)}-Day Free Trial`
                : '60-Day Free Trial'}
            </span>
            <span className="block text-[11px] text-slate-500 mt-0.5">₹0 charged today</span>
          </div>
        </div>
      )}

      {/* Promo Code Section */}
      {appliedCoupon ? (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between text-xs text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <div>
              <span className="font-bold tracking-wider">{appliedCoupon.code}</span>
              <span className="text-emerald-700 ml-1.5 font-medium">{appliedCoupon.message}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setAppliedCoupon(null);
              setCouponCode('');
            }}
            className="min-h-[36px] inline-flex items-center text-[11px] text-emerald-700 hover:text-emerald-900 underline cursor-pointer"
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {!showCouponInput ? (
            <button
              type="button"
              onClick={() => setShowCouponInput(true)}
              className="self-start min-h-[44px] inline-flex items-center text-xs font-semibold text-indigo-600 hover:text-indigo-700 gap-1.5 cursor-pointer"
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Have a promo code?</span>
            </button>
          ) : (
            <div className="flex flex-col gap-1.5 p-3 bg-slate-50 border border-slate-200 rounded-xl">
              <span className="text-[11px] font-semibold text-slate-700">Enter Promo or Coupon Code</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                  placeholder="e.g. STARTUP60"
                  className="flex-1 min-h-[44px] px-3 py-2 border border-slate-300 rounded-lg text-base sm:text-xs font-mono uppercase focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 bg-white"
                />
                <button
                  type="button"
                  onClick={handleApplyCoupon}
                  disabled={couponLoading || !couponCode.trim()}
                  className="min-h-[44px] px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {couponLoading ? 'Applying...' : 'Apply'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCouponInput(false);
                    setCouponError(null);
                  }}
                  className="min-h-[44px] px-2 inline-flex items-center text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
              {couponError && <p className="text-[11px] text-rose-600">{couponError}</p>}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Case A: Choose from Saved Cards */}
      {savedCards.length > 0 && !isAddingNew && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Payment Method on File
            </span>
            <button
              type="button"
              onClick={() => setIsAddingNew(true)}
              className="min-h-[44px] inline-flex items-center text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add new card</span>
            </button>
          </div>

          <div className="flex flex-col gap-2.5">
            {savedCards.map((card) => {
              const isSelected = selectedCardId === card.id;
              return (
                <div
                  key={card.id}
                  onClick={() => setSelectedCardId(card.id)}
                  className={`p-4 min-h-[56px] rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/40 ring-2 ring-indigo-600/10'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-10 h-7 rounded bg-slate-900 text-white flex items-center justify-center font-bold text-[10px] uppercase tracking-wider shadow-xs shrink-0">
                      {card.brand}
                    </div>
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-800">
                          •••• •••• •••• {card.last4}
                        </span>
                        {card.isDefault && (
                          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                            Default
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400">
                        Expires {String(card.expMonth).padStart(2, '0')}/{String(card.expYear).slice(-2)}
                      </span>
                    </div>
                  </div>

                  <div
                    className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                      isSelected
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="w-3.5 h-3.5" />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Explanation notice */}
          <p className="text-[11px] text-slate-500 leading-relaxed">
            This card will be used for your combined tenant billing. After the 60-day trial expires,
            monthly charges will apply only to the active mailboxes you create.
          </p>

          <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleUseSavedCard}
              disabled={submitting || !selectedCardId}
              className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold rounded-xl transition-all shadow-xs inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Confirming...</span>
                </>
              ) : (
                <>
                  <span>{submitLabel || 'Confirm & Complete Setup'}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            {showSkip && onSkip && (
              <button
                type="button"
                onClick={onSkip}
                disabled={submitting}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors cursor-pointer inline-flex items-center justify-center"
              >
                Skip for now
              </button>
            )}
          </div>
        </div>
      )}

      {/* Case B: Add New Card Form */}
      {(savedCards.length === 0 || isAddingNew) && (
        <div className="flex flex-col gap-5">
          {savedCards.length > 0 && (
            <button
              type="button"
              onClick={() => setIsAddingNew(false)}
              className="min-h-[44px] inline-flex items-center text-xs text-indigo-600 hover:text-indigo-700 hover:underline self-start cursor-pointer"
            >
              ← Back to saved cards
            </button>
          )}

          {/* Realistic Credit Card Preview Mockup */}
          <div className="relative w-full max-w-sm h-48 rounded-2xl p-5 sm:p-6 bg-gradient-to-tr from-slate-900 via-indigo-950 to-slate-800 text-white shadow-xl flex flex-col justify-between overflow-hidden border border-white/10 select-none mx-auto sm:mx-0">
            {/* Background Decorative Rings */}
            <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-white/5 pointer-events-none" />
            <div className="absolute right-10 -bottom-10 w-44 h-44 rounded-full bg-indigo-500/10 filter blur-xl pointer-events-none" />

            <div className="flex items-center justify-between z-10">
              {/* Chip graphic */}
              <div className="w-10 h-7 rounded-md bg-gradient-to-br from-amber-200 to-amber-400 border border-amber-300 shadow-inner flex flex-col justify-around p-1">
                <div className="w-full h-0.5 bg-amber-500/50 rounded" />
                <div className="w-full h-0.5 bg-amber-500/50 rounded" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-white/10 text-white/90">
                {cardBrand}
              </span>
            </div>

            <div className="z-10 tracking-[0.2em] font-mono text-lg font-medium text-white/90">
              {cardNumber || '•••• •••• •••• ••••'}
            </div>

            <div className="flex items-center justify-between text-xs z-10">
              <div className="flex flex-col">
                <span className="text-[9px] uppercase tracking-wider text-slate-400">Cardholder</span>
                <span className="font-medium tracking-wide uppercase truncate max-w-[170px]">
                  {cardholderName || 'Your Name'}
                </span>
              </div>
              <div className="flex flex-col text-right">
                <span className="text-[9px] uppercase tracking-wider text-slate-400">Expires</span>
                <span className="font-mono font-medium">{expiry || 'MM/YY'}</span>
              </div>
            </div>
          </div>

          {/* If Stripe is configured and we have a setup intent */}
          {publishableKey && setupClientSecret && stripeReady ? (
            <div className="pt-2">
              <PaymentMethodUpdateForm
                publishableKey={publishableKey}
                clientSecret={setupClientSecret}
                onDone={() => {
                  if (autoAttachDomainId) {
                    api.attachDomainWithSavedPayment(autoAttachDomainId).finally(() => onSuccess());
                  } else {
                    onSuccess();
                  }
                }}
              />
            </div>
          ) : (
            /* Built-in Sandbox / Development Card Input Form */
            <form onSubmit={handleSaveSandboxCard} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700">Cardholder Name</label>
                <input
                  type="text"
                  required
                  value={cardholderName}
                  onChange={(e) => setCardholderName(e.target.value)}
                  placeholder="e.g. Rahul Sharma"
                  className="px-3.5 py-2.5 min-h-[44px] rounded-xl border border-slate-300 text-base sm:text-xs focus:ring-2 focus:ring-indigo-600/15 focus:border-indigo-600 outline-none transition-all"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-700">Card Number</label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    maxLength={19}
                    value={cardNumber}
                    onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                    placeholder="4242 4242 4242 4242"
                    className="w-full pl-10 pr-4 py-2.5 min-h-[44px] rounded-xl border border-slate-300 text-base sm:text-xs font-mono focus:ring-2 focus:ring-indigo-600/15 focus:border-indigo-600 outline-none transition-all"
                  />
                  <CreditCard className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">Expires</label>
                  <input
                    type="text"
                    required
                    maxLength={5}
                    value={expiry}
                    onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                    placeholder="MM/YY"
                    className="px-2 sm:px-3 py-2.5 min-h-[44px] rounded-xl border border-slate-300 text-base sm:text-xs font-mono text-center focus:ring-2 focus:ring-indigo-600/15 focus:border-indigo-600 outline-none transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">CVC</label>
                  <input
                    type="password"
                    required
                    maxLength={4}
                    value={cvc}
                    onChange={(e) => setCvc(e.target.value.replace(/\D/g, ''))}
                    placeholder="123"
                    className="px-2 sm:px-3 py-2.5 min-h-[44px] rounded-xl border border-slate-300 text-base sm:text-xs font-mono text-center focus:ring-2 focus:ring-indigo-600/15 focus:border-indigo-600 outline-none transition-all"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">ZIP / PIN</label>
                  <input
                    type="text"
                    required
                    maxLength={10}
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    placeholder="400001"
                    className="px-2 sm:px-3 py-2.5 min-h-[44px] rounded-xl border border-slate-300 text-base sm:text-xs text-center sm:text-left focus:ring-2 focus:ring-indigo-600/15 focus:border-indigo-600 outline-none transition-all"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer py-1.5 min-h-[44px] select-none">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                <span className="text-xs text-slate-600">Set as default payment method</span>
              </label>

              {/* Security Badge */}
              <div className="p-3 bg-slate-50 border border-slate-200/80 rounded-xl flex items-center gap-2.5 text-[11px] text-slate-500">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  Encrypted with 256-bit SSL. 60-day trial with ₹0 charged today.
                </span>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-semibold rounded-xl transition-all shadow-xs inline-flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Saving Card...</span>
                    </>
                  ) : (
                    <>
                      <span>{submitLabel || 'Save & Start 60-Day Trial'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {showSkip && onSkip && (
                  <button
                    type="button"
                    onClick={onSkip}
                    disabled={submitting}
                    className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors cursor-pointer inline-flex items-center justify-center"
                  >
                    Skip for now
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
};
