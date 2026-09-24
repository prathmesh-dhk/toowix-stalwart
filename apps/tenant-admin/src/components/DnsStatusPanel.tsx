import React, { useState } from 'react';
import { DomainDnsStatus, DnsLiveCheckResult } from '../types';
import { AlertTriangle, CheckCircle2, Copy, Check, FileText, Download, RefreshCw, Search } from 'lucide-react';

interface DnsStatusPanelProps {
  domainName: string;
  status: DomainDnsStatus | null;
  loading: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRefresh: () => void;
  /** Label of a connected DNS provider (e.g. "GoDaddy"), if any, for copy on the activating banner. */
  connectedProviderLabel?: string | null;
  /** On-demand live public-DNS check ("Check My Records") — separate from onRefresh, which only re-reads the last stored/background status. */
  onCheckRecords?: () => void;
  checking?: boolean;
  liveCheck?: DnsLiveCheckResult | null;
  onRetryVerification?: () => void;
  retrying?: boolean;
  theme?: 'light' | 'dark';
  /** If true, this panel is in manual DNS setup mode where we prioritize showing missing records and DNS instructions */
  isManualSetup?: boolean;
}

export const DnsStatusPanel: React.FC<DnsStatusPanelProps> = ({
  domainName,
  status,
  loading,
  refreshing: _refreshing,
  error,
  onRefresh: _onRefresh,
  connectedProviderLabel,
  onCheckRecords,
  checking,
  liveCheck,
  onRetryVerification,
  retrying,
  theme = 'light',
  isManualSetup = false,
}) => {
  const isDark = theme === 'dark';
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const dnsStatus = status?.dnsStatus || 'not_started';
  const missingCount = (liveCheck?.results || []).filter((r) => !r.found).length;

  const copy = (key: string, value: string) => {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1600);
  };

  const handleExportZoneFile = () => {
    if (!status?.dnsZoneFile) return;
    const blob = new Blob([status.dnsZoneFile], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${domainName}-zone.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setCopiedKey('zoneexport');
    setTimeout(() => setCopiedKey((k) => (k === 'zoneexport' ? null : k)), 1600);
  };

  return (
    <div className="flex flex-col gap-3.5">
      {error && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading && !status && <p className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Loading current status…</p>}

      {!isManualSetup && dnsStatus === 'not_started' && !loading && (
        <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          {connectedProviderLabel
            ? `Once activated, your connected ${connectedProviderLabel} account publishes these records automatically.`
            : 'Copy the DNS zone file below and add the records to your DNS provider. Mailbox creation unlocks when DNS activation completes.'}
        </p>
      )}

      {dnsStatus === 'conflict' && Array.isArray(status?.dnsConflicts) && status.dnsConflicts.length > 0 && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
          <div className="flex items-center gap-1.5 text-rose-700 text-xs font-semibold">
            <AlertTriangle size={13} />
            <span>Existing conflicting DNS records found — nothing was overwritten</span>
          </div>
          <div className="space-y-1">
            {status.dnsConflicts.map((c, i) => (
              <div key={i} className="font-mono text-[11px] text-rose-800 bg-white border border-rose-200 rounded px-2 py-1">
                {c?.type || 'RECORD'} {c?.name || ''}: {c?.foundValue || ''}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-rose-700">
            Resolve the conflict with your DNS provider, then retry verification.
          </p>
        </div>
      )}

      {!isManualSetup && dnsStatus === 'activating' && (
        <p className={`text-xs leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          {connectedProviderLabel
            ? `Published automatically via ${connectedProviderLabel}. Waiting for public DNS propagation — usually minutes, up to 48 hours.`
            : 'DNS zone file is ready below. Add the records to your DNS provider, then propagation is checked automatically — usually minutes, up to 48 hours.'}
        </p>
      )}

      {dnsStatus === 'activation_failed' && (
        <p className="text-xs text-rose-700 leading-relaxed">
          DNS propagation did not complete within the allowed window. Double-check the records in the zone file below are published
          at your DNS provider, then retry verification.
        </p>
      )}

      {/* Domain Active Message: hidden in manual setup mode where user wants to inspect missing records */}
      {!isManualSetup && dnsStatus === 'active' && (
        <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-xs font-medium">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          <span>Domain is fully active. Mail service is live.</span>
        </div>
      )}

      {(dnsStatus === 'conflict' || dnsStatus === 'activation_failed') && onRetryVerification && (
        <button
          type="button"
          onClick={onRetryVerification}
          disabled={retrying}
          className="self-start px-3.5 py-1.5 rounded-full text-xs font-semibold border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          <RefreshCw size={13} className={retrying ? 'animate-spin' : ''} />
          {retrying ? 'Retrying…' : 'Retry / Verify'}
        </button>
      )}

      {/* Raw DNS Zone File */}
      {status?.dnsZoneFile && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-2">
            <span className={`text-xs font-semibold flex items-center gap-1.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
              <FileText size={13} className={isDark ? 'text-slate-400' : 'text-slate-500'} />
              DNS Zone File
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => copy('zone', status.dnsZoneFile as string)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  isDark ? 'border border-slate-700 text-slate-300 hover:bg-slate-800' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {copiedKey === 'zone' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                {copiedKey === 'zone' ? 'Copied' : 'Copy Zone File'}
              </button>
              <button
                type="button"
                onClick={handleExportZoneFile}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium inline-flex items-center gap-1.5 cursor-pointer transition-colors ${
                  isDark ? 'border border-slate-700 text-slate-300 hover:bg-slate-800' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {copiedKey === 'zoneexport' ? (
                  <Check size={12} className="text-emerald-400" />
                ) : (
                  <Download size={12} />
                )}
                {copiedKey === 'zoneexport' ? 'Exported' : 'Export .txt'}
              </button>
            </div>
          </div>
          <pre className={`p-3.5 rounded-xl text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-60 overflow-y-auto border ${
            isDark ? 'bg-slate-950 text-indigo-200 border-slate-800' : 'bg-slate-900 text-slate-100 border-slate-800'
          }`}>
            {status.dnsZoneFile}
          </pre>
          <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1.5">
            <FileText size={11} className="shrink-0 text-slate-400" />
            Paste this directly into your DNS provider's zone file import or configure each record in your DNS manager.
          </p>
        </div>
      )}

      {/* Live DNS record check summary */}
      {onCheckRecords && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between gap-3 ${
            liveCheck
              ? liveCheck.allFound
                ? 'bg-emerald-50/80 border-emerald-200'
                : 'bg-amber-50/80 border-amber-200'
              : isDark
                ? 'bg-slate-900 border-slate-800'
                : 'bg-slate-50 border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 text-xs">
            {liveCheck ? (
              liveCheck.allFound ? (
                <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle size={15} className="text-amber-600 shrink-0" />
              )
            ) : (
              <Search size={15} className={isDark ? 'text-slate-400 shrink-0' : 'text-slate-500 shrink-0'} />
            )}
            <span className={`font-medium truncate ${liveCheck ? (liveCheck.allFound ? 'text-emerald-800' : 'text-amber-900') : isDark ? 'text-slate-300' : 'text-slate-600'}`}>
              {liveCheck
                ? liveCheck.allFound
                  ? 'All DNS records detected live'
                  : `${missingCount} missing DNS record${missingCount === 1 ? '' : 's'} detected`
                : 'Check DNS records live'}
            </span>
          </div>

          <button
            type="button"
            onClick={onCheckRecords}
            disabled={checking}
            className="shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-all inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw size={12} className={checking ? 'animate-spin' : ''} />
            <span>{checking ? 'Checking…' : liveCheck ? 'Re-scan' : 'Check Records'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
