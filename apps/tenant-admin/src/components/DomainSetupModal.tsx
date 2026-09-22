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
  Mail,
  Sparkles,
  HelpCircle,
} from 'lucide-react';
import { DnsStatusPanel } from './DnsStatusPanel';
import { DnsProviderCredentialForm, type SuccessInfo } from './DnsProviderCredentialForm';
import { WizardStepGraphic } from './WizardStepGraphic';

interface DomainSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDomainAdded: (domain: DomainItem) => void;
}

export type DnsProvider = 'godaddy' | 'hostinger' | 'cloudflare';
export type WizardStep = 'choice' | 'domain' | 'plan' | 'method' | 'godaddy' | 'hostinger' | 'cloudflare' | 'status';
export type SetupMethod = 'provider' | 'manual' | null;

export const PROVIDER_LABEL: Record<DnsProvider, string> = {
  godaddy: 'GoDaddy',
  hostinger: 'Hostinger',
  cloudflare: 'Cloudflare',
};

const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

// Mirrors the backend's default config.platformMailDomain — used only for display copy before the
// modal has fetched anything from the server that would name it.
const PLATFORM_MAIL_DOMAIN = 'dhkmail.com';

/**
 * Per-step vertical positioning:
 * Shorter content steps (e.g. domain name input) are positioned lower down to sit in the vertical
 * center of the screen, while taller content steps (e.g. manual DNS zone file) start higher up.
 */
const STEP_TOP_PADDING: Record<WizardStep, string> = {
  choice: 'pt-12 sm:pt-16 md:pt-20 lg:pt-24 xl:pt-[19vh]',
  domain: 'pt-14 sm:pt-20 md:pt-28 lg:pt-36 xl:pt-[26vh]',
  plan: 'pt-12 sm:pt-16 md:pt-20 lg:pt-24 xl:pt-[19vh]',
  method: 'pt-10 sm:pt-14 md:pt-16 lg:pt-20 xl:pt-[16vh]',
  godaddy: 'pt-12 sm:pt-16 md:pt-20 lg:pt-24 xl:pt-[20vh]',
  hostinger: 'pt-14 sm:pt-18 md:pt-22 lg:pt-28 xl:pt-[22vh]',
  cloudflare: 'pt-14 sm:pt-18 md:pt-22 lg:pt-28 xl:pt-[22vh]',
  status: 'pt-8 sm:pt-12 lg:pt-16 xl:pt-[12vh]',
};

import { GoDaddyIcon, HostingerIcon, CloudflareIcon } from './ProviderIcons';

export const DomainSetupModal: React.FC<DomainSetupModalProps> = ({
  isOpen,
  onClose,
  onDomainAdded,
}) => {
  const [domainName, setDomainName] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Wizard state: choice -> [domain -> plan -> method -> provider/status] OR [plan -> done]
  const [step, setStep] = useState<WizardStep>('choice');
  const [direction, setDirection] = useState<'forward' | 'backward'>('forward');
  const [createdDomain, setCreatedDomain] = useState<DomainItem | null>(null);
  // dhkmail.com is a full substitute for owning a domain: no domain name, no DNS/provider steps —
  // picking it at the choice step goes straight from plan selection to a working subscription.
  const [isSharedDomain, setIsSharedDomain] = useState(false);
  const [dhkmailSubmitting, setDhkmailSubmitting] = useState(false);

  // Method state
  const [method, setMethod] = useState<SetupMethod>(null);
  const [provider, setProvider] = useState<DnsProvider>('godaddy');
  const [methodAutoSkipped, setMethodAutoSkipped] = useState(false);

  // Status step state
  const [dnsStatus, setDnsStatus] = useState<DomainDnsStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Payment method CTA state on the status step
  const [paymentCardDismissed, setPaymentCardDismissed] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [billingEnabled, setBillingEnabled] = useState(true);

  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const detectedProviderPromiseRef = useRef<Promise<any> | null>(null);

  // Fetch plans when modal opens
  useEffect(() => {
    if (!isOpen) return;
    setPlansLoading(true);
    api
      .listPlans()
      .then((res) => {
        const sorted = (res.plans || [])
          .filter((p) => p.isActive)
          .sort((a, b) => a.displayOrder - b.displayOrder);
        setPlans(sorted);
        const def = sorted.find((p) => p.isDefault) || sorted[0];
        if (def) setSelectedPlanId(def.id);
      })
      .catch(() => {})
      .finally(() => setPlansLoading(false));

    Promise.resolve()
      .then(() => (api as any).getBillingConfig?.())
      .then((cfg: any) => {
        if (cfg && cfg.billingEnabled !== undefined) {
          setBillingEnabled(cfg.billingEnabled);
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // A domain is created (in MongoDB AND in Stalwart) the moment a setup method is chosen, but it only
  // "belongs" to the tenant once the wizard reports it through onDomainAdded. Anything created and then
  // abandoned must be deleted again, or it lingers in Stalwart with nothing in the tenant's list.
  const createdRef = useRef<DomainItem | null>(null);
  const committedRef = useRef(false);
  // Bumped on every close, so a request that finishes after the wizard was closed knows it was cancelled.
  const sessionRef = useRef(0);

  const discardDomain = (dom: DomainItem) => {
    void (async () => {
      try {
        await api.deleteDomain(dom.id);
      } catch (err) {
        console.warn('[DomainSetup] Could not remove the abandoned domain:', err);
      }
    })();
  };

  /** Registers a newly created domain. Returns false (after deleting it) if the wizard was closed meanwhile. */
  const adoptCreatedDomain = (dom: DomainItem, session: number): boolean => {
    if (session !== sessionRef.current) {
      discardDomain(dom);
      return false;
    }
    createdRef.current = dom;
    setCreatedDomain(dom);
    return true;
  };

  /** Hands the domain to the tenant. From here on it must survive the wizard closing. */
  const commitDomain = (dom: DomainItem) => {
    committedRef.current = true;
    onDomainAdded(dom);
  };

  // Reset all state when modal closes
  const handleClose = () => {
    if (createdRef.current && !committedRef.current) discardDomain(createdRef.current);
    createdRef.current = null;
    committedRef.current = false;
    sessionRef.current += 1;
    if (pollingRef.current) clearInterval(pollingRef.current);
    detectedProviderPromiseRef.current = null;
    setDomainName('');
    setSelectedPlanId('');
    setLoading(false);
    setCheckingAvailability(false);
    setError(null);
    setStep('choice');
    setDirection('forward');
    setCreatedDomain(null);
    setIsSharedDomain(false);
    setDhkmailSubmitting(false);
    setMethod(null);
    setProvider('godaddy');
    setMethodAutoSkipped(false);
    setDnsStatus(null);
    setStatusLoading(false);
    setStatusError(null);
    setConnected(false);
    setPaymentCardDismissed(false);
    setStartingCheckout(false);
    setCheckoutError(null);
    onClose();
  };

  const navigateTo = (nextStep: WizardStep) => {
    setDirection('forward');
    setStep(nextStep);
  };

  const navigateBack = (prevStep: WizardStep) => {
    setDirection('backward');
    setStep(prevStep);
  };

  // Back button handler
  const goBack = () => {
    setError(null);
    if (step === 'domain') {
      navigateBack('choice');
    } else if (step === 'plan') {
      navigateBack(isSharedDomain ? 'choice' : 'domain');
    } else if (step === 'method') {
      navigateBack('plan');
    } else if (step === 'godaddy' || step === 'hostinger' || step === 'cloudflare') {
      navigateBack('method');
    } else if (step === 'status') {
      if (methodAutoSkipped) {
        navigateBack('method');
      } else if (method === 'provider') {
        navigateBack(provider);
      } else {
        navigateBack('method');
      }
    }
  };

  // STEP 1 -> STEP 2: DOMAIN SUBMIT
  const handleContinueDomainStep = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = domainName.trim().toLowerCase();
    if (!clean) return;

    if (!DOMAIN_REGEX.test(clean)) {
      setError('Please enter a valid domain name (e.g. yourcompany.com)');
      return;
    }

    setCheckingAvailability(true);
    setError(null);

    // Coming back to this step after the wizard already created a domain. Same name: it is ours, and
    // asking "is it taken?" would answer yes — by us. A different name replaces it, so the old one is
    // deleted rather than left behind in Stalwart.
    const keepingCreated = createdDomain?.domainName === clean;
    if (createdDomain && !keepingCreated) {
      discardDomain(createdDomain);
      createdRef.current = null;
      setCreatedDomain(null);
      if (pollingRef.current) clearInterval(pollingRef.current);
      setDnsStatus(null);
      setConnected(false);
    }

    if (!keepingCreated) {
      try {
        const avail = await api.checkDomainAvailability(clean);
        if (!avail.available) {
          setError(
            avail.ownedByYou
              ? "You've already added this domain to your organization. Manage it from the Domains tab."
              : 'This domain is already registered on Toowix by another organization. If you own it, contact support.'
          );
          setCheckingAvailability(false);
          return;
        }
      } catch {
        // If check fails, allow continuing
      }
    }

    detectedProviderPromiseRef.current = api.detectDnsProvider(clean).catch(() => null);

    setCheckingAvailability(false);
    navigateTo('plan');
  };

  // STEP 2 (dhkmail): PLAN SUBMIT -> already-active subscription, no DNS/status step at all.
  const handleDhkmailPlanSubmit = async () => {
    setDhkmailSubmitting(true);
    try {
      const res = await api.startDhkmailCheckout(selectedPlanId);
      if ('url' in res && res.url) {
        // First billing item for this tenant — hand off to Stripe Checkout, same as a first owned
        // domain would. The tenant lands back in the app once payment is set up.
        window.location.href = res.url;
        return;
      }
      // Already had a Stripe subscription (another domain, or a re-attach) — active immediately.
      const status = await api.getDhkmailBillingStatus();
      const domainItem: DomainItem = {
        id: status.domainId,
        domainName: status.domainName,
        status: 'active',
        dnsStatus: 'active',
        mailboxLimit: 0,
        employeeCount: 0,
        mailboxCount: 0,
        isPrimary: false,
        isSharedDomain: true,
      };
      commitDomain(domainItem);
      handleClose();
    } catch (err: any) {
      setError(err?.message || `Failed to set up ${PLATFORM_MAIL_DOMAIN}. Please try again.`);
    } finally {
      setDhkmailSubmitting(false);
    }
  };

  // STEP 2 -> STEP 3: PLAN SUBMIT
  const handlePlanSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPlanId) {
      setError('Please select a plan to continue');
      return;
    }

    setError(null);

    if (isSharedDomain) {
      await handleDhkmailPlanSubmit();
      return;
    }

    setLoading(true);

    const session = sessionRef.current;
    try {
      const clean = domainName.trim().toLowerCase();
      let detected: DnsProvider | null = null;
      try {
        const detRes = detectedProviderPromiseRef.current
          ? await detectedProviderPromiseRef.current
          : await api.detectDnsProvider(clean);
        detected = detRes?.provider || null;
      } catch {
        detected = null;
      }

      setLoading(false);
      if (session !== sessionRef.current) return; // cancelled while detecting

      if (detected) {
        setProvider(detected);
        setMethod('provider');
        setMethodAutoSkipped(true);
        navigateTo(detected);
      } else {
        setMethod('manual');
        setMethodAutoSkipped(true);
        let dom = createdDomain;
        if (!dom) {
          try {
            const createRes = await api.createTenantDomain({
              domainName: clean,
              planId: selectedPlanId || undefined,
            });
            if (!adoptCreatedDomain(createRes.domain, session)) return;
            dom = createRes.domain;
          } catch {
            // ignore
          }
        }
        goToStatus(dom);
      }
    } catch (err: any) {
      setLoading(false);
      setError(err?.message || 'Failed to detect DNS configuration. Please try again.');
    }
  };

  // STEP 3: USER CHOOSES MANUAL SETUP
  const handleChooseManualSetup = async () => {
    setError(null);
    setMethod('manual');
    setMethodAutoSkipped(false);

    if (!createdDomain) {
      setLoading(true);
      const session = sessionRef.current;
      try {
        const clean = domainName.trim().toLowerCase();
        const res = await api.createTenantDomain({
          domainName: clean,
          planId: selectedPlanId || undefined,
        });
        if (!adoptCreatedDomain(res.domain, session)) return;
        goToStatus(res.domain);
      } catch (err: any) {
        setError(err?.message || 'Failed to initialize domain. Please try again.');
      } finally {
        setLoading(false);
      }
      return;
    }

    goToStatus(createdDomain);
  };

  // ADVANCE TO STATUS STEP
  const goToStatus = (domainOverride?: DomainItem | null) => {
    const targetDomain = domainOverride !== undefined ? domainOverride : createdDomain;
    navigateTo('status');
    if (targetDomain) {
      refreshDnsStatus(targetDomain.id);
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(() => {
        refreshDnsStatus(targetDomain.id);
      }, 5000);
    }
  };

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const refreshDnsStatus = async (domainId?: string) => {
    const id = domainId || createdDomain?.id;
    if (!id) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await api.getDomainDnsStatus(id);
      setDnsStatus(res);
    } catch (err: any) {
      setStatusError(err?.message || 'Failed to refresh DNS status');
    } finally {
      setStatusLoading(false);
    }
  };

  const handleStartCheckout = async () => {
    if (!createdDomain) return;
    setStartingCheckout(true);
    setCheckoutError(null);
    try {
      const res = await api.startDomainCheckout(createdDomain.id);
      if (res?.url) {
        window.location.href = res.url;
      } else {
        setCheckoutError('Checkout session could not be created. You can add payment later in Domain Settings.');
      }
    } catch (err: any) {
      setCheckoutError(err?.message || 'Failed to initiate checkout. You can add payment later.');
    } finally {
      setStartingCheckout(false);
    }
  };

  const handleFinish = () => {
    if (createdDomain) {
      commitDomain(createdDomain);
    }
    handleClose();
  };

  // Snapshot for the provider form: it may finish connecting after this render's wizard was closed.
  const renderSession = sessionRef.current;

  const handleProviderSuccess = (info: SuccessInfo, newDom: DomainItem | undefined, session: number) => {
    if (newDom ? !adoptCreatedDomain(newDom, session) : session !== sessionRef.current) return;

    const dom = newDom ?? createdDomain;
    setConnected(true);
    if (info.usedSavedKey) {
      if (dom) commitDomain(dom);
      handleClose();
    } else {
      goToStatus(dom);
    }
  };

  if (!isOpen) return null;

  const domainNameValid = domainName.trim().length > 0;

  let headline: React.ReactNode = null;
  let subhead: React.ReactNode = null;
  if (step === 'choice') {
    headline = 'How do you want to add a domain?';
    subhead = 'Connect a domain you already own, or use a Toowix-owned domain instead.';
  } else if (step === 'domain') {
    headline = (
      <span className="flex items-baseline flex-wrap gap-2">
        <span>Let's start with a name for your domain</span>
        <button
          type="button"
          title="You'll need DNS management access to complete domain verification."
          className="inline-flex text-slate-400 hover:text-slate-600 transition-colors"
        >
          <HelpCircle className="w-[18px] h-[18px] translate-y-0.5" />
        </button>
      </span>
    );
    subhead = "You'll need to own this domain and be able to manage its DNS records.";
  } else if (step === 'plan') {
    headline = 'Choose a plan';
    subhead = isSharedDomain
      ? `Sets how many ${PLATFORM_MAIL_DOMAIN} mailboxes your organisation can create — you can change it anytime.`
      : 'Sets how many mailboxes this domain can create — you can change it anytime.';
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

  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto overflow-x-hidden" role="dialog" aria-modal="true">
      <div className="min-h-screen flex flex-col bg-white overflow-x-hidden">
        {/* Top bar: close, title, back */}
        <div className="flex items-center justify-between px-6 sm:px-8 md:px-10 lg:px-12 pt-7 pb-4 shrink-0 bg-white sticky top-0 z-20">
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={handleClose}
              className="p-1 -ml-1 text-slate-400 hover:text-slate-800 transition-colors rounded-md focus:outline-none cursor-pointer"
              aria-label="Exit domain setup"
            >
              <X className="w-6 h-6 stroke-[2.3]" />
            </button>
            <span className="text-slate-900 font-semibold text-lg sm:text-xl tracking-tight select-none">
              Add a domain
            </span>
            {step !== 'choice' && (
              <button
                type="button"
                onClick={goBack}
                className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 px-3.5 py-1.5 rounded-lg transition-colors cursor-pointer ml-3 border border-slate-300"
              >
                <ArrowLeft className="w-4 h-4" />
                Back
              </button>
            )}
          </div>
        </div>

        {/* Unified Single-Focus Layout across all wizard pages */}
        <div
          key={step}
          className={`flex-1 flex flex-row items-start w-full bg-white pl-6 sm:pl-12 md:pl-20 lg:pl-28 xl:pl-[13vw] pr-6 sm:pr-8 overflow-x-hidden ${
            direction === 'backward' ? 'animate-slide-in-left' : 'animate-slide-in-right'
          }`}
        >
          <main className={`w-full max-w-xl shrink-0 ${STEP_TOP_PADDING[step]} pb-12 flex flex-col text-left`}>
            {error && (
              <div className="mb-6 p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* STEP 0: CHOICE — own domain vs. dhkmail.com */}
            {step === 'choice' && (
              <div>
                <div className="mb-8">
                  <h1 className="text-3xl sm:text-[34px] font-bold text-slate-900 tracking-tight leading-[1.15]">
                    How do you want to add a domain?
                  </h1>
                  <p className="text-slate-500 text-[15px] mt-3 font-normal leading-relaxed">
                    Connect a domain you already own, or use a Toowix-owned domain instead.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    aria-label="Connect a domain you own"
                    onClick={() => {
                      setIsSharedDomain(false);
                      setError(null);
                      navigateTo('domain');
                    }}
                    className="w-full group px-5 py-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between bg-white text-left"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                        <Globe className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-slate-900 block">
                          Connect a domain you own
                        </span>
                        <span className="text-[11px] text-slate-500 block">
                          Use your own domain name for mailboxes — DNS setup required
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-transform" />
                  </button>

                  <button
                    type="button"
                    aria-label={`Use ${PLATFORM_MAIL_DOMAIN} instead`}
                    onClick={() => {
                      setIsSharedDomain(true);
                      setError(null);
                      navigateTo('plan');
                    }}
                    className="w-full group px-5 py-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20 transition-colors cursor-pointer flex items-center justify-between bg-white text-left"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-slate-900 block group-hover:text-indigo-950">
                          Use {PLATFORM_MAIL_DOMAIN} instead
                        </span>
                        <span className="text-[11px] text-slate-500 block">
                          No domain to buy or DNS to configure — mailboxes work immediately
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 1: DOMAIN */}
            {step === 'domain' && (
              <div>
                <div className="mb-8">
                  <h1 className="text-3xl sm:text-[34px] font-bold text-slate-900 tracking-tight leading-[1.15]">
                    <span>Let's start with a name for your domain</span>
                    <button
                      type="button"
                      className="inline-flex ml-2.5 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer align-middle -translate-y-0.5"
                      title="Domain setup info"
                      onClick={() => window.open('https://toowix.com/docs/dns', '_blank')}
                    >
                      <HelpCircle className="w-5 h-5 text-slate-400 hover:text-slate-600" />
                    </button>
                  </h1>
                  <p className="text-slate-500 text-[15px] mt-3 font-normal leading-relaxed">
                    You'll need to own this domain and be able to manage its DNS records.
                  </p>
                </div>

                <form id="domain-setup-form" onSubmit={handleContinueDomainStep} className="space-y-6">
                  <div>
                    <label className="sr-only" htmlFor="domain-input">Enter your domain name</label>
                    <input
                      id="domain-input"
                      name="domain"
                      type="text"
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                      placeholder="Enter your domain name"
                      value={domainName}
                      onChange={(e) => {
                        let val = e.target.value.toLowerCase().trim();
                        if (val.startsWith('https://')) val = val.replace('https://', '');
                        if (val.startsWith('http://')) val = val.replace('http://', '');
                        if (val.startsWith('www.')) val = val.replace('www.', '');
                        if (val.includes('/')) val = val.split('/')[0];
                        setDomainName(val);
                      }}
                      className="w-full px-4 py-3.5 bg-white text-slate-900 placeholder:text-slate-400 text-lg border border-slate-300 rounded-lg focus:border-indigo-600 transition-colors outline-none font-sans"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      id="continue-button"
                      type="submit"
                      disabled={!domainNameValid || checkingAvailability}
                      className="inline-flex items-center justify-center px-8 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-medium text-sm rounded-lg transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      data-purpose="submit-domain"
                    >
                      {checkingAvailability ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Checking availability...</span>
                        </span>
                      ) : (
                        <span>Continue</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* STEP 2: PLAN */}
            {step === 'plan' && (
              <div>
                <div className="mb-8">
                  <h1 className="text-3xl sm:text-[34px] font-bold text-slate-900 tracking-tight leading-[1.15]">
                    Choose a plan
                  </h1>
                  <p className="text-slate-500 text-[15px] mt-3 font-normal leading-relaxed">
                    Select seat capacity for this domain. You can adjust this later.
                  </p>
                </div>

                <form onSubmit={handlePlanSubmit} className="space-y-8">
                  {plansLoading && plans.length === 0 ? (
                    <p className="text-xs text-slate-400 py-2">Loading plans…</p>
                  ) : plans.length === 0 ? (
                    <p className="text-xs text-rose-500 py-2">No plans are available right now. Please try again shortly.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5">
                      {plans.map((plan) => {
                        const isSelected = selectedPlanId === plan.id;
                        return (
                          <button
                            key={plan.id}
                            type="button"
                            onClick={() => setSelectedPlanId(plan.id)}
                            className={`p-4 rounded-xl border-2 text-left transition-colors cursor-pointer flex flex-col justify-between min-h-[104px] ${
                              isSelected
                                ? 'border-indigo-600 bg-indigo-50/40 text-indigo-900'
                                : 'border-slate-200 hover:border-slate-300 bg-white text-slate-800'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span
                                className={`text-base font-bold ${
                                  isSelected ? 'text-indigo-700' : 'text-slate-900'
                                }`}
                              >
                                {plan.billingMode === 'metered'
                                  ? plan.name
                                  : `${plan.seatCount} ${plan.seatCount === 1 ? 'Seat' : 'Seats'}`}
                              </span>
                              {isSelected && (
                                <div className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0">
                                  <Check className="w-3 h-3" />
                                </div>
                              )}
                            </div>
                            <span className="text-xs text-slate-500 mt-2 truncate">
                              {plan.billingMode === 'metered'
                                ? plan.badge || 'Pay as you go'
                                : plan.badge || plan.description || plan.name}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="pt-2 flex items-center gap-4">
                    <button
                      type="submit"
                      disabled={loading || dhkmailSubmitting || !selectedPlanId}
                      className="inline-flex items-center justify-center px-8 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-medium text-sm rounded-lg transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      id="btn-submit-domain-wizard"
                    >
                      {loading || dhkmailSubmitting ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>{isSharedDomain ? 'Setting up...' : 'Detecting DNS provider...'}</span>
                        </span>
                      ) : (
                        <span>Continue</span>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* STEP 3: METHOD */}
            {step === 'method' && (
              <div>
                <div className="mb-8">
                  <h1 className="text-3xl sm:text-[34px] font-bold text-slate-900 tracking-tight leading-[1.15]">
                    How do you want to set up DNS?
                  </h1>
                  <p className="text-slate-500 text-[15px] mt-3 font-normal leading-relaxed">
                    Pick your DNS provider for automatic setup, or configure records manually.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
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
                    className="w-full group px-5 py-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between bg-white text-left"
                  >
                    <div className="flex items-center gap-3.5">
                      <GoDaddyIcon className="w-7 h-7 shrink-0" />
                      <div>
                        <span className="text-sm font-semibold text-slate-900 block">
                          Connect with GoDaddy
                        </span>
                        <span className="text-[11px] text-slate-500 block">
                          Automated DNS record provisioning
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-transform" />
                  </button>

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
                    className="w-full group px-5 py-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between bg-white text-left"
                  >
                    <div className="flex items-center gap-3.5">
                      <HostingerIcon className="w-7 h-7 shrink-0" />
                      <div>
                        <span className="text-sm font-semibold text-slate-900 block">
                          Connect with Hostinger
                        </span>
                        <span className="text-[11px] text-slate-500 block">
                          Automated DNS record provisioning
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-transform" />
                  </button>

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
                    className="w-full group px-5 py-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between bg-white text-left"
                  >
                    <div className="flex items-center gap-3.5">
                      <CloudflareIcon className="w-7 h-7 shrink-0" />
                      <div>
                        <span className="text-sm font-semibold text-slate-900 block">
                          Connect with Cloudflare
                        </span>
                        <span className="text-[11px] text-slate-500 block">
                          Automated DNS record provisioning
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-transform" />
                  </button>

                  <div className="relative my-2">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-white px-3 text-slate-400 font-medium uppercase tracking-wider text-[10px]">
                        or
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    aria-label="Manual DNS Setup"
                    onClick={handleChooseManualSetup}
                    className="w-full group px-5 py-4 rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20 transition-colors cursor-pointer flex items-center justify-between bg-white text-left"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 group-hover:bg-indigo-100 group-hover:text-indigo-600 transition-colors">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-sm font-semibold text-slate-900 block group-hover:text-indigo-950">
                          Manual DNS Setup
                        </span>
                        <span className="text-[11px] text-slate-500 block">
                          No credentials needed • Works with any registrar or DNS host
                        </span>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-transform" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3 PROVIDER: GODADDY */}
            {step === 'godaddy' && (
              <div>
                <div className="mb-8">
                  <h1 className="text-3xl sm:text-[34px] font-bold text-slate-900 tracking-tight leading-[1.15]">
                    Connect GoDaddy
                  </h1>
                  <p className="text-slate-500 text-[15px] mt-3 font-normal leading-relaxed">
                    Scoped to DNS management only, for {createdDomain?.domainName || domainName}.
                  </p>
                </div>

                {methodAutoSkipped && (
                  <div className="mb-6 p-3 bg-indigo-50 border border-indigo-200/80 rounded-xl text-xs text-indigo-900 flex items-center justify-between">
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
                  theme="light"
                  onSuccess={(info, newDom) => handleProviderSuccess(info, newDom, renderSession)}
                />
              </div>
            )}

            {/* STEP 3 PROVIDER: HOSTINGER */}
            {step === 'hostinger' && (
              <div>
                <div className="mb-8">
                  <h1 className="text-3xl sm:text-[34px] font-bold text-slate-900 tracking-tight leading-[1.15]">
                    Connect Hostinger
                  </h1>
                  <p className="text-slate-500 text-[15px] mt-3 font-normal leading-relaxed">
                    Scoped to DNS management only, for {createdDomain?.domainName || domainName}.
                  </p>
                </div>

                {methodAutoSkipped && (
                  <div className="mb-6 p-3 bg-indigo-50 border border-indigo-200/80 rounded-xl text-xs text-indigo-900 flex items-center justify-between">
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
                  theme="light"
                  onSuccess={(info, newDom) => handleProviderSuccess(info, newDom, renderSession)}
                />
              </div>
            )}

            {/* STEP 3 PROVIDER: CLOUDFLARE */}
            {step === 'cloudflare' && (
              <div>
                <div className="mb-8">
                  <h1 className="text-3xl sm:text-[34px] font-bold text-slate-900 tracking-tight leading-[1.15]">
                    Connect Cloudflare
                  </h1>
                  <p className="text-slate-500 text-[15px] mt-3 font-normal leading-relaxed">
                    Scoped to DNS management only, for {createdDomain?.domainName || domainName}.
                  </p>
                </div>

                {methodAutoSkipped && (
                  <div className="mb-6 p-3 bg-indigo-50 border border-indigo-200/80 rounded-xl text-xs text-indigo-900 flex items-center justify-between">
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
                  theme="light"
                  onSuccess={(info, newDom) => handleProviderSuccess(info, newDom, renderSession)}
                />
              </div>
            )}

            {/* STEP 4: STATUS */}
            {step === 'status' && (
              <div className="flex flex-col gap-6">
                <div className="mb-2">
                  <h1 className="text-3xl sm:text-[34px] font-bold text-slate-900 tracking-tight leading-[1.15]">
                    {headline}
                  </h1>
                  {methodAutoSkipped ? (
                    <p className="text-slate-500 text-[15px] mt-3 font-normal leading-relaxed">
                      We couldn't detect GoDaddy, Hostinger, or Cloudflare managing this domain.{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setMethodAutoSkipped(false);
                          navigateBack('method');
                        }}
                        className="text-indigo-600 font-semibold hover:underline cursor-pointer inline"
                      >
                        Connect a provider instead
                      </button>
                    </p>
                  ) : (
                    <p className="text-slate-500 text-[15px] mt-3 font-normal leading-relaxed">
                      {subhead}
                    </p>
                  )}
                </div>

                <DnsStatusPanel
                  domainName={createdDomain?.domainName || domainName}
                  status={dnsStatus}
                  loading={statusLoading}
                  error={statusError}
                  onRefresh={() => refreshDnsStatus()}
                  connectedProviderLabel={method === 'provider' && connected ? PROVIDER_LABEL[provider] : null}
                  theme="light"
                />

                {billingEnabled && !paymentCardDismissed && (
                  <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-xl">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                        <CreditCard className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-semibold text-slate-900 block">Add a payment method</span>
                        <span className="text-[11px] text-slate-600 leading-relaxed block mt-1">
                          One month free, then billed monthly for this domain's plan. Skip this and add it later —
                          mailboxes just can't be created here until you do.
                        </span>
                        {checkoutError && (
                          <span className="text-[11px] text-rose-500 block mt-1.5">{checkoutError}</span>
                        )}
                        <div className="flex items-center gap-2 mt-3">
                          <button
                            type="button"
                            onClick={handleStartCheckout}
                            disabled={startingCheckout}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg text-xs font-semibold transition-colors inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
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
                            className="px-3 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          >
                            Skip for now
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleFinish}
                    className="px-8 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg text-sm font-semibold transition-colors inline-flex items-center gap-2 cursor-pointer"
                    id="btn-complete-domain-setup"
                  >
                    <span>Done</span>
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </main>

          {/* Right Graphic: Positioned in right space on desktop, unique per step */}
          <div className={`hidden xl:flex flex-1 items-start justify-center ${STEP_TOP_PADDING[step]} pl-10 select-none pointer-events-none sticky top-0`}>
            <WizardStepGraphic
              step={step}
              domainName={createdDomain?.domainName || domainName}
              selectedPlan={plans.find((p) => p.id === selectedPlanId)}
              provider={provider}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
