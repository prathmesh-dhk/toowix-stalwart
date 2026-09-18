import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { TenantDnsCredentialSummary, DomainItem } from '../types';
import { GoDaddyIcon, HostingerIcon, CloudflareIcon } from './ProviderIcons';
import { AlertTriangle, AlertCircle, Loader2, Key, ShieldCheck, ArrowRight, ExternalLink } from 'lucide-react';

export type DnsProvider = 'godaddy' | 'hostinger' | 'cloudflare';

const PROVIDER_LABELS: Record<DnsProvider, string> = {
  godaddy: 'GoDaddy',
  hostinger: 'Hostinger',
  cloudflare: 'Cloudflare',
};

const PROVIDER_ICONS: Record<DnsProvider, React.FC<{ className?: string }>> = {
  godaddy: GoDaddyIcon,
  hostinger: HostingerIcon,
  cloudflare: CloudflareIcon,
};

const inputClass =
  'w-full px-4 py-3 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600/15 focus:border-indigo-600 transition-all placeholder:text-slate-400 bg-white text-slate-900 font-mono';

interface SuccessInfo {
  verifiedProviderDomain?: string | null;
  recordsSynced?: number;
  syncPending?: boolean;
  savedToVault?: boolean;
}

interface DnsProviderCredentialFormProps {
  /** Omit to save straight into the tenant's credential vault (API Keys tab) instead of connecting a domain. */
  domainId?: string;
  domainName?: string;
  planId?: string;
  /** Forces a single provider and hides the picker — used when embedded in a wizard step already scoped to one provider. */
  provider?: DnsProvider;
  onSuccess: (info: SuccessInfo, createdDomain?: DomainItem) => void;
  onCancel?: () => void;
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

export const DnsProviderCredentialForm: React.FC<DnsProviderCredentialFormProps> = ({
  domainId,
  domainName,
  planId,
  provider: forcedProvider,
  onSuccess,
  onCancel,
}) => {
  const [provider, setProvider] = useState<DnsProvider | null>(forcedProvider || null);
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [token, setToken] = useState('');
  const [saveForFuture, setSaveForFuture] = useState(true);
  const [connectingStage, setConnectingStage] = useState<null | 'verifying_cred'>(null);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<SuccessInfo | null>(null);

  const [savedCredentials, setSavedCredentials] = useState<TenantDnsCredentialSummary[]>([]);
  // 'pending' shows the "use saved key?" choice; resolved automatically to
  // 'manual' the moment there's nothing saved for the current provider.
  const [entryChoice, setEntryChoice] = useState<'pending' | 'saved' | 'manual'>('pending');

  useEffect(() => {
    let cancelled = false;
    api
      .listTenantDnsCredentials()
      .then((res) => {
        if (!cancelled) setSavedCredentials(res.credentials);
      })
      .catch(() => {
        // Best-effort — if this fails, the form just behaves as if nothing is saved.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const savedForProvider = provider ? savedCredentials.find((c) => c.provider === provider) || null : null;

  useEffect(() => {
    // Only domain-connect mode offers "use saved key" — vault-only saves are
    // always a fresh manual entry (that IS the save).
    if ((domainId || domainName) && savedForProvider) {
      setEntryChoice('pending');
    } else {
      setEntryChoice('manual');
    }
  }, [provider, domainId, domainName, savedForProvider]);

  const cleanToken = token.trim().replace(/^Bearer\s+/i, '').replace(/^['"]|['"]$/g, '');
  const looksLikeCloudflareGlobalKey = provider === 'cloudflare' && cleanToken.length === 37 && /^[0-9a-fA-F]{37}$/.test(cleanToken);

  const canSubmit =
    connectingStage === null &&
    provider !== null &&
    (provider === 'godaddy'
      ? apiKey.trim().length > 0 && apiSecret.trim().length > 0
      : token.trim().length > 0);

  const handleUseSaved = async () => {
    if (!provider) return;
    setError(null);
    setConnectingStage('verifying_cred');

    let createdDomainItem: DomainItem | undefined;
    try {
      let targetDomainId = domainId;
      if (!targetDomainId && domainName && planId) {
        const createRes = await api.createTenantDomain({ domainName, planId });
        targetDomainId = createRes.domain.id;
        createdDomainItem = createRes.domain;
      }
      if (!targetDomainId) return;

      try {
        const res = await api.useSavedDnsProviderCredential(targetDomainId, provider);
        const info: SuccessInfo = {
          verifiedProviderDomain: res.verifiedProviderDomain,
          recordsSynced: res.recordsSynced,
          syncPending: res.syncPending,
        };
        setSuccessInfo(info);
        if (createdDomainItem) {
          onSuccess(info, createdDomainItem);
        } else {
          onSuccess(info);
        }
      } catch (useErr: any) {
        if (createdDomainItem) {
          try {
            await api.deleteDomain(createdDomainItem.id);
          } catch (delErr) {
            console.warn('[DomainSetup] Rollback failed after saved key error:', delErr);
          }
        }
        throw useErr;
      }
    } catch (err: any) {
      setError(err.message || `Could not use the saved ${PROVIDER_LABELS[provider]} key. It may have been revoked — try entering it again.`);
      setEntryChoice('manual');
    } finally {
      setConnectingStage(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !provider) return;

    setError(null);
    setConnectingStage('verifying_cred');

    try {
      const credential =
        provider === 'godaddy'
          ? { provider: 'godaddy' as const, apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }
          : { provider, token: cleanToken };

      if (domainId) {
        // Credential verification is the only thing this request waits on —
        // publishing/verifying the actual DNS records happens in the
        // background afterward (see domain-activation.service.ts), so this
        // resolves quickly regardless of how many records this domain needs.
        const res = await api.connectDnsProviderCredential(domainId, credential, saveForFuture);
        const info: SuccessInfo = {
          verifiedProviderDomain: res.verifiedProviderDomain,
          recordsSynced: res.recordsSynced,
          syncPending: res.syncPending,
        };
        setSuccessInfo(info);
        onSuccess(info);
      } else if (domainName && planId) {
        // Create the domain first
        const createRes = await api.createTenantDomain({ domainName, planId });
        const newDomain = createRes.domain;

        try {
          // Connect provider credentials and sync records
          const res = await api.connectDnsProviderCredential(newDomain.id, credential, saveForFuture);
          const info: SuccessInfo = {
            verifiedProviderDomain: res.verifiedProviderDomain,
            recordsSynced: res.recordsSynced,
            syncPending: res.syncPending,
          };
          setSuccessInfo(info);
          onSuccess(info, newDomain);
        } catch (connectErr: any) {
          // If verification or connection fails: immediately rollback so no dead domain remains!
          try {
            await api.deleteDomain(newDomain.id);
          } catch (delErr) {
            console.warn('[DomainSetup] Rollback failed after provider connect failure:', delErr);
          }
          throw connectErr;
        }
      } else {
        const res = await api.saveTenantDnsCredential(credential);
        const info: SuccessInfo = {
          verifiedProviderDomain: res.credential.verifiedProviderDomain,
          savedToVault: true,
        };
        setSuccessInfo(info);
        onSuccess(info);
      }
    } catch (err: any) {
      setError(err.message || `Could not verify credentials with ${PROVIDER_LABELS[provider]}.`);
    } finally {
      setConnectingStage(null);
    }
  };

  if (successInfo && provider) {
    return (
      <div className="p-4 bg-emerald-50 border border-emerald-200/80 rounded-xl flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-emerald-900">
            {PROVIDER_LABELS[provider]} {successInfo.savedToVault ? 'Key Saved' : 'Connected'}
          </span>
          <p className="text-xs text-emerald-700 leading-relaxed">
            {successInfo.savedToVault ? (
              successInfo.verifiedProviderDomain ? (
                <>We verified it against <strong>{successInfo.verifiedProviderDomain}</strong>. It'll be offered automatically next time you set up a domain with {PROVIDER_LABELS[provider]}.</>
              ) : (
                <>Since you don't have a domain yet, we'll verify it the first time you actually use it.</>
              )
            ) : successInfo.syncPending ? (
              <>Publishing your DNS records to <strong>{successInfo.verifiedProviderDomain}</strong> now — this runs in the background and usually takes a minute or two.</>
            ) : (
              <>Connected to <strong>{successInfo.verifiedProviderDomain}</strong> in your {PROVIDER_LABELS[provider]} account.</>
            )}
          </p>
        </div>
      </div>
    );
  }

  // Provider not chosen yet (only reachable when not forced to one) — SSO-style icon rows, matching the wizard's method-picker step.
  if (!forcedProvider && !provider) {
    return (
      <div className="flex flex-col gap-3">
        {(['godaddy', 'hostinger', 'cloudflare'] as const).map((p) => {
          const Icon = PROVIDER_ICONS[p];
          return (
            <button
              key={p}
              type="button"
              aria-label={PROVIDER_LABELS[p]}
              onClick={() => {
                setProvider(p);
                setError(null);
              }}
              className="w-full group px-5 py-4 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50/80 transition-all cursor-pointer flex items-center justify-between shadow-xs hover:shadow-sm bg-white"
            >
              <div className="flex items-center gap-3.5">
                <Icon className="w-7 h-7 shrink-0" />
                <span className="text-sm font-semibold text-slate-900">{PROVIDER_LABELS[p]}</span>
              </div>
              <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-600 group-hover:translate-x-0.5 transition-all" />
            </button>
          );
        })}
      </div>
    );
  }

  if (!provider) return null;

  if ((domainId || domainName) && entryChoice === 'pending' && savedForProvider) {
    return (
      <div className="flex flex-col gap-5">
        <div className="p-4 bg-indigo-50/60 border border-indigo-200/80 rounded-xl flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-indigo-900">You have a saved {PROVIDER_LABELS[provider]} key</span>
            {savedForProvider.connectedAt && (
              <p className="text-xs text-indigo-700">Connected {formatDate(savedForProvider.connectedAt)}.</p>
            )}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setEntryChoice('manual')}
            disabled={connectingStage !== null}
            className="text-xs font-medium text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
          >
            Enter different credentials
          </button>
          <button
            type="button"
            onClick={handleUseSaved}
            disabled={connectingStage !== null}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-semibold shadow-xs hover:shadow transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {connectingStage !== null ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Verifying...</span>
              </>
            ) : (
              <>
                <span>Use Saved Key</span>
                <ShieldCheck className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      {/* When embedded in a wizard step already scoped to one provider, that
          step renders its own icon+label header — showing another one here
          would duplicate it, so this only appears in freeform (picker) mode. */}
      {!forcedProvider && (
        <div className="flex items-center gap-2">
          {React.createElement(PROVIDER_ICONS[provider], { className: 'w-5 h-5 shrink-0' })}
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            {PROVIDER_LABELS[provider]} DNS Management
          </span>
          <button
            type="button"
            onClick={() => {
              setProvider(null);
              setError(null);
            }}
            className="ml-auto text-xs font-medium text-indigo-600 hover:underline cursor-pointer"
          >
            Switch provider
          </button>
        </div>
      )}

      {(domainId || domainName) && savedForProvider && (
        <p className="text-xs text-slate-500 -mt-3">
          This replaces your saved {PROVIDER_LABELS[provider]} key.{' '}
          <button type="button" onClick={() => setEntryChoice('pending')} className="text-indigo-600 hover:underline cursor-pointer">
            Use the saved one instead
          </button>
        </p>
      )}
      {!domainId && !domainName && savedForProvider && (
        <p className="text-xs text-slate-500 -mt-3">You already have a saved {PROVIDER_LABELS[provider]} key — saving will replace it.</p>
      )}

      {/* Credential Inputs */}
      {provider === 'godaddy' ? (
        <div className="flex flex-col gap-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col gap-1 text-xs text-slate-600 leading-relaxed">
            <span className="font-semibold text-slate-800">GoDaddy API Key Setup:</span>
            <p className="text-[11px] text-slate-600">
              Create a <strong>Production</strong> API Key &amp; Secret at{' '}
              <a
                href="https://classic-developer.godaddy.com/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:text-indigo-800 font-medium underline inline-flex items-center gap-1"
              >
                <span>classic-developer.godaddy.com/keys</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dns-cred-godaddy-key" className="text-xs font-semibold text-slate-700">GoDaddy API Key</label>
            <input
              id="dns-cred-godaddy-key"
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="e.g. dL8Q... (Production Key)"
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dns-cred-godaddy-secret" className="text-xs font-semibold text-slate-700">GoDaddy API Secret</label>
            <input
              id="dns-cred-godaddy-secret"
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="API Secret"
              className={inputClass}
            />
          </div>
          {domainName && (
            <p className="text-[11px] text-slate-500">
              Needs access to domain <strong>{domainName}</strong>.
            </p>
          )}
        </div>
      ) : provider === 'hostinger' ? (
        <div className="flex flex-col gap-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-col gap-1 text-xs text-slate-600 leading-relaxed">
            <span className="font-semibold text-slate-800">Hostinger API Token Setup:</span>
            <p className="text-[11px] text-slate-600">
              Generate an API token in hPanel at{' '}
              <a
                href="https://hpanel.hostinger.com/api"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-600 hover:text-indigo-800 font-medium underline inline-flex items-center gap-1"
              >
                <span>hpanel.hostinger.com/api</span>
                <ExternalLink className="w-3 h-3 shrink-0" />
              </a>{' '}
              (or Account &rarr; API).
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dns-cred-hostinger-token" className="text-xs font-semibold text-slate-700">Hostinger API Token</label>
            <input
              id="dns-cred-hostinger-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Hostinger API Token"
              className={inputClass}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-1.5 text-xs text-slate-600 leading-relaxed">
            <span className="font-semibold text-slate-800">Creating your Cloudflare API Token:</span>
            <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-600">
              <li>
                Go to{' '}
                <a
                  href="https://dash.cloudflare.com/profile/api-tokens"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-800 font-medium underline inline-flex items-center gap-1"
                >
                  <span>dash.cloudflare.com/profile/api-tokens</span>
                  <ExternalLink className="w-3 h-3 shrink-0" />
                </a>{' '}
                (or My Profile &rarr; API Tokens)
              </li>
              <li>
                Click <strong>Create Token</strong> &rarr; use the <strong>Edit zone DNS</strong> template
              </li>
              {domainName && (
                <li>
                  Zone Resources: <strong>Include &rarr; Specific zone &rarr; {domainName}</strong>
                </li>
              )}
              <li>
                Confirm permissions: <strong>Zone: DNS: Edit</strong> and <strong>Zone: Zone: Read</strong>
              </li>
              <li>Copy the 40-character token below (not the Global API Key)</li>
            </ol>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="dns-cred-cloudflare-token" className="text-xs font-semibold text-slate-700">Cloudflare API Token</label>
            <input
              id="dns-cred-cloudflare-token"
              type="password"
              placeholder="Paste 40-character API Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className={inputClass}
            />
            {looksLikeCloudflareGlobalKey && (
              <p className="text-[11px] text-amber-600 font-medium flex items-start gap-1.5 mt-1">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  That looks like a Global API Key (37 hex chars). Cloudflare needs an <strong>API Token</strong>{' '}
                  instead — visit{' '}
                  <a
                    href="https://dash.cloudflare.com/profile/api-tokens"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-semibold"
                  >
                    API Tokens
                  </a>{' '}
                  &rarr; Create Token &rarr; "Edit zone DNS".
                </span>
              </p>
            )}
          </div>
        </div>
      )}

      {(domainId || domainName) && (
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={saveForFuture}
            onChange={(e) => setSaveForFuture(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30 cursor-pointer"
          />
          Save these credentials for future domains
        </label>
      )}

      {/* Error Message */}
      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-700">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center justify-end gap-3">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={connectingStage !== null}
            className="px-4 py-2.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-sm font-semibold shadow-xs hover:shadow transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {connectingStage !== null ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Verifying...</span>
            </>
          ) : (
            <>
              <span>{(domainId || domainName) ? 'Verify & Connect' : 'Save API Key'}</span>
              {(domainId || domainName) ? <ShieldCheck className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
            </>
          )}
        </button>
      </div>
    </form>
  );
};
