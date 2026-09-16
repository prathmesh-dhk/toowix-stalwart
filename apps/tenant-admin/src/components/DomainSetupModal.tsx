import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { DomainItem, DomainDnsStatus, Plan } from '../types';
import {
  Globe,
  Check,
  AlertCircle,
  Loader2,
  X,
  ArrowRight,
  ArrowLeft,
  KeyRound,
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
type WizardStep = 'domain' | 'method' | 'setup' | 'status';
type SetupMethod = 'provider' | 'manual' | null;

const PROVIDER_LABEL: Record<DnsProvider, string> = {
  godaddy: 'GoDaddy',
  hostinger: 'Hostinger',
  cloudflare: 'Cloudflare',
};

const STEP_ORDER: WizardStep[] = ['domain', 'method', 'setup', 'status'];
const STEP_LABELS: Record<WizardStep, string> = {
  domain: 'Domain',
  method: 'Method',
  setup: 'Setup',
  status: 'Status',
};

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

  const handleCreateDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDomain = domainName.trim().toLowerCase();

    const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
    if (!cleanDomain || !domainRegex.test(cleanDomain)) {
      setError('Please enter a valid domain name (e.g. acme.com or mail.acme.com).');
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

  const domainValid = domainName.trim().length > 0 && !!selectedPlanId;
  const setupContinueDisabled = method === 'provider' && !connected;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 md:p-7 flex flex-col gap-5 my-8 animate-in fade-in zoom-in-95 page-content-scaled"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: back + close */}
        <div className="flex items-center justify-between">
          {currentIdx > 0 ? (
            <button
              type="button"
              onClick={goBack}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 px-2 py-1 rounded-lg transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back
            </button>
          ) : (
            <span />
          )}
          <button
            type="button"
            onClick={handleFinish}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stepper */}
        <div className="flex items-center -mt-2">
          {STEP_ORDER.map((s, idx) => {
            const done = idx < currentIdx;
            const current = idx === currentIdx;
            return (
              <div key={s} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1.5 shrink-0">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                      done
                        ? 'bg-indigo-600 border-indigo-600 text-white'
                        : current
                        ? 'bg-indigo-50 border-indigo-600 text-indigo-700'
                        : 'bg-slate-100 border-slate-200 text-slate-400'
                    }`}
                  >
                    {done ? <Check className="w-3 h-3" /> : idx + 1}
                  </div>
                  <span
                    className={`text-[10px] font-semibold whitespace-nowrap ${
                      done || current ? 'text-slate-700' : 'text-slate-400'
                    }`}
                  >
                    {STEP_LABELS[s]}
                  </span>
                </div>
                {idx < STEP_ORDER.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-1.5 mb-4 rounded ${done ? 'bg-indigo-600' : 'bg-slate-200'}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Title */}
        <div className="-mt-1">
          <h3 className="text-base font-semibold text-slate-900">
            {step === 'domain' && 'Add New Domain'}
            {step === 'method' && 'How do you want to set up DNS?'}
            {step === 'setup' && method === 'manual' && 'Manual DNS Setup'}
            {step === 'setup' && method === 'provider' && `Connect ${PROVIDER_LABEL[provider]}`}
            {step === 'status' && `DNS Setup — ${createdDomain?.domainName || ''}`}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {step === 'domain' && 'Connect an authoritative domain and allocate employee mailbox seats.'}
            {step === 'method' &&
              'Choose how MX, SPF, DKIM and DMARC records get published. You can always switch later.'}
            {step === 'setup' &&
              method === 'manual' &&
              `No credential needed — we generate everything for ${createdDomain?.domainName}.`}
            {step === 'setup' &&
              method === 'provider' &&
              `Enter a credential scoped to DNS management only for ${createdDomain?.domainName}.`}
            {step === 'status' && 'Track activation and configure records, whether or not a provider is connected.'}
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: DOMAIN */}
        {step === 'domain' && (
          <form onSubmit={handleCreateDomain} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="input-domain-name" className="text-xs font-semibold text-slate-800">
                Domain Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Globe className="w-4 h-4" />
                </div>
                <input
                  id="input-domain-name"
                  type="text"
                  required
                  placeholder="e.g. acme-tech.com or mail.brand.io"
                  value={domainName}
                  onChange={(e) => setDomainName(e.target.value.toLowerCase().trim())}
                  className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-all font-mono"
                />
              </div>
              <span className="text-[11px] text-slate-400">
                Must be an active domain or subdomain that you own and can manage DNS for.
              </span>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-800">
                  Plan &amp; Mailbox Quota <span className="text-rose-500">*</span>
                </label>
                <span className="text-[11px] font-medium text-slate-400">Select a seat tier</span>
              </div>

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
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[78px] ${
                          isSelected
                            ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20 shadow-xs'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50 bg-white'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className={`text-sm font-bold ${isSelected ? 'text-indigo-700' : 'text-slate-800'}`}>
                            {plan.seatCount} {plan.seatCount === 1 ? 'Seat' : 'Seats'}
                          </span>
                          {plan.badge && (
                            <span
                              className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                                isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {plan.badge}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-500 font-normal mt-1 truncate">
                          {plan.description || plan.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedPlanId && (
                <span className="text-[11px] text-slate-400">
                  This sets the domain limit to create up to{' '}
                  <strong className="text-slate-700 font-semibold">
                    {plans.find((p) => p.id === selectedPlanId)?.seatCount ?? 0} mailboxes
                  </strong>
                  .
                </span>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={handleFinish}
                disabled={loading}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !domainValid}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
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

        {/* STEP 2: METHOD */}
        {step === 'method' && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => chooseMethod('provider')}
              className="text-left p-4 rounded-2xl border-[1.5px] border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all cursor-pointer flex gap-3.5 items-start"
            >
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                <Zap className="w-[18px] h-[18px]" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-slate-900">Connect a DNS Provider</span>
                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    Automatic
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  GoDaddy, Hostinger or Cloudflare. Toowix verifies your credential and publishes every record for
                  you.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => chooseMethod('manual')}
              className="text-left p-4 rounded-2xl border-[1.5px] border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all cursor-pointer flex gap-3.5 items-start"
            >
              <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                <FileText className="w-[18px] h-[18px]" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-bold text-slate-900">Manual DNS Setup</span>
                  <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    No credential needed
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                  Get the exact records or a ready-made zone file, and add them yourself with any provider.
                </p>
              </div>
            </button>
          </div>
        )}

        {/* STEP 3: SETUP */}
        {step === 'setup' && (
          <div className="flex flex-col gap-4 animate-in fade-in">
            {method === 'provider' && (
              <>
                {connected ? (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-200/80 rounded-xl flex items-center gap-2.5">
                    <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                    <span className="text-xs font-medium text-emerald-800">
                      {PROVIDER_LABEL[provider]} connected and verified. Records will publish automatically once
                      this domain is activated.
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
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
                          className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                            provider === p ? 'bg-white text-indigo-700 shadow-xs' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          {PROVIDER_LABEL[p]}
                        </button>
                      ))}
                    </div>

                    <form onSubmit={handleConnectProvider} className="flex flex-col gap-3.5">
                      {provider === 'godaddy' && (
                        <>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Generate a Personal Access Token / API key+secret for this domain at{' '}
                            <span className="font-mono">developer.godaddy.com</span>, scoped to DNS management only.
                            Toowix verifies it manages this domain, then discards it once activation succeeds.
                          </p>
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="input-godaddy-key" className="text-xs font-semibold text-slate-800">
                              GoDaddy API Key <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <KeyRound className="w-4 h-4" />
                              </div>
                              <input
                                id="input-godaddy-key"
                                type="text"
                                required
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-all font-mono"
                              />
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="input-godaddy-secret" className="text-xs font-semibold text-slate-800">
                              GoDaddy API Secret <span className="text-rose-500">*</span>
                            </label>
                            <input
                              id="input-godaddy-secret"
                              type="password"
                              required
                              value={apiSecret}
                              onChange={(e) => setApiSecret(e.target.value)}
                              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-all font-mono"
                            />
                          </div>
                        </>
                      )}

                      {provider === 'hostinger' && (
                        <>
                          <p className="text-[11px] text-slate-500 leading-relaxed">
                            Generate an API token in hPanel at <span className="font-mono">hostinger.com</span>{' '}
                            (Profile &rarr; Business &amp; Dev Tools &rarr; API Access), scoped to DNS management
                            only. Toowix verifies it manages this domain, then discards it once activation succeeds.
                          </p>
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="input-provider-token" className="text-xs font-semibold text-slate-800">
                              Hostinger API Token <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <KeyRound className="w-4 h-4" />
                              </div>
                              <input
                                id="input-provider-token"
                                type="password"
                                required
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-all font-mono"
                              />
                            </div>
                          </div>
                        </>
                      )}

                      {provider === 'cloudflare' && (
                        <>
                          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col gap-1.5 text-xs text-slate-600 leading-relaxed">
                            <span className="font-semibold text-slate-800">How to create your Cloudflare API Token:</span>
                            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600">
                              <li>Go to <span className="font-mono font-medium">dash.cloudflare.com</span> &rarr; My Profile &rarr; <strong>API Tokens</strong></li>
                              <li>Click <strong>Create Token</strong> &rarr; use the <strong>Edit zone DNS</strong> template</li>
                              <li>Under Zone Resources, choose <strong>Include &rarr; Specific zone &rarr; {createdDomain?.domainName}</strong></li>
                              <li>Confirm permissions: <strong>Zone: DNS: Edit</strong> and <strong>Zone: Zone: Read</strong></li>
                              <li>Copy the generated 40-character token below (do not use Global API Key)</li>
                            </ol>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <label htmlFor="input-provider-token" className="text-xs font-semibold text-slate-800">
                              Cloudflare API Token <span className="text-rose-500">*</span>
                            </label>
                            <div className="relative">
                              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                                <KeyRound className="w-4 h-4" />
                              </div>
                              <input
                                id="input-provider-token"
                                type="password"
                                required
                                placeholder="Paste 40-character API Token"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600/20 focus:border-indigo-600 transition-all font-mono"
                              />
                            </div>
                            {/^[a-f0-9]{37}$/i.test(token.trim()) && (
                              <p className="text-[11px] text-amber-600 font-medium">
                                ⚠️ That looks like a Cloudflare Global API Key (37 hex chars). Cloudflare requires an <strong>API Token</strong> created via <em>My Profile &rarr; API Tokens &rarr; Create Token &rarr; "Edit zone DNS"</em> template.
                              </p>
                            )}
                          </div>
                        </>
                      )}

                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={
                            connecting ||
                            (provider === 'godaddy' ? !apiKey.trim() || !apiSecret.trim() : !token.trim())
                          }
                          className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
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
              <>
                <div className="p-3.5 bg-indigo-50 border border-indigo-200/80 rounded-xl">
                  <span className="text-xs font-semibold text-indigo-950 block">No credential required</span>
                  <span className="text-[11px] text-indigo-700 leading-relaxed block mt-1.5">
                    Once a Super Admin activates this domain, Toowix generates the exact MX, SPF, DKIM and DMARC
                    records for {createdDomain?.domainName} — plus a ready-to-import zone file. Add them to any
                    DNS provider yourself, at your own pace.
                  </span>
                </div>
                <div className="flex flex-col gap-2.5">
                  {[
                    'Works with any DNS provider — GoDaddy, Namecheap, Route 53, your own nameservers',
                    'Download or copy the full zone file to import with your DNS provider',
                    'We check public DNS automatically and activate as soon as it resolves',
                  ].map((line) => (
                    <div key={line} className="flex items-center gap-2.5 text-[11px] text-slate-600">
                      <div className="w-5 h-5 rounded-md bg-slate-100 flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3 text-slate-600" />
                      </div>
                      {line}
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="button"
                onClick={goToStatus}
                disabled={setupContinueDisabled}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <span>Continue</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: STATUS */}
        {step === 'status' && (
          <div className="flex flex-col gap-4 animate-in fade-in">
            <DnsStatusPanel
              domainName={createdDomain?.domainName || ''}
              status={dnsStatus}
              loading={statusLoading}
              error={statusError}
              onRefresh={refreshDnsStatus}
              connectedProviderLabel={method === 'provider' && connected ? PROVIDER_LABEL[provider] : null}
            />

            {!paymentCardDismissed && (
              <div className="p-3.5 bg-indigo-50 border border-indigo-200/80 rounded-xl">
                <div className="flex items-start gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                    <CreditCard className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-semibold text-indigo-950 block">Add a payment method</span>
                    <span className="text-[11px] text-indigo-700 leading-relaxed block mt-1">
                      Get 1 month free, then billed monthly for this domain's plan. You can skip this and add it
                      later — mailboxes just can't be created on this domain until you do.
                    </span>
                    {checkoutError && <span className="text-[11px] text-rose-600 block mt-1.5">{checkoutError}</span>}
                    <div className="flex items-center gap-2 mt-2.5">
                      <button
                        type="button"
                        onClick={handleStartCheckout}
                        disabled={startingCheckout}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg text-[11px] font-semibold shadow-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
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
                        className="px-3 py-1.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                      >
                        Skip for now
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
              <button
                type="button"
                onClick={handleFinish}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-2 cursor-pointer"
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
  );
};
