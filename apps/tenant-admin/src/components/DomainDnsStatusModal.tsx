import React, { useEffect, useState } from 'react';
import { DomainItem, DomainDnsStatus } from '../types';
import { api } from '../api';
import { X, RefreshCw, AlertTriangle, CheckCircle2, Copy, Check, FileText, Download } from 'lucide-react';

interface DomainDnsStatusModalProps {
  domain: DomainItem | null;
  isOpen: boolean;
  onClose: () => void;
}

function statusCopy(dnsStatus?: string): { label: string; className: string } {
  switch (dnsStatus) {
    case 'active':
      return { label: 'Active', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'activating':
      return { label: 'Activating', className: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'conflict':
      return { label: 'Conflict', className: 'bg-rose-50 text-rose-700 border-rose-200' };
    case 'activation_failed':
      return { label: 'Activation Failed', className: 'bg-rose-50 text-rose-700 border-rose-200' };
    default:
      return { label: 'Not Started', className: 'bg-slate-100 text-slate-500 border-slate-200' };
  }
}

export const DomainDnsStatusModal: React.FC<DomainDnsStatusModalProps> = ({ domain, isOpen, onClose }) => {
  const [status, setStatus] = useState<DomainDnsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [zoneFileCopied, setZoneFileCopied] = useState(false);

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

  const handleCopy = (value: string, idx: number) => {
    navigator.clipboard.writeText(value);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleCopyZoneFile = () => {
    if (!status?.dnsZoneFile) return;
    navigator.clipboard.writeText(status.dnsZoneFile);
    setZoneFileCopied(true);
    setTimeout(() => setZoneFileCopied(false), 2000);
  };

  const handleExportZoneFile = () => {
    if (!status?.dnsZoneFile) return;
    const blob = new Blob([status.dnsZoneFile], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${domain.domainName}-zone.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const dnsStatus = status?.dnsStatus || domain.dnsStatus || 'not_started';
  const badge = statusCopy(dnsStatus);

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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
              aria-label="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
          <span className="text-xs text-slate-500">DNS Activation Status</span>
          <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border ${badge.className}`}>
            {badge.label}
          </span>
        </div>

        {loading && !status && <p className="text-xs text-slate-500">Loading current status…</p>}

        {dnsStatus === 'not_started' && !loading && (
          <p className="text-xs text-slate-600 leading-relaxed">
            This domain hasn't been activated yet — a Super Admin needs to click Activate Domain first. Once
            activated, the required DNS records and a full zone file will appear here, whether or not you've
            connected a DNS provider.
          </p>
        )}

        {dnsStatus === 'conflict' && status?.dnsConflicts && status.dnsConflicts.length > 0 && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg space-y-2">
            <div className="flex items-center gap-1.5 text-rose-700 text-xs font-semibold">
              <AlertTriangle size={13} />
              <span>Existing conflicting DNS records found — nothing was overwritten</span>
            </div>
            <div className="space-y-1">
              {status.dnsConflicts.map((c, i) => (
                <div key={i} className="font-mono text-[11px] text-rose-800 bg-white border border-rose-200 rounded px-2 py-1">
                  {c.type} {c.name}: {c.foundValue}
                </div>
              ))}
            </div>
            <p className="text-[11px] text-rose-700">
              Resolve the conflict with your DNS provider, then ask a Super Admin to click Retry / Verify.
            </p>
          </div>
        )}

        {dnsStatus === 'activating' && (
          <p className="text-xs text-slate-600">
            DNS records are ready. Waiting for public propagation — this can take a few minutes up to ~48 hours.
          </p>
        )}

        {dnsStatus === 'activation_failed' && (
          <p className="text-xs text-rose-700">
            DNS propagation did not complete within the allowed window. Double-check the records below are
            published at your DNS provider, then ask a Super Admin to Retry / Verify.
          </p>
        )}

        {dnsStatus === 'active' && (
          <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-xs font-medium">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>Domain is fully active. Mail service is live.</span>
          </div>
        )}

        {status && status.dnsRecords.length > 0 && (
          <div>
            <label className="text-xs font-semibold text-slate-800 mb-1.5 block">Required DNS Records</label>
            <div className="space-y-1.5">
              {status.dnsRecords.map((r, i) => (
                <div key={i} className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-slate-500">
                      {r.type} · {r.name}
                      {r.priority != null ? ` · priority ${r.priority}` : ''}
                    </span>
                    <button
                      onClick={() => handleCopy(r.value, i)}
                      className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                    >
                      {copiedIndex === i ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                      {copiedIndex === i ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="font-mono text-[11px] text-slate-700 mt-1 break-all">{r.value}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{r.purpose}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {status?.dnsZoneFile && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                <FileText size={12} />
                Manual Setup — Raw DNS Zone File
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleCopyZoneFile}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                >
                  {zoneFileCopied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                  {zoneFileCopied ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handleExportZoneFile}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                >
                  <Download size={11} />
                  Export .txt
                </button>
              </div>
            </div>
            <pre className="p-3 bg-slate-900 text-slate-100 rounded-lg text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-56 overflow-y-auto">
              {status.dnsZoneFile}
            </pre>
            <p className="text-[10px] text-slate-400 mt-1">
              Paste this directly into your DNS provider's zone import feature, if it supports one — an
              alternative to configuring the individual records above by hand.
            </p>
          </div>
        )}

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
