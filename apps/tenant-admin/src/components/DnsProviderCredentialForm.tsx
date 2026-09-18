import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { TenantDnsCredentialSummary } from '../types';
import { CheckCircle2, AlertTriangle, AlertCircle, Loader2, Key, ShieldCheck } from 'lucide-react';

export type DnsProvider = 'godaddy' | 'hostinger' | 'cloudflare';

const PROVIDER_LABELS: Record<DnsProvider, string> = {
  godaddy: 'GoDaddy',
  hostinger: 'Hostinger',
  cloudflare: 'Cloudflare',
};

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
  /** Forces a single provider and hides the 3-way picker — used when embedded in a wizard step already scoped to one provider. */
  provider?: DnsProvider;
  onSuccess: (info: SuccessInfo) => void;
  onCancel?: () => void;
  compact?: boolean;
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
  provider: forcedProvider,
  onSuccess,
  onCancel,
}) => {
  const [provider, setProvider] = useState<DnsProvider>(forcedProvider || 'godaddy');
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

  const savedForProvider = savedCredentials.find((c) => c.provider === provider) || null;

  useEffect(() => {
    // Only domain-connect mode offers "use saved key" — vault-only saves are
    // always a fresh manual entry (that IS the save).
    if (domainId && savedForProvider) {
      setEntryChoice('pending');
    } else {
      setEntryChoice('manual');
    }
  }, [provider, domainId, savedForProvider]);

  const cleanToken = token.trim().replace(/^Bearer\s+/i, '').replace(/^['"]|['"]$/g, '');
  const looksLikeCloudflareGlobalKey = provider === 'cloudflare' && cleanToken.length === 37 && /^[0-9a-fA-F]{37}$/.test(cleanToken);

  const canSubmit =
    connectingStage === null &&
    (provider === 'godaddy'
      ? apiKey.trim().length > 0 && apiSecret.trim().length > 0
      : token.trim().length > 0);

  const handleUseSaved = async () => {
    if (!domainId) return;
    setError(null);
    setConnectingStage('verifying_cred');
    try {
      const res = await api.useSavedDnsProviderCredential(domainId, provider);
      const info: SuccessInfo = {
        verifiedProviderDomain: res.verifiedProviderDomain,
        recordsSynced: res.recordsSynced,
        syncPending: res.syncPending,
      };
      setSuccessInfo(info);
      onSuccess(info);
    } catch (err: any) {
      setError(err.message || `Could not use the saved ${PROVIDER_LABELS[provider]} key. It may have been revoked — try entering it again.`);
      setEntryChoice('manual');
    } finally {
      setConnectingStage(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

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

  if (successInfo) {
    return (
      <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 flex flex-col gap-2">
        <div className="flex items-center gap-2 text-emerald-800 font-semibold text-xs">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{PROVIDER_LABELS[provider]} {successInfo.savedToVault ? 'Key Saved' : 'Connected'}</span>
        </div>
        <p className="text-xs text-emerald-700">
          {successInfo.savedToVault ? (
            successInfo.verifiedProviderDomain ? (
              <>Saved — we verified it against <strong>{successInfo.verifiedProviderDomain}</strong>. It'll be offered automatically next time you set up a domain with {PROVIDER_LABELS[provider]}.</>
            ) : (
              <>Saved for next time. Since you don't have a domain yet, we'll verify it the first time you actually use it.</>
            )
          ) : successInfo.syncPending ? (
            <>Publishing your DNS records to <strong>{successInfo.verifiedProviderDomain}</strong> now — this runs in the background and usually takes a minute or two. Check DNS Setup status to confirm once it's done.</>
          ) : (
            <>Connected to <strong>{successInfo.verifiedProviderDomain}</strong> in your <strong>{PROVIDER_LABELS[provider]}</strong> account.</>
          )}
        </p>
      </div>
    );
  }

  if (domainId && entryChoice === 'pending' && savedForProvider) {
    return (
      <div className="flex flex-col gap-3">
        <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/60 flex flex-col gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-900">
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
            <span>You have a saved {PROVIDER_LABELS[provider]} key</span>
          </div>
          {savedForProvider.connectedAt && (
            <p className="text-[11px] text-indigo-700">Connected {formatDate(savedForProvider.connectedAt)}.</p>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2 text-xs text-rose-700">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setEntryChoice('manual')}
            disabled={connectingStage !== null}
            className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Enter different credentials
          </button>
          <button
            type="button"
            onClick={handleUseSaved}
            disabled={connectingStage !== null}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition-colors flex items-center gap-2 cursor-pointer shadow-xs"
          >
            {connectingStage !== null ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Verifying...</span>
              </>
            ) : (
              <>
                <Key className="w-3.5 h-3.5" />
                <span>Use Saved {PROVIDER_LABELS[provider]} Key</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Provider Selector */}
      {!forcedProvider && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-slate-700">DNS Provider</label>
          <div className="grid grid-cols-3 gap-2">
            {(['godaddy', 'hostinger', 'cloudflare'] as const).map((p) => {
              const isSelected = provider === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setProvider(p);
                    setError(null);
                  }}
                  className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all text-center cursor-pointer ${
                    isSelected
                      ? 'border-indigo-600 bg-indigo-50/70 text-indigo-700 shadow-2xs font-semibold'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {PROVIDER_LABELS[p]}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {domainId && savedForProvider && (
        <p className="text-[11px] text-slate-500 -mt-2">
          This replaces your saved {PROVIDER_LABELS[provider]} key.{' '}
          <button type="button" onClick={() => setEntryChoice('pending')} className="text-indigo-600 hover:underline cursor-pointer">
            Use the saved one instead
          </button>
        </p>
      )}
      {!domainId && savedForProvider && (
        <p className="text-[11px] text-slate-500 -mt-2">You already have a saved {PROVIDER_LABELS[provider]} key — saving will replace it.</p>
      )}

      {/* Credential Inputs */}
      {provider === 'godaddy' ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="dns-cred-godaddy-key" className="text-xs font-medium text-slate-700">GoDaddy API Key</label>
            <input
              id="dns-cred-godaddy-key"
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="e.g. dL8Q... (Production Key)"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="dns-cred-godaddy-secret" className="text-xs font-medium text-slate-700">GoDaddy API Secret</label>
            <input
              id="dns-cred-godaddy-secret"
              type="password"
              value={apiSecret}
              onChange={(e) => setApiSecret(e.target.value)}
              placeholder="API Secret"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Generate in GoDaddy Developer Portal under <strong>API Keys (Production)</strong>
            {domainName ? <> with access to domain <strong>{domainName}</strong></> : null}.
          </p>
        </div>
      ) : provider === 'hostinger' ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="dns-cred-hostinger-token" className="text-xs font-medium text-slate-700">Hostinger API Token</label>
            <input
              id="dns-cred-hostinger-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Hostinger API Token"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
            />
          </div>
          <p className="text-[11px] text-slate-500">
            Generate in Hostinger Profile → API Tokens with DNS Edit permissions.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <label htmlFor="dns-cred-cloudflare-token" className="text-xs font-medium text-slate-700">Cloudflare API Token</label>
            <input
              id="dns-cred-cloudflare-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="e.g. 40-character API Token"
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 font-mono"
            />
          </div>

          {looksLikeCloudflareGlobalKey && (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-[11px] text-amber-800">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <strong>Global API Key detected:</strong> Cloudflare Global API Keys cannot be used as Bearer tokens. Please generate a scoped <strong>API Token</strong> using the <em>Edit zone DNS</em> template.
              </div>
            </div>
          )}

          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/70 text-[11px] text-slate-600 space-y-1.5">
            <div className="font-semibold text-slate-800">Creating your Cloudflare API Token:</div>
            <ol className="list-decimal pl-4 space-y-0.5 text-slate-500">
              <li>Open Cloudflare Dashboard → <strong>My Profile</strong> → <strong>API Tokens</strong></li>
              <li>Click <strong>Create Token</strong> and choose the <strong>Edit zone DNS</strong> template</li>
              <li>Ensure permissions include <strong>Zone: DNS: Edit</strong> and <strong>Zone: Zone: Read</strong></li>
              {domainName ? <li>Set Zone Resources to <strong>Specific zone → {domainName}</strong></li> : null}
            </ol>
          </div>
        </div>
      )}

      {domainId && (
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
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={connectingStage !== null}
            className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 cursor-pointer shadow-xs"
        >
          {connectingStage !== null ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Verifying credential...</span>
            </>
          ) : (
            <>
              <Key className="w-3.5 h-3.5" />
              <span>{domainId ? 'Connect DNS Provider' : 'Save API Key'}</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
};
