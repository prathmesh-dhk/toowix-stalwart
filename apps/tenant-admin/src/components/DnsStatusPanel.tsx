import React, { useState } from 'react';
import { DomainDnsStatus, DnsActivationStatus } from '../types';
import { AlertTriangle, CheckCircle2, Copy, Check, FileText, Download, RefreshCw } from 'lucide-react';

interface DnsStatusPanelProps {
  domainName: string;
  status: DomainDnsStatus | null;
  loading: boolean;
  refreshing?: boolean;
  error?: string | null;
  onRefresh: () => void;
  /** Label of a connected DNS provider (e.g. "GoDaddy"), if any, for copy on the activating banner. */
  connectedProviderLabel?: string | null;
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
}) => {
  const [activeTab, setActiveTab] = useState<'records' | 'zonefile'>('records');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const dnsStatus = status?.dnsStatus || 'not_started';
  const badge = statusBadge(dnsStatus);
  const hasRecordsOrZone = !!status && (status.dnsRecords.length > 0 || !!status.dnsZoneFile);

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
      <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-xl">
        <span className="text-[11px] font-semibold text-slate-500">DNS Activation Status</span>
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full border"
            style={{ background: badge.bg, color: badge.color, borderColor: badge.border }}
          >
            {badge.label}
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading || refreshing}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
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

      {loading && !status && <p className="text-xs text-slate-500">Loading current status…</p>}

      {dnsStatus === 'not_started' && !loading && (
        <p className="text-xs text-slate-600 leading-relaxed">
          This domain hasn't been activated yet — a Super Admin needs to click Activate Domain.{' '}
          {connectedProviderLabel
            ? `Once activated, your connected ${connectedProviderLabel} account publishes these records automatically.`
            : 'Once activated, the required records and a full zone file will appear here — no credential required.'}
        </p>
      )}

      {dnsStatus === 'conflict' && status?.dnsConflicts && status.dnsConflicts.length > 0 && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl space-y-2">
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
            Resolve the conflict with your DNS provider, then ask a Super Admin to Retry / Verify.
          </p>
        </div>
      )}

      {dnsStatus === 'activating' && (
        <p className="text-xs text-slate-600 leading-relaxed">
          {connectedProviderLabel
            ? `Published automatically via ${connectedProviderLabel}. Waiting for public DNS propagation — usually minutes, up to 48 hours.`
            : 'Records are ready below. Add them to your DNS provider, then propagation is checked automatically — usually minutes, up to 48 hours.'}
        </p>
      )}

      {dnsStatus === 'activation_failed' && (
        <p className="text-xs text-rose-700 leading-relaxed">
          DNS propagation did not complete within the allowed window. Double-check the records below are published
          at your DNS provider, then ask a Super Admin to Retry / Verify.
        </p>
      )}

      {dnsStatus === 'active' && (
        <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-xl text-xs font-medium">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          <span>Domain is fully active. Mail service is live.</span>
        </div>
      )}

      {hasRecordsOrZone && (
        <div>
          <div className="flex items-center gap-4 border-b border-slate-200 mb-3">
            <button
              type="button"
              onClick={() => setActiveTab('records')}
              className="pb-2 text-xs font-bold cursor-pointer"
              style={{
                color: activeTab === 'records' ? '#4338ca' : '#94a3b8',
                borderBottom: `2px solid ${activeTab === 'records' ? '#4f46e5' : 'transparent'}`,
              }}
            >
              Required Records
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('zonefile')}
              className="pb-2 text-xs font-bold cursor-pointer"
              style={{
                color: activeTab === 'zonefile' ? '#4338ca' : '#94a3b8',
                borderBottom: `2px solid ${activeTab === 'zonefile' ? '#4f46e5' : 'transparent'}`,
              }}
            >
              Zone File
            </button>
          </div>

          {activeTab === 'records' && status && status.dnsRecords.length > 0 && (
            <div className="space-y-1.5">
              {status.dnsRecords.map((r, i) => {
                const key = `rec${i}`;
                const isMx = r.type === 'MX';
                return (
                  <div key={i} className="p-2.5 bg-white border border-slate-200 rounded-xl text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className="text-[9px] font-extrabold px-1.5 py-0.5 rounded shrink-0"
                          style={{ background: isMx ? '#eef2ff' : '#f1f5f9', color: isMx ? '#4338ca' : '#475569' }}
                        >
                          {r.type}
                        </span>
                        <span className="text-slate-500 truncate">
                          {r.name}
                          {r.priority != null ? ` · priority ${r.priority}` : ''}
                        </span>
                      </div>
                      <button
                        onClick={() => copy(key, r.value)}
                        className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        {copiedKey === key ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                        {copiedKey === key ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="font-mono text-[11px] text-slate-700 mt-1 break-all">{r.value}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{r.purpose}</div>
                  </div>
                );
              })}
            </div>
          )}

          {activeTab === 'zonefile' && status?.dnsZoneFile && (
            <div>
              <div className="flex items-center justify-end gap-1.5 mb-2">
                <button
                  onClick={() => copy('zone', status.dnsZoneFile as string)}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'zone' ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                  {copiedKey === 'zone' ? 'Copied' : 'Copy'}
                </button>
                <button
                  onClick={handleExportZoneFile}
                  className="px-2 py-1 rounded-lg border border-slate-200 text-[11px] hover:bg-slate-50 inline-flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'zoneexport' ? (
                    <Check size={11} className="text-emerald-600" />
                  ) : (
                    <Download size={11} />
                  )}
                  {copiedKey === 'zoneexport' ? 'Exported' : 'Export .txt'}
                </button>
              </div>
              <pre className="p-3 bg-slate-900 text-slate-100 rounded-xl text-[11px] font-mono overflow-x-auto whitespace-pre-wrap break-all max-h-56 overflow-y-auto">
                {status.dnsZoneFile}
              </pre>
              <p className="text-[10px] text-slate-400 mt-1.5 flex items-center gap-1">
                <FileText size={10} className="shrink-0" />
                Paste this directly into your DNS provider's zone import feature, if it supports one.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
