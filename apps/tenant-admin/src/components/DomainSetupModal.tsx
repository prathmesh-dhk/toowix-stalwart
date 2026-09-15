import React, { useState } from 'react';
import { api } from '../api';
import { DomainItem } from '../types';
import {
  Globe,
  Check,
  AlertCircle,
  Loader2,
  X,
  ArrowRight,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';

interface DomainSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDomainAdded: (domain: DomainItem) => void;
}

// Strictly the required discrete tiers per user specification
const EMPLOYEE_TIERS = [
  { value: 1, label: '1 Employee', desc: 'Starter / Solo', badge: 'Solo' },
  { value: 10, label: '10 Employees', desc: 'Standard team tier', badge: 'Standard', isDefault: true },
  { value: 25, label: '25 Employees', desc: 'Growing businesses', badge: 'Growth' },
  { value: 50, label: '50 Employees', desc: 'Mid-size organizations', badge: 'Team' },
  { value: 75, label: '75 Employees', desc: 'Large departments', badge: 'Business' },
  { value: 100, label: '100 Employees', desc: 'Full-scale enterprise', badge: 'Enterprise' },
] as const;

export const DomainSetupModal: React.FC<DomainSetupModalProps> = ({
  isOpen,
  onClose,
  onDomainAdded,
}) => {
  const [step, setStep] = useState<'form' | 'godaddy'>('form');
  const [domainName, setDomainName] = useState('');
  const [selectedTier, setSelectedTier] = useState<number>(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Success state after domain creation (unprovisioned) + GoDaddy connect step
  const [createdDomain, setCreatedDomain] = useState<DomainItem | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connected, setConnected] = useState(false);

  if (!isOpen) return null;

  const handleCreateDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDomain = domainName.trim().toLowerCase();

    // Domain validation regex
    const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
    if (!cleanDomain || !domainRegex.test(cleanDomain)) {
      setError('Please enter a valid domain name (e.g. acme.com or mail.acme.com).');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Creates the domain record only — Stalwart/DNS provisioning happens
      // later when a Super Admin clicks "Activate Domain".
      const res = await api.createTenantDomain({
        domainName: cleanDomain,
        employeeTier: selectedTier,
      });

      setCreatedDomain(res.domain);
      setStep('godaddy');
    } catch (err: any) {
      setError(err.message || 'Failed to create domain. Please check if it already exists.');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectGoDaddy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createdDomain) return;
    setConnecting(true);
    setError(null);
    try {
      await api.connectGoDaddyCredential(createdDomain.id, apiKey.trim(), apiSecret.trim());
      setConnected(true);
    } catch (err: any) {
      setError(err.message || 'Could not verify this GoDaddy credential against the domain.');
    } finally {
      setConnecting(false);
    }
  };

  const handleFinish = () => {
    if (createdDomain) {
      onDomainAdded(createdDomain);
    }
    // Reset state and close
    setStep('form');
    setDomainName('');
    setSelectedTier(10);
    setError(null);
    setCreatedDomain(null);
    setApiKey('');
    setApiSecret('');
    setConnected(false);
    onClose();
  };

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
        {/* Modal Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100/80 flex items-center justify-center text-indigo-600 shadow-xs shrink-0">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-slate-900">
                  {step === 'form' ? 'Add New Domain' : 'Connect GoDaddy'}
                </h3>
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200/60">
                  {step === 'form' ? 'Step 1 of 2' : 'Step 2 of 2'}
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {step === 'form'
                  ? 'Connect an authoritative domain and allocate employee mailbox seats.'
                  : `Connect GoDaddy for ${createdDomain?.domainName} so a Super Admin can activate mail service.`}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={step === 'godaddy' ? handleFinish : onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: FORM */}
        {step === 'form' && (
          <form onSubmit={handleCreateDomain} className="flex flex-col gap-5">
            {/* Domain Name Input */}
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

            {/* Employee Tier Selection (1, 10, 25, 50, 75, 100) */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-800">
                  Employee Tier & Mailbox Quota <span className="text-rose-500">*</span>
                </label>
                <span className="text-[11px] font-medium text-slate-400">
                  Select employee capacity
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {EMPLOYEE_TIERS.map((tier) => {
                  const isSelected = selectedTier === tier.value;
                  return (
                    <button
                      key={tier.value}
                      type="button"
                      onClick={() => setSelectedTier(tier.value)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[78px] ${
                        isSelected
                          ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20 shadow-xs'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-sm font-bold ${
                            isSelected ? 'text-indigo-700' : 'text-slate-800'
                          }`}
                        >
                          {tier.value} {tier.value === 1 ? 'Seat' : 'Seats'}
                        </span>
                        <span
                          className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${
                            isSelected
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {tier.badge}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 font-normal mt-1 truncate">
                        {tier.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] text-slate-400">
                This sets the domain limit to create up to{' '}
                <strong className="text-slate-700 font-semibold">{selectedTier} mailboxes</strong>.
              </span>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !domainName.trim()}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                id="btn-submit-domain-wizard"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Provisioning Domain...</span>
                  </>
                ) : (
                  <>
                    <span>Create Domain</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* STEP 2: CONNECT GODADDY */}
        {step === 'godaddy' && (
          <div className="flex flex-col gap-4 animate-in fade-in">
            {/* Banner */}
            <div className="p-3.5 bg-indigo-50 border border-indigo-200/80 rounded-xl flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0">
                <Check className="w-4 h-4" />
              </div>
              <div>
                <span className="text-xs font-semibold text-indigo-950 block">
                  Domain &quot;{createdDomain?.domainName}&quot; added — not yet activated.
                </span>
                <span className="text-[11px] text-indigo-700">
                  Allocated capacity: {createdDomain?.mailboxLimit} mailboxes. A Super Admin still needs to click
                  "Activate Domain" once GoDaddy is connected below.
                </span>
              </div>
            </div>

            {connected ? (
              <div className="p-3.5 bg-emerald-50 border border-emerald-200/80 rounded-xl flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
                <span className="text-xs font-medium text-emerald-800">
                  GoDaddy connected and verified for this domain. A Super Admin can now activate it.
                </span>
              </div>
            ) : (
              <form onSubmit={handleConnectGoDaddy} className="flex flex-col gap-3.5">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Generate a Personal Access Token / API key+secret for this domain at{' '}
                  <span className="font-mono">developer.godaddy.com</span>, scoped to DNS management only. Toowix
                  verifies it manages this domain, then discards it once activation succeeds.
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
                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={connecting || !apiKey.trim() || !apiSecret.trim()}
                    className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {connecting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <>
                        <span>Verify & Connect</span>
                        <ShieldCheck className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* Step 2 Finish Button */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
              <button
                type="button"
                onClick={handleFinish}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-2 cursor-pointer"
                id="btn-complete-domain-setup"
              >
                <span>{connected ? 'Done' : 'Connect Later & Switch to Domain'}</span>
                <Check className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
