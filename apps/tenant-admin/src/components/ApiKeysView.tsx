import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { TenantDnsCredentialSummary, DnsProviderName } from '../types';
import { DnsProviderCredentialForm } from './DnsProviderCredentialForm';
import { Key, Plus, Trash2, ShieldCheck, AlertTriangle, X } from 'lucide-react';

const PROVIDER_LABELS: Record<DnsProviderName, string> = {
  godaddy: 'GoDaddy',
  hostinger: 'Hostinger',
  cloudflare: 'Cloudflare',
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

/**
 * Tenant-wide vault of saved DNS provider credentials (GoDaddy/Hostinger/
 * Cloudflare) — save one key per provider once, and it's offered
 * automatically every time a domain is set up afterward instead of being
 * re-entered. Separate from any single domain's live connection
 * (DomainDnsCredential); deleting a saved key here never disconnects a
 * domain already using it.
 */
export const ApiKeysView: React.FC = () => {
  const [credentials, setCredentials] = useState<TenantDnsCredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deletingProvider, setDeletingProvider] = useState<DnsProviderName | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listTenantDnsCredentials();
      setCredentials(res.credentials);
    } catch (err: any) {
      setError(err.message || 'Failed to load saved API keys.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (provider: DnsProviderName) => {
    setDeletingProvider(provider);
    setError(null);
    try {
      await api.deleteTenantDnsCredential(provider);
      await load();
    } catch (err: any) {
      setError(err.message || 'Failed to remove the saved key.');
    } finally {
      setDeletingProvider(null);
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-slate-900">API Keys</h1>
          <p className="text-xs text-slate-500">
            Saved DNS provider credentials — connect once, and it's offered automatically every time you set up a new domain.
          </p>
        </div>
        {!showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="min-h-[44px] px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center justify-center gap-2 cursor-pointer self-stretch sm:self-auto"
            id="btn-add-api-key"
          >
            <Plus className="w-4 h-4" />
            <span>Add API Key</span>
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {showAddForm && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold text-slate-900">Add a DNS Provider API Key</span>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <DnsProviderCredentialForm
            onSuccess={() => {
              setShowAddForm(false);
              load();
            }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {loading ? (
        <p className="text-xs text-slate-500">Loading saved keys...</p>
      ) : credentials.length === 0 && !showAddForm ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 flex flex-col items-center gap-2 text-center">
          <Key className="w-7 h-7 text-slate-300" />
          <p className="text-xs text-slate-500 max-w-sm">
            No saved API keys yet. Save a GoDaddy, Hostinger, or Cloudflare key once and it'll be offered automatically next time you set up a domain.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {credentials.map((cred) => (
            <div key={cred.provider} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">{PROVIDER_LABELS[cred.provider]}</span>
                {cred.verified ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                    <ShieldCheck className="w-3 h-3" />
                    Verified
                  </span>
                ) : (
                  <span className="text-[11px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                    Not yet verified
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-500">
                {cred.connectedAt ? <>Saved {formatDate(cred.connectedAt)}</> : 'Not yet connected'}
                {cred.verifiedProviderDomain ? <> · verified against {cred.verifiedProviderDomain}</> : null}
              </div>
              <button
                type="button"
                onClick={() => handleDelete(cred.provider)}
                disabled={deletingProvider === cred.provider}
                className="self-start mt-1 min-h-[44px] px-3.5 py-2 inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg disabled:opacity-50 cursor-pointer transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{deletingProvider === cred.provider ? 'Removing...' : 'Remove'}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
