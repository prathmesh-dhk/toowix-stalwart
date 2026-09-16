import React, { useState, useEffect } from 'react';
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
  Zap,
  FileText,
  CreditCard,
} from 'lucide-react';
import { DnsStatusPanel } from './DnsStatusPanel';

interface DomainSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDomainAdded: (domain: DomainItem) => void;
}

type DnsProvider = 'godaddy' | 'hostinger' | 'cloudflare';
type WizardStep = 'domain' | 'plan' | 'method' | 'setup' | 'status';
type SetupMethod = 'provider' | 'manual' | null;

const PROVIDER_LABEL: Record<DnsProvider, string> = {
  godaddy: 'GoDaddy',
  hostinger: 'Hostinger',
  cloudflare: 'Cloudflare',
};

const STEP_ORDER: WizardStep[] = ['domain', 'plan', 'method', 'setup', 'status'];
const DOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const inputClass =
  'w-full px-4 py-3 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600/15 focus:border-indigo-600 transition-all placeholder:text-slate-400';

export const DomainSetupModal: React.FC<DomainSetupModalProps> = ({
  isOpen,
  onClose,
  onDomainAdded,
}) => {
  const [step, setStep] = useState<WizardStep>('domain');
  const [domainName, setDomainName] = useState('');
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createdDomain, setCreatedDomain] = useState<DomainItem | null>(null);
  const [method, setMethod] = useState<SetupMethod>(null);
  const [provider, setProvider] = useState<DnsProvider>('godaddy');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  const [dnsStatus, setDnsStatus] = useState<DomainDnsStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const [paymentCardDismissed, setPaymentCardDismissed] = useState(false);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setPlansLoading(true);
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

  const currentIdx = STEP_ORDER.indexOf(step);

  const handleContinueDomainStep = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDomain = domainName.trim().toLowerCase();
    if (!cleanDomain || !DOMAIN_REGEX.test(cleanDomain)) {
      setError('Please enter a valid domain name (e.g. acme.com or mail.acme.com).');
      return;
    }
    setError(null);
    setStep('plan');
  };

  const handleCreateDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDomain = domainName.trim().toLowerCase();

    if (!cleanDomain || !DOMAIN_REGEX.test(cleanDomain)) {
      setError('Please enter a valid domain name (e.g. acme.com or mail.acme.com).');
      setStep('domain');
      return;
    }
    if (!selectedPlanId) {
      setError('Please select a plan.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Creates the domain record only — Stalwart/DNS provisioning happens
      // later when a Super Admin clicks "Activate Domain".
      const res = await api.createTenantDomain({
        domainName: cleanDomain,
        planId: selectedPlanId,
      });

      setCreatedDomain(res.domain);
      setStep('method');
    } catch (err: any) {
      setError(err.message || 'Failed to create domain. Please check if it already exists.');
    } finally {
      setLoading(false);
    }
  };

  const chooseMethod = (m: SetupMethod) => {
    setMethod(m);
    setError(null);
    setStep('setup');
  };

  const handleConnectProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createdDomain) return;
    setConnecting(true);
    setError(null);
    try {
      const cleanToken = token
        .trim()
        .replace(/^['"]+|['"]+$/g, '')
        .replace(/^bearer\s+/i, '')
        .trim();
      const credential =
        provider === 'godaddy'
          ? { provider: 'godaddy' as const, apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }
          : { provider, token: cleanToken };
      await api.connectDnsProviderCredential(createdDomain.id, credential);
      setConnected(true);
    } catch (err: any) {
      setError(err.message || `Could not verify this ${PROVIDER_LABEL[provider]} credential against the domain.`);
    } finally {
      setConnecting(false);
    }
  };

  const refreshDnsStatus = async () => {
    if (!createdDomain) return;
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await api.getDomainDnsStatus(createdDomain.id);
      setDnsStatus(res);
    } catch (err: any) {
      setStatusError(err.message || 'Failed to load DNS status.');
    } finally {
      setStatusLoading(false);
    }
  };

  const goToStatus = () => {
    setStep('status');
    refreshDnsStatus();
  };

  const handleStartCheckout = async () => {
    if (!createdDomain) return;
    setStartingCheckout(true);
    setCheckoutError(null);
    try {
      const res = await api.startDomainCheckout(createdDomain.id);
      window.location.href = res.url;
    } catch (err: any) {
      setCheckoutError(err.message || 'Failed to start checkout.');
      setStartingCheckout(false);
    }
  };

  const goBack = () => {
    if (currentIdx > 0) {
      setStep(STEP_ORDER[currentIdx - 1]);
    }
  };

  const handleFinish = () => {
    if (createdDomain) {
      onDomainAdded(createdDomain);
    }
    // Reset state and close
    setStep('domain');
    setDomainName('');
    setSelectedPlanId(plans[0]?.id ?? null);
    setError(null);
    setCreatedDomain(null);
    setMethod(null);
    setProvider('godaddy');
    setApiKey('');
    setApiSecret('');
    setToken('');
    setConnecting(false);
    setConnected(false);
    setDnsStatus(null);
    setStatusError(null);
    setPaymentCardDismissed(false);
    setCheckoutError(null);
    onClose();
  };

  const domainNameValid = domainName.trim().length > 0;
  const setupContinueDisabled = method === 'provider' && !connected;

  let headline: React.ReactNode = null;
  let subhead: React.ReactNode = null;
  if (step === 'domain') {
    headline = 'Add New Domain';
    subhead = "You'll need to own this domain and be able to manage its DNS.";
  } else if (step === 'plan') {
    headline = 'Choose a plan';
    subhead = 'Sets how many mailboxes this domain can create — you can change it anytime.';
  } else if (step === 'method') {
    headline = 'How do you want to set up DNS?';
    subhead = 'Pick one — you can switch later if it turns out to be the wrong call.';
  } else if (step === 'setup' && method === 'manual') {
    headline = 'Manual DNS Setup';
    subhead = `No credential needed. We generate everything for ${createdDomain?.domainName}.`;
  } else if (step === 'setup' && method === 'provider') {
    headline = `Connect ${PROVIDER_LABEL[provider]}`;
    subhead = `Scoped to DNS management only, for ${createdDomain?.domainName}.`;
  } else if (step === 'status') {
    headline = `DNS Setup — ${createdDomain?.domainName || ''}`;
    subhead = 'Track activation and grab your records, whether or not a provider is connected.';
  }

  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto" role="dialog" aria-modal="true">
      <div className="min-h-screen flex flex-col">
        {/* Top bar: close + back, minimal step counter */}
        <div className="flex items-center justify-between px-6 md:px-10 py-5 shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleFinish}
              className="p-2 -ml-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
            {currentIdx > 0 && (
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
            Step {currentIdx + 1} of {STEP_ORDER.length}
          </span>
        </div>

        {/* Centered, single-focus content */}
        <div className="flex-1 flex items-start md:items-center justify-center px-6 pb-16">
          <div className="w-full max-w-[560px] py-6">
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
                    disabled={!domainNameValid}
                    className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-semibold shadow-xs hover:shadow transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <span>Continue</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2: PLAN */}
            {step === 'plan' && (
              <form onSubmit={handleCreateDomain} className="mt-8 flex flex-col gap-8">
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

            {/* STEP 3: METHOD */}
            {step === 'method' && (
              <div className="mt-8 flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => chooseMethod('provider')}
                  className="text-left p-5 rounded-2xl border border-slate-200 hover:border-indigo-400 transition-all cursor-pointer flex gap-4 items-start"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center shrink-0">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-bold text-slate-900">Connect a DNS Provider</span>
                    <span className="text-[11px] font-medium text-slate-400 block mt-0.5">Automatic</span>
                    <p className="text-[12px] text-slate-500 mt-1.5 leading-relaxed">
                      GoDaddy, Hostinger or Cloudflare. We verify your credential and publish every record for you.
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => chooseMethod('manual')}
                  className="text-left p-5 rounded-2xl border border-slate-200 hover:border-indigo-400 transition-all cursor-pointer flex gap-4 items-start"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-500 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm font-bold text-slate-900">Manual DNS Setup</span>
                    <span className="text-[11px] font-medium text-slate-400 block mt-0.5">No credential needed</span>
                    <p className="text-[12px] text-slate-500 mt-1.5 leading-relaxed">
                      Get the records or a ready-made zone file, and add them yourself with any provider.
                    </p>
                  </div>
                </button>
              </div>
            )}

            {/* STEP 4: SETUP */}
            {step === 'setup' && (
              <div className="mt-8 flex flex-col gap-6">
                {method === 'provider' && (
                  <>
                    {connected ? (
                      <div className="p-4 bg-emerald-50 border border-emerald-200/80 rounded-xl flex items-center gap-3">
                        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                        <span className="text-xs font-medium text-emerald-800">
                          {PROVIDER_LABEL[provider]} connected and verified. Records will publish automatically once
                          this domain is activated.
                        </span>
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl w-fit">
                          {(['godaddy', 'hostinger', 'cloudflare'] as const).map((p) => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => {
                                setProvider(p);
                                setApiKey('');
                                setApiSecret('');
                                setToken('');
                                setConnected(false);
                              }}
                              className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                provider === p ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              {PROVIDER_LABEL[p]}
                            </button>
                          ))}
                        </div>

                        <form onSubmit={handleConnectProvider} className="flex flex-col gap-4">
                          {provider === 'godaddy' && (
                            <>
                              <p className="text-xs text-slate-500 leading-relaxed">
                                Generate a Personal Access Token / API key+secret at{' '}
                                <span className="font-mono">developer.godaddy.com</span>. We discard it once
                                activation succeeds.
                              </p>
                              <div className="flex flex-col gap-1.5">
                                <label htmlFor="input-godaddy-key" className="text-xs font-semibold text-slate-700">
                                  GoDaddy API Key
                                </label>
                                <input
                                  id="input-godaddy-key"
                                  type="text"
                                  required
                                  value={apiKey}
                                  onChange={(e) => setApiKey(e.target.value)}
                                  className={`${inputClass} font-mono`}
                                />
                              </div>
                              <div className="flex flex-col gap-1.5">
                                <label htmlFor="input-godaddy-secret" className="text-xs font-semibold text-slate-700">
                                  GoDaddy API Secret
                                </label>
                                <input
                                  id="input-godaddy-secret"
                                  type="password"
                                  required
                                  value={apiSecret}
                                  onChange={(e) => setApiSecret(e.target.value)}
                                  className={`${inputClass} font-mono`}
                                />
                              </div>
                            </>
                          )}

                          {provider === 'hostinger' && (
                            <>
                              <p className="text-xs text-slate-500 leading-relaxed">
                                Generate an API token in hPanel at <span className="font-mono">hostinger.com</span>{' '}
                                (Profile &rarr; Business &amp; Dev Tools &rarr; API Access). We discard it once
                                activation succeeds.
                              </p>
                              <div className="flex flex-col gap-1.5">
                                <label htmlFor="input-provider-token" className="text-xs font-semibold text-slate-700">
                                  Hostinger API Token
                                </label>
                                <input
                                  id="input-provider-token"
                                  type="password"
                                  required
                                  value={token}
                                  onChange={(e) => setToken(e.target.value)}
                                  className={`${inputClass} font-mono`}
                                />
                              </div>
                            </>
                          )}

                          {provider === 'cloudflare' && (
                            <>
                              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-1.5 text-xs text-slate-600 leading-relaxed">
                                <span className="font-semibold text-slate-800">Creating your Cloudflare API Token:</span>
                                <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600">
                                  <li>
                                    Go to <span className="font-mono font-medium">dash.cloudflare.com</span> &rarr; My
                                    Profile &rarr; <strong>API Tokens</strong>
                                  </li>
                                  <li>
                                    Click <strong>Create Token</strong> &rarr; use the <strong>Edit zone DNS</strong>{' '}
                                    template
                                  </li>
                                  <li>
                                    Zone Resources: <strong>Include &rarr; Specific zone &rarr; {createdDomain?.domainName}</strong>
                                  </li>
                                  <li>
                                    Confirm permissions: <strong>Zone: DNS: Edit</strong> and <strong>Zone: Zone: Read</strong>
                                  </li>
                                  <li>Copy the 40-character token below (not the Global API Key)</li>
                                </ol>
                              </div>
                              <div className="flex flex-col gap-1.5">
                                <label htmlFor="input-provider-token" className="text-xs font-semibold text-slate-700">
                                  Cloudflare API Token
                                </label>
                                <input
                                  id="input-provider-token"
                                  type="password"
                                  required
                                  placeholder="Paste 40-character API Token"
                                  value={token}
                                  onChange={(e) => setToken(e.target.value)}
                                  className={`${inputClass} font-mono`}
                                />
                                {/^[a-f0-9]{37}$/i.test(token.trim()) && (
                                  <p className="text-[11px] text-amber-600 font-medium">
                                    That looks like a Global API Key (37 hex chars). Cloudflare needs an{' '}
                                    <strong>API Token</strong> instead — My Profile &rarr; API Tokens &rarr; Create
                                    Token &rarr; "Edit zone DNS".
                                  </p>
                                )}
                              </div>
                            </>
                          )}

                          <div>
                            <button
                              type="submit"
                              disabled={
                                connecting ||
                                (provider === 'godaddy' ? !apiKey.trim() || !apiSecret.trim() : !token.trim())
                              }
                              className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-semibold shadow-xs hover:shadow transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {connecting ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  <span>Verifying...</span>
                                </>
                              ) : (
                                <>
                                  <span>Verify &amp; Connect</span>
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                </>
                              )}
                            </button>
                          </div>
                        </form>
                      </>
                    )}
                  </>
                )}

                {method === 'manual' && (
                  <div className="flex flex-col gap-2.5">
                    <p className="text-xs font-semibold text-indigo-950">No credential required</p>
                    {[
                      'Works with any DNS provider — GoDaddy, Namecheap, Route 53, your own nameservers',
                      'Copy each record, or import the whole zone file at once',
                      'We check public DNS automatically and activate as soon as it resolves',
                    ].map((line) => (
                      <div key={line} className="flex items-start gap-2.5 text-xs text-slate-600">
                        <Check className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        <span>{line}</span>
                      </div>
                    ))}
                  </div>
                )}

                {(method === 'manual' || connected) && (
                  <div>
                    <button
                      type="button"
                      onClick={goToStatus}
                      disabled={setupContinueDisabled}
                      className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-semibold shadow-xs hover:shadow transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <span>Continue</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* STEP 5: STATUS */}
            {step === 'status' && (
              <div className="mt-8 flex flex-col gap-5">
                <DnsStatusPanel
                  domainName={createdDomain?.domainName || ''}
                  status={dnsStatus}
                  loading={statusLoading}
                  error={statusError}
                  onRefresh={refreshDnsStatus}
                  connectedProviderLabel={method === 'provider' && connected ? PROVIDER_LABEL[provider] : null}
                />

                {!paymentCardDismissed && (
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
