import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { DomainItem, DomainDnsStatus, Plan } from '../types';
import {
  Check,
  AlertCircle,
  Loader2,
  X,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  FileText,
  CreditCard,
  Globe,
} from 'lucide-react';
import { DnsStatusPanel } from './DnsStatusPanel';
import { DnsProviderCredentialForm } from './DnsProviderCredentialForm';

interface DomainSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDomainAdded: (domain: DomainItem) => void;
}

export type DnsProvider = 'godaddy' | 'hostinger' | 'cloudflare';
export type WizardStep = 'domain' | 'plan' | 'method' | 'godaddy' | 'hostinger' | 'cloudflare' | 'status';
export type SetupMethod = 'provider' | 'manual' | null;

export const PROVIDER_LABEL: Record<DnsProvider, string> = {
  godaddy: 'GoDaddy',
  hostinger: 'Hostinger',
  cloudflare: 'Cloudflare',
};

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

import { GoDaddyIcon, HostingerIcon, CloudflareIcon } from './ProviderIcons';

const inputClass =
  'w-full px-4 py-3 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600/15 focus:border-indigo-600 transition-all placeholder:text-slate-400 bg-white text-slate-900';

export const DomainSetupModal: React.FC<DomainSetupModalProps> = ({
  isOpen,
  onClose,
  onDomainAdded,
}) => {
  const [step, setStep] = useState<WizardStep>('domain');
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [domainName, setDomainName] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  const [createdDomain, setCreatedDomain] = useState<DomainItem | null>(null);
  const [method, setMethod] = useState<SetupMethod>(null);
  const [provider, setProvider] = useState<DnsProvider>('godaddy');
  const [connected, setConnected] = useState(false);

  const [dnsStatus, setDnsStatus] = useState<DomainDnsStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [paymentCardDismissed, setPaymentCardDismissed] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(true);

  const detectionRef = useRef<Promise<{ provider: DnsProvider | null; nameservers: string[] }> | null>(null);
  const [methodAutoSkipped, setMethodAutoSkipped] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPlansLoading(true);
    Promise.resolve()
      .then(() => api.getBillingConfig?.())
      .then((cfg) => {
        if (cfg && cfg.billingEnabled !== undefined) {
          setBillingEnabled(cfg.billingEnabled);
        }
      })
      .catch(() => {});

    api
      .listPlans()
      .then((res) => {
        setPlans(res.plans);
        setSelectedPlanId((current) => current ?? res.plans[0]?.id ?? null);
      })
      .catch((err) => setError(err.message || 'Failed to load available plans.'))
      .finally(() => setPlansLoading(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const navigateTo = (nextStep: WizardStep) => {
    setDirection('forward');
    setStep(nextStep);
  };

  const navigateBack = (prevStep: WizardStep) => {
    setDirection('backward');
    setStep(prevStep);
  };

  const getStepNumber = (): { current: number; total: number } => {
    if (step === 'domain') return { current: 1, total: 4 };
    if (step === 'plan') return { current: 2, total: 4 };
    if (step === 'method') return { current: 3, total: 4 };
    if (step === 'godaddy' || step === 'hostinger' || step === 'cloudflare') {
      return { current: 4, total: 5 };
    }
    if (method === 'provider') return { current: 5, total: 5 };
    return { current: 4, total: 4 };
  };

  const handleContinueDomainStep = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDomain = domainName.trim().toLowerCase();
    if (!cleanDomain || !DOMAIN_REGEX.test(cleanDomain)) {
      setError('Please enter a valid domain name (e.g. acme.com or mail.brand.io).');
      return;
    }
    setError(null);
    setCheckingAvailability(true);
    try {
      const { available } = await api.checkDomainAvailability(cleanDomain);
      if (!available) {
        setError(`'${cleanDomain}' is already registered on Toowix. Please enter a different domain.`);
        return;
      }
    } catch (err: any) {
      setError(err.message || 'Could not check domain availability. Please try again.');
      return;
    } finally {
      setCheckingAvailability(false);
    }
    detectionRef.current = api
      .detectDnsProvider(cleanDomain)
      .catch(() => ({ provider: null, nameservers: [] }));
    navigateTo('plan');
  };

  const handlePlanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDomain = domainName.trim().toLowerCase();

    if (!cleanDomain || !DOMAIN_REGEX.test(cleanDomain)) {
      setError('Please enter a valid domain name (e.g. acme.com or mail.brand.io).');
      navigateBack('domain');
      return;
    }
    if (!selectedPlanId) {
      setError('Please select a plan.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const detection = detectionRef.current
        ? await detectionRef.current
        : { provider: null, nameservers: [] };

      if (detection.provider === 'godaddy') {
        setProvider('godaddy');
        setMethod('provider');
        setMethodAutoSkipped(true);
        navigateTo('godaddy');
      } else if (detection.provider === 'hostinger') {
        setProvider('hostinger');
        setMethod('provider');
        setMethodAutoSkipped(true);
        navigateTo('hostinger');
      } else if (detection.provider === 'cloudflare') {
        setProvider('cloudflare');
        setMethod('provider');
        setMethodAutoSkipped(true);
        navigateTo('cloudflare');
      } else {
        // No automated provider detected:
        // "if the tenant has choosed manual setup then the domain can be created"
        const res = await api.createTenantDomain({
          domainName: cleanDomain,
          planId: selectedPlanId,
        });

        setCreatedDomain(res.domain);
        setMethod('manual');
        setMethodAutoSkipped(true);
        goToStatus(res.domain);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to proceed with domain setup.');
    } finally {
      setLoading(false);
    }
  };

  const handleChooseManualSetup = async () => {
    const cleanDomain = domainName.trim().toLowerCase();
    if (!cleanDomain || !DOMAIN_REGEX.test(cleanDomain)) {
      setError('Please enter a valid domain name.');
      navigateBack('domain');
      return;
    }
    if (!selectedPlanId) {
      setError('Please select a plan.');
      navigateBack('plan');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      let dom = createdDomain;
      if (!dom) {
        const res = await api.createTenantDomain({
          domainName: cleanDomain,
          planId: selectedPlanId,
        });
        dom = res.domain;
        setCreatedDomain(dom);
      }
      setMethod('manual');
      setMethodAutoSkipped(false);
      goToStatus(dom);
    } catch (err: any) {
      setError(err.message || 'Failed to create domain for manual setup.');
    } finally {
      setLoading(false);
    }
  };

  const refreshDnsStatus = async (targetDomain?: DomainItem | null) => {
    const dom = targetDomain || createdDomain;
    if (!dom) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await api.getDomainDnsStatus(dom.id);
      setDnsStatus(res);
    } catch (err: any) {
      setStatusError(err.message || 'Failed to load DNS status.');
    } finally {
      setStatusLoading(false);
    }
  };

  const goToStatus = (targetDomain?: DomainItem | null) => {
    navigateTo('status');
    refreshDnsStatus(targetDomain);
  };

  const handleStartCheckout = async () => {
    if (!createdDomain) return;
    setStartingCheckout(true);
    setCheckoutError(null);
    try {
      const res = await api.startDomainCheckout(createdDomain.id);
      if ('url' in res) {
        window.location.href = res.url;
      } else {
        setPaymentCardDismissed(true);
        setStartingCheckout(false);
      }
    } catch (err: any) {
      setCheckoutError(err.message || 'Failed to start checkout.');
      setStartingCheckout(false);
    }
  };

  const goBack = () => {
    setError(null);
    if (step === 'plan') {
      navigateBack('domain');
    } else if (step === 'method') {
      navigateBack('plan');
    } else if (step === 'godaddy' || step === 'hostinger' || step === 'cloudflare') {
      navigateBack('method');
    } else if (step === 'status') {
      if (method === 'provider') {
        navigateBack(provider);
      } else {
        navigateBack('method');
      }
    }
  };

  const handleClose = async () => {
    // If the domain was created, but setup was cancelled or interrupted before completing on status:
    if (createdDomain && step !== 'status') {
      try {
        await api.deleteDomain(createdDomain.id);
      } catch (err) {
        console.warn('Could not clean up cancelled domain:', err);
      }
    } else if (createdDomain && step === 'status') {
      // Manual setup or verified provider setup completed
      onDomainAdded(createdDomain);
    }

    setStep('domain');
    setDirection('forward');
    setDomainName('');
    setSelectedPlanId(plans[0]?.id ?? null);
    setError(null);
    setCreatedDomain(null);
    setMethod(null);
    setProvider('godaddy');
    setConnected(false);
    setMethodAutoSkipped(false);
    detectionRef.current = null;
    setDnsStatus(null);
    setStatusError(null);
    setPaymentCardDismissed(false);
    setCheckoutError(null);
    onClose();
  };

  const handleFinish = () => {
    if (createdDomain) {
      onDomainAdded(createdDomain);
    }
    setStep('domain');
    setDirection('forward');
    setDomainName('');
    setSelectedPlanId(plans[0]?.id ?? null);
    setError(null);
    setCreatedDomain(null);
    setMethod(null);
    setProvider('godaddy');
    setConnected(false);
    setMethodAutoSkipped(false);
    detectionRef.current = null;
    setDnsStatus(null);
    setStatusError(null);
    setPaymentCardDismissed(false);
    setCheckoutError(null);
    onClose();
  };

  const domainNameValid = domainName.trim().length > 0;
  const stepInfo = getStepNumber();

  let headline: React.ReactNode = null;
  let subhead: React.ReactNode = null;
  if (step === 'domain') {
    headline = "Let's start with your domain name";
    subhead = "You'll need to own this domain and be able to manage its DNS.";
  } else if (step === 'plan') {
    headline = 'Choose a plan';
    subhead = 'Sets how many mailboxes this domain can create — you can change it anytime.';
  } else if (step === 'method') {
    headline = 'How do you want to set up DNS?';
    subhead = 'Pick your DNS provider for automatic setup, or configure records manually.';
  } else if (step === 'godaddy') {
    headline = 'Connect GoDaddy';
    subhead = `Scoped to DNS management only, for ${createdDomain?.domainName || domainName}.`;
  } else if (step === 'hostinger') {
    headline = 'Connect Hostinger';
    subhead = `Scoped to DNS management only, for ${createdDomain?.domainName || domainName}.`;
  } else if (step === 'cloudflare') {
    headline = 'Connect Cloudflare';
    subhead = `Scoped to DNS management only, for ${createdDomain?.domainName || domainName}.`;
  } else if (step === 'status') {
    headline = `DNS Setup — ${createdDomain?.domainName || domainName}`;
    subhead = 'Track activation and grab your records, whether or not a provider is connected.';
  }

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto" role="dialog" aria-modal="true">
      <div className="min-h-screen flex flex-col">
        {/* Top bar: close + back, step counter */}
        <div className="flex items-center justify-between px-6 md:px-10 py-5 shrink-0 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleClose}
              className="p-2 -ml-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
            {step !== 'domain' && (
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}
          </div>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Step {stepInfo.current} of {stepInfo.total}
          </span>
        </div>

        {/* Centered single-focus content with slide animation */}
        <div className="flex-1 flex items-start md:items-center justify-center px-6 pb-16 overflow-hidden">
          <div
            key={step}
            className={`w-full max-w-[560px] py-6 ${
              direction === 'forward' ? 'animate-slide-in-right' : 'animate-slide-in-left'
            }`}
          >
            {step === 'domain' && (
              <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 block mb-2">
                Add New Domain
              </span>
            )}
            <h1 className="text-[26px] md:text-[30px] font-bold text-slate-900 leading-[1.15] tracking-tight">
              {headline}
            </h1>
            {subhead && <p className="text-sm text-slate-500 mt-2.5 leading-relaxed">{subhead}</p>}

            {error && (
              <div className="mt-6 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* STEP 1: DOMAIN */}
            {step === 'domain' && (
              <form onSubmit={handleContinueDomainStep} className="mt-8 flex flex-col gap-8">
                <div className="flex flex-col gap-1.5">
                  <input
                    id="input-domain-name"
                    type="text"
                    required
                    autoFocus
                    placeholder="e.g. acme-tech.com or mail.brand.io"
                    value={domainName}
                    onChange={(e) => setDomainName(e.target.value.toLowerCase().trim())}
                    className={`${inputClass} font-mono`}
                  />
                  <span className="text-[11px] text-slate-400">
                    We'll ask you to prove ownership before mail starts flowing.
                  </span>
                </div>

                <div>
                  <button
                    type="submit"
                    disabled={!domainNameValid || checkingAvailability}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-semibold shadow-xs hover:shadow transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {checkingAvailability ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Checking availability...</span>
                      </>
                    ) : (
                      <>
                        <span>Continue</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2: PLAN */}
            {step === 'plan' && (
              <form onSubmit={handlePlanSubmit} className="mt-8 flex flex-col gap-8">
                {plansLoading && plans.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">Loading plans…</p>
                ) : plans.length === 0 ? (
                  <p className="text-xs text-rose-500 py-2">No plans are available right now. Please try again shortly.</p>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {plans.map((plan) => {
                      const isSelected = selectedPlanId === plan.id;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setSelectedPlanId(plan.id)}
                          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[82px] ${
                            isSelected
                              ? 'border-indigo-600 bg-indigo-50/50 ring-1 ring-indigo-600'
                              : 'border-slate-200 hover:border-slate-300 bg-white'
                          }`}
                        >
                          <span className={`text-sm font-bold ${isSelected ? 'text-indigo-700' : 'text-slate-800'}`}>
                            {plan.billingMode === 'metered'
                              ? plan.name
                              : `${plan.seatCount} ${plan.seatCount === 1 ? 'Seat' : 'Seats'}`}
                          </span>
                          <span className="text-[11px] text-slate-400 mt-1 truncate">
                            {plan.billingMode === 'metered'
                              ? plan.badge || 'Pay as you go'
                              : plan.badge || plan.description || plan.name}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div>
                  <button
                    type="submit"
                    disabled={loading || !selectedPlanId}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-semibold shadow-xs hover:shadow transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    id="btn-submit-domain-wizard"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Creating Domain...</span>
                      </>
                    ) : (
                      <>
                        <span>Continue</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 3: METHOD (SSO-STYLE ICON BUTTONS & MANUAL SETUP) */}
            {step === 'method' && (
              <div className="mt-8 flex flex-col gap-3">
                {/* GoDaddy SSO Button */}
                <button
                  type="button"
                  aria-label="GoDaddy"
                  onClick={() => {
                    setProvider('godaddy');
                    setMethod('provider');
                    setMethodAutoSkipped(false);
                    setError(null);
                    setConnected(false);
                    navigateTo('godaddy');
                  }}
                  className="w-full group px-5 py-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 transition-all cursor-pointer flex items-center justify-between shadow-xs hover:shadow-sm bg-white"
                >
                  <div className="flex items-center gap-3.5">
                    <GoDaddyIcon className="w-7 h-7 shrink-0" />
                    <div className="text-left">
                      <span className="text-sm font-semibold text-slate-900 block">
                        Connect with GoDaddy
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        Automated DNS record provisioning
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all" />
                </button>

                {/* Hostinger SSO Button */}
                <button
                  type="button"
                  aria-label="Hostinger"
                  onClick={() => {
                    setProvider('hostinger');
                    setMethod('provider');
                    setMethodAutoSkipped(false);
                    setError(null);
                    setConnected(false);
                    navigateTo('hostinger');
                  }}
                  className="w-full group px-5 py-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 transition-all cursor-pointer flex items-center justify-between shadow-xs hover:shadow-sm bg-white"
                >
                  <div className="flex items-center gap-3.5">
                    <HostingerIcon className="w-7 h-7 shrink-0" />
                    <div className="text-left">
                      <span className="text-sm font-semibold text-slate-900 block">
                        Connect with Hostinger
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        Automated DNS record provisioning
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all" />
                </button>

                {/* Cloudflare SSO Button */}
                <button
                  type="button"
                  aria-label="Cloudflare"
                  onClick={() => {
                    setProvider('cloudflare');
                    setMethod('provider');
                    setMethodAutoSkipped(false);
                    setError(null);
                    setConnected(false);
                    navigateTo('cloudflare');
                  }}
                  className="w-full group px-5 py-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 transition-all cursor-pointer flex items-center justify-between shadow-xs hover:shadow-sm bg-white"
                >
                  <div className="flex items-center gap-3.5">
                    <CloudflareIcon className="w-7 h-7 shrink-0" />
                    <div className="text-left">
                      <span className="text-sm font-semibold text-slate-900 block">
                        Connect with Cloudflare
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        Automated DNS record provisioning
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all" />
                </button>

                {/* Clean Divider */}
                <div className="relative my-2.5">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-slate-200" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-white px-3 text-slate-400 font-medium uppercase tracking-wider text-[10px]">
                      or
                    </span>
                  </div>
                </div>

                {/* Manual Setup Button */}
                <button
                  type="button"
                  aria-label="Manual DNS Setup"
                  onClick={handleChooseManualSetup}
                  className="w-full group px-5 py-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all cursor-pointer flex items-center justify-between shadow-xs hover:shadow-sm bg-white"
                >
                  <div className="flex items-center gap-3.5">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="text-left">
                      <span className="text-sm font-semibold text-slate-900 block group-hover:text-indigo-950">
                        Manual DNS Setup
                      </span>
                      <span className="text-[11px] text-slate-500 block">
                        No credentials needed • Works with any registrar or DNS host
                      </span>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                </button>
              </div>
            )}

            {/* DEDICATED PAGE: GODADDY */}
            {step === 'godaddy' && (
              <div className="mt-8 flex flex-col gap-6">
                <div className="flex items-center gap-2">
                  <GoDaddyIcon className="w-5 h-5 shrink-0" />
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    GoDaddy DNS Management
                  </span>
                </div>

                {methodAutoSkipped && (
                  <div className="p-3 bg-indigo-50 border border-indigo-200/80 rounded-xl text-xs text-indigo-800 flex items-center justify-between">
                    <span>
                      We detected <strong>GoDaddy</strong> manages this domain's DNS.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMethodAutoSkipped(false);
                        navigateBack('method');
                      }}
                      className="text-indigo-600 font-semibold hover:underline cursor-pointer ml-2 shrink-0"
                    >
                      Switch provider
                    </button>
                  </div>
                )}

                <DnsProviderCredentialForm
                  domainId={createdDomain?.id}
                  domainName={createdDomain?.domainName || domainName.trim().toLowerCase()}
                  planId={selectedPlanId || undefined}
                  provider="godaddy"
                  onSuccess={(info, newDom) => {
                    const dom = newDom ?? createdDomain;
                    if (dom) setCreatedDomain(dom);
                    setConnected(true);
                    goToStatus(dom);
                  }}
                />
              </div>
            )}

            {/* DEDICATED PAGE: HOSTINGER */}
            {step === 'hostinger' && (
              <div className="mt-8 flex flex-col gap-6">
                <div className="flex items-center gap-2">
                  <HostingerIcon className="w-5 h-5 shrink-0" />
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Hostinger DNS Management
                  </span>
                </div>

                {methodAutoSkipped && (
                  <div className="p-3 bg-indigo-50 border border-indigo-200/80 rounded-xl text-xs text-indigo-800 flex items-center justify-between">
                    <span>
                      We detected <strong>Hostinger</strong> manages this domain's DNS.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMethodAutoSkipped(false);
                        navigateBack('method');
                      }}
                      className="text-indigo-600 font-semibold hover:underline cursor-pointer ml-2 shrink-0"
                    >
                      Switch provider
                    </button>
                  </div>
                )}

                <DnsProviderCredentialForm
                  domainId={createdDomain?.id}
                  domainName={createdDomain?.domainName || domainName.trim().toLowerCase()}
                  planId={selectedPlanId || undefined}
                  provider="hostinger"
                  onSuccess={(info, newDom) => {
                    const dom = newDom ?? createdDomain;
                    if (dom) setCreatedDomain(dom);
                    setConnected(true);
                    goToStatus(dom);
                  }}
                />
              </div>
            )}

            {/* DEDICATED PAGE: CLOUDFLARE */}
            {step === 'cloudflare' && (
              <div className="mt-8 flex flex-col gap-6">
                <div className="flex items-center gap-2">
                  <CloudflareIcon className="w-5 h-5 shrink-0" />
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Cloudflare DNS Management
                  </span>
                </div>

                {methodAutoSkipped && (
                  <div className="p-3 bg-indigo-50 border border-indigo-200/80 rounded-xl text-xs text-indigo-800 flex items-center justify-between">
                    <span>
                      We detected <strong>Cloudflare</strong> manages this domain's DNS.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMethodAutoSkipped(false);
                        navigateBack('method');
                      }}
                      className="text-indigo-600 font-semibold hover:underline cursor-pointer ml-2 shrink-0"
                    >
                      Switch provider
                    </button>
                  </div>
                )}

                <DnsProviderCredentialForm
                  domainId={createdDomain?.id}
                  domainName={createdDomain?.domainName || domainName.trim().toLowerCase()}
                  planId={selectedPlanId || undefined}
                  provider="cloudflare"
                  onSuccess={(info, newDom) => {
                    const dom = newDom ?? createdDomain;
                    if (dom) setCreatedDomain(dom);
                    setConnected(true);
                    goToStatus(dom);
                  }}
                />
              </div>
            )}

            {/* STEP 5: STATUS */}
            {step === 'status' && (
              <div className="mt-8 flex flex-col gap-5">
                {methodAutoSkipped && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 flex items-center justify-between">
                    <span>
                      We couldn't detect GoDaddy, Hostinger, or Cloudflare managing this domain.
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setMethodAutoSkipped(false);
                        navigateBack('method');
                      }}
                      className="text-indigo-600 font-semibold hover:underline cursor-pointer ml-2 shrink-0"
                    >
                      Connect a provider instead
                    </button>
                  </div>
                )}
                <DnsStatusPanel
                  domainName={createdDomain?.domainName || domainName}
                  status={dnsStatus}
                  loading={statusLoading}
                  error={statusError}
                  onRefresh={refreshDnsStatus}
                  connectedProviderLabel={method === 'provider' && connected ? PROVIDER_LABEL[provider] : null}
                />

                {billingEnabled && !paymentCardDismissed && (
                  <div className="p-4 bg-indigo-50 border border-indigo-200/80 rounded-xl">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                        <CreditCard className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-indigo-950 block">Add a payment method</span>
                        <span className="text-[11px] text-indigo-700 leading-relaxed block mt-1">
                          One month free, then billed monthly for this domain's plan. Skip this and add it later —
                          mailboxes just can't be created here until you do.
                        </span>
                        {checkoutError && (
                          <span className="text-[11px] text-rose-600 block mt-1.5">{checkoutError}</span>
                        )}
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            type="button"
                            onClick={handleStartCheckout}
                            disabled={startingCheckout}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg text-[11px] font-semibold shadow-xs transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            {startingCheckout ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin" />
                                <span>Redirecting...</span>
                              </>
                            ) : (
                              <span>Add Payment Method</span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPaymentCardDismissed(true)}
                            disabled={startingCheckout}
                            className="px-3 py-2 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            Skip for now
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <button
                    type="button"
                    onClick={handleFinish}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-semibold shadow-xs hover:shadow transition-all inline-flex items-center gap-2 cursor-pointer"
                    id="btn-complete-domain-setup"
                  >
                    <span>Done</span>
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
