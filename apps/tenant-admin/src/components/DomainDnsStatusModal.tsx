import React, { useEffect, useState } from 'react';
import { DomainItem, DomainDnsStatus } from '../types';
import { api } from '../api';
import { X } from 'lucide-react';
import { DnsStatusPanel } from './DnsStatusPanel';

interface DomainDnsStatusModalProps {
  domain: DomainItem | null;
  isOpen: boolean;
  onClose: () => void;
}

export const DomainDnsStatusModal: React.FC<DomainDnsStatusModalProps> = ({ domain, isOpen, onClose }) => {
  const [status, setStatus] = useState<DomainDnsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    if (!domain) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDomainDnsStatus(domain.id);
      setStatus(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load DNS status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && domain) {
      setStatus(null);
      setError(null);
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
              View required records and manually configure DNS with any provider.
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

        <DnsStatusPanel domainName={domain.domainName} status={status} loading={loading} error={error} onRefresh={refresh} />

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
