import React, { useState, useMemo } from 'react';
import { DomainDnsStatus, DnsActivationStatus, DnsLiveCheckResult, DnsRecordCheckResult } from '../types';
import { AlertTriangle, CheckCircle2, XCircle, Copy, Check, FileText, Download, RefreshCw, Search } from 'lucide-react';

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

function statusBadge(dnsStatus?: DnsActivationStatus) {
  switch (dnsStatus) {
    case 'active':
      return { label: 'Active', bg: '#ecfdf5', color: '#047857', border: '#a7f3d0' };
    case 'activating':
      return { label: 'Activating', bg: '#fffbeb', color: '#b45309', border: '#fde68a' };
    case 'conflict':
      return { label: 'Conflict', bg: '#fff1f2', color: '#be123c', border: '#fecdd3' };
    case 'activation_failed':
      return { label: 'Activation Failed', bg: '#fff1f2', color: '#be123c', border: '#fecdd3' };
    default:
      return { label: 'Not Started', bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0' };
  }
}

export const DnsStatusPanel: React.FC<DnsStatusPanelProps> = ({
  domainName,
  status,
  loading,
  refreshing,
  error,
  onRefresh,
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
  const [filterMissingOnly, setFilterMissingOnly] = useState(false);

  const dnsStatus = status?.dnsStatus || 'not_started';
  const badge = statusBadge(dnsStatus);

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

  // Merge declared records with live check results to show missing/detected state
  const recordsToDisplay = useMemo(() => {
    const rawRecords = status?.dnsRecords || [];
    const checkMap = new Map<string, DnsRecordCheckResult>();
    if (liveCheck?.results) {
      for (const r of liveCheck.results) {
        checkMap.set(`${r.type}:${r.name.toLowerCase()}`, r);
      }
    }

    if (rawRecords.length > 0) {
      return rawRecords.map((rec) => {
        const live = checkMap.get(`${rec.type}:${rec.name.toLowerCase()}`);
        return {
          type: rec.type,
          name: rec.name,
          value: rec.value,
          priority: rec.priority,
          purpose: rec.purpose || live?.purpose || '',
          found: live ? live.found : undefined,
        };
      });
    }

    if (liveCheck?.results && liveCheck.results.length > 0) {
      return liveCheck.results.map((r) => ({
        type: r.type,
        name: r.name,
        value: r.expectedValue,
        priority: r.type === 'MX' ? 10 : undefined,
        purpose: r.purpose,
        found: r.found,
      }));
    }

    return [];
  }, [status?.dnsRecords, liveCheck?.results]);

  const missingCount = recordsToDisplay.filter((r) => r.found === false).length;
  const detectedCount = recordsToDisplay.filter((r) => r.found === true).length;
  const totalCount = recordsToDisplay.length;

  const visibleRecords = useMemo(() => {
    if (filterMissingOnly && missingCount > 0) {
      return recordsToDisplay.filter((r) => r.found === false);
    }
    return recordsToDisplay;
  }, [recordsToDisplay, filterMissingOnly, missingCount]);

  return (
    <div className="flex flex-col gap-3.5">
      {/* Global Status Bar */}
      <div className={`flex items-center justify-between p-3 rounded-xl border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
        <span className={`text-[11px] font-semibold ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>DNS Activation Status</span>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full border"
            style={{
              background: isDark && dnsStatus === 'not_started' ? '#1e293b' : badge.bg,
              color: isDark && dnsStatus === 'not_started' ? '#94a3b8' : badge.color,
              borderColor: isDark && dnsStatus === 'not_started' ? '#334155' : badge.border,
            }}
          >
            {badge.label}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || refreshing}
            className={`p-1 rounded-lg transition-colors cursor-pointer disabled:opacity-50 ${isDark ? 'text-slate-400 hover:text-white hover:bg-slate-800' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'}`}
            aria-label="Refresh status"
          >
            <RefreshCw size={13} className={loading || refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

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

      {/* MISSING & LIVE DNS RECORDS SECTION */}
      <div className="flex flex-col gap-3">
        {/* Verification Status Header Card */}
        <div
          className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
            liveCheck
              ? liveCheck.allFound
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                : 'bg-amber-50/80 border-amber-200 text-amber-950'
              : isDark
                ? 'bg-slate-900 border-slate-800 text-slate-200'
                : 'bg-slate-50 border-slate-200 text-slate-800'
          }`}
        >
          <div className="flex items-start gap-3 min-w-0">
            {liveCheck ? (
              liveCheck.allFound ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              )
            ) : (
              <Search className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
            )}
            <div className="flex flex-col gap-0.5 text-xs">
              <span className="font-semibold text-sm">
                {liveCheck
                  ? liveCheck.allFound
                    ? 'All DNS Records Detected & Verified Live'
                    : `${missingCount} Missing DNS Record${missingCount === 1 ? '' : 's'} Detected`
                  : 'Live DNS Records & Missing Record Check'}
              </span>
              <span className={liveCheck ? (liveCheck.allFound ? 'text-emerald-700' : 'text-amber-800') : 'text-slate-500'}>
                {liveCheck
                  ? liveCheck.allFound
                    ? 'All required MX, SPF, DKIM, and DMARC records are correctly published and responding in public DNS.'
                    : `Records marked as Missing below were not detected yet. Add them to your DNS provider to complete setup.`
                  : 'Query authoritative DNS resolvers (8.8.8.8, 1.1.1.1) to verify published records and spot missing ones.'}
              </span>
            </div>
          </div>

          {onCheckRecords && (
            <button
              type="button"
              onClick={onCheckRecords}
              disabled={checking}
              className="shrink-0 px-3.5 py-2 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition-all inline-flex items-center gap-2 cursor-pointer shadow-xs disabled:opacity-50"
            >
              <RefreshCw size={13} className={checking ? 'animate-spin' : ''} />
              <span>{checking ? 'Checking Records…' : liveCheck ? 'Re-scan DNS' : 'Check Missing Records'}</span>
            </button>
          )}
        </div>

        {/* Filter bar when records exist */}
        {recordsToDisplay.length > 0 && (
          <div className="flex items-center justify-between gap-2 pt-1">
            <span className="text-xs font-semibold text-slate-700">
              Required DNS Records ({recordsToDisplay.length})
            </span>
            {missingCount > 0 && (
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  type="button"
                  onClick={() => setFilterMissingOnly(false)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                    !filterMissingOnly
                      ? 'bg-slate-200 text-slate-900 font-semibold'
                      : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  All ({recordsToDisplay.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMissingOnly(true)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer ${
                    filterMissingOnly
                      ? 'bg-rose-100 text-rose-800 font-semibold border border-rose-200'
                      : 'text-rose-600 hover:text-rose-800'
                  }`}
                >
                  Missing ({missingCount})
                </button>
              </div>
            )}
          </div>
        )}

        {/* Detailed Records List */}
        {visibleRecords.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {visibleRecords.map((rec, i) => (
              <div
                key={i}
                className={`p-3.5 rounded-xl border transition-all ${
                  rec.found === false
                    ? isDark
                      ? 'bg-rose-950/20 border-rose-900/60'
                      : 'bg-rose-50/60 border-rose-200 shadow-xs'
                    : rec.found === true
                      ? isDark
                        ? 'bg-emerald-950/20 border-emerald-900/50'
                        : 'bg-emerald-50/30 border-emerald-200'
                      : isDark
                        ? 'bg-slate-900 border-slate-800'
                        : 'bg-white border-slate-200 shadow-xs'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                      {rec.type}
                    </span>
                    {rec.found === false && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md border border-rose-200">
                        <XCircle size={12} className="text-rose-600" />
                        Missing
                      </span>
                    )}
                    {rec.found === true && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-md border border-emerald-200">
                        <CheckCircle2 size={12} className="text-emerald-600" />
                        Detected
                      </span>
                    )}
                    {rec.found === undefined && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                        Required
                      </span>
                    )}
                    {rec.purpose && (
                      <span className="text-[11px] text-slate-500 font-medium">
                        {rec.purpose}
                      </span>
                    )}
                  </div>
                  {rec.priority !== undefined && rec.priority !== null && (
                    <span className="text-[11px] text-slate-500 font-mono">
                      Priority: <strong className="text-slate-800">{rec.priority}</strong>
                    </span>
                  )}
                </div>

                <div className="mt-2.5 grid grid-cols-1 md:grid-cols-12 gap-2 text-xs">
                  {/* Host / Name */}
                  <div className="md:col-span-4 flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-50/80 border border-slate-200/80">
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] uppercase font-semibold text-slate-400 block tracking-wider">Host / Name</span>
                      <code className="font-mono text-xs text-indigo-700 font-semibold truncate block select-all mt-0.5">
                        {rec.name}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => copy(`name-${i}`, rec.name)}
                      className="p-1.5 rounded-md hover:bg-white text-slate-400 hover:text-slate-700 transition-colors shrink-0 cursor-pointer border border-transparent hover:border-slate-200"
                      title="Copy Host"
                    >
                      {copiedKey === `name-${i}` ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                    </button>
                  </div>

                  {/* Value / Target */}
                  <div className="md:col-span-8 flex items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-50/80 border border-slate-200/80">
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] uppercase font-semibold text-slate-400 block tracking-wider">Value / Target</span>
                      <code className="font-mono text-xs text-slate-800 break-all block select-all mt-0.5 font-normal">
                        {rec.value}
                      </code>
                    </div>
                    <button
                      type="button"
                      onClick={() => copy(`val-${i}`, rec.value)}
                      className="p-1.5 rounded-md hover:bg-white text-slate-400 hover:text-slate-700 transition-colors shrink-0 cursor-pointer border border-transparent hover:border-slate-200"
                      title="Copy Value"
                    >
                      {copiedKey === `val-${i}` ? <Check size={13} className="text-emerald-500" /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          !loading && <p className="text-xs text-slate-400 italic">No specific records loaded yet. See Zone File below.</p>
        )}
      </div>

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
    </div>
  );
};
