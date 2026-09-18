import React, { useEffect, useState } from 'react';
import { DomainItem, DomainDnsStatus, DnsLiveCheckResult } from '../types';
import { api } from '../api';
import { X, Key, ChevronDown, ChevronUp } from 'lucide-react';
import { DnsStatusPanel } from './DnsStatusPanel';
import { DnsProviderCredentialForm } from './DnsProviderCredentialForm';

interface DomainDnsStatusModalProps {
  domain: DomainItem | null;
  isOpen: boolean;
  onClose: () => void;
  onDomainUpdated?: () => void;
}

export const DomainDnsStatusModal: React.FC<DomainDnsStatusModalProps> = ({
  domain,
  isOpen,
  onClose,
  onDomainUpdated,
}) => {
  const [status, setStatus] = useState<DomainDnsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProviderForm, setShowProviderForm] = useState(false);
  const [liveCheck, setLiveCheck] = useState<DnsLiveCheckResult | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = async () => {
    if (!domain) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDomainDnsStatus(domain.id);
      setStatus(res);
      onDomainUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to load DNS status.');
    } finally {
      setLoading(false);
    }
  };

  const checkRecords = async () => {
    if (!domain) return;
    setChecking(true);
    setError(null);
    try {
      const res = await api.checkDnsRecordsLive(domain.id);
      setLiveCheck(res);
    } catch (err: any) {
      setError(err.message || 'Failed to check DNS records.');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen && domain) {
      setStatus(null);
      setError(null);
      setShowProviderForm(false);
      setLiveCheck(null);
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, domain?.id]);

  if (!isOpen || !domain) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[2px] p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 md:p-7 flex flex-col gap-4 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between pb-4 border-b border-slate-100">
          <div>
            <h3 className="text-base font-semibold text-slate-900">DNS Setup — {domain.domainName}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              View DNS zone records or connect your DNS provider to configure records automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <DnsStatusPanel
          domainName={domain.domainName}
          status={status}
          loading={loading}
          error={error}
          onRefresh={refresh}
          onCheckRecords={checkRecords}
          checking={checking}
          liveCheck={liveCheck}
        />

        {/* Connect DNS Provider Section */}
        <div className="border border-indigo-100 rounded-xl overflow-hidden bg-indigo-50/30">
          <button
            type="button"
            onClick={() => setShowProviderForm((prev) => !prev)}
            className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-indigo-50/60 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                <Key className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="text-xs font-semibold text-slate-900 block">
                  Connect DNS Provider
                </span>
                <span className="text-[11px] text-slate-500 block">
                  Auto-publish and verify records on GoDaddy, Hostinger, or Cloudflare
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-600">
              <span>{showProviderForm ? 'Hide' : 'Configure'}</span>
              {showProviderForm ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </div>
          </button>

          {showProviderForm && (
            <div className="p-4 bg-white border-t border-indigo-100 animate-in fade-in duration-150">
              <DnsProviderCredentialForm
                domainId={domain.id}
                domainName={domain.domainName}
                onSuccess={() => {
                  refresh();
                }}
              />
            </div>
          )}
        </div>

        <div className="pt-3 border-t border-slate-100 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
