import React, { useEffect, useState } from 'react';
import { TenantSummary, TenantDomainSummary, DomainDnsStatus, DnsLiveCheckResult } from '../../types';
import { api } from '../../api';
import { X, PlayCircle, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Copy, Check, FileText, Download, Search } from 'lucide-react';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { StatusBadge } from '../ui/StatusBadge';
import { dnsStatusBadgeProps as badgeProps } from '../../utils/dnsStatus';

interface DomainActivationModalProps {
  tenant: TenantSummary | null;
  domain: TenantDomainSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

export const DomainActivationModal: React.FC<DomainActivationModalProps> = ({
  tenant,
  domain,
  isOpen,
  onClose,
  onChanged,
}) => {
  const [status, setStatus] = useState<DomainDnsStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'activate' | 'retry' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoneFileCopied, setZoneFileCopied] = useState(false);
  const [liveCheck, setLiveCheck] = useState<DnsLiveCheckResult | null>(null);
  const [checking, setChecking] = useState(false);

  const refresh = async () => {
    if (!tenant || !domain) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.getDomainDnsStatus(tenant.id, domain.id);
      setStatus(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load domain activation status.');
    } finally {
      setLoading(false);
    }
  };

  const checkRecords = async () => {
    if (!tenant || !domain) return;
    setChecking(true);
    try {
      const res = await api.checkDomainDnsLive(tenant.id, domain.id);
      setLiveCheck(res);
    } catch (err: any) {
      setError(err.message || 'Failed to check DNS records.');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (isOpen && tenant && domain) {
      setStatus(null);
      setError(null);
      setLiveCheck(null);
      refresh();
      checkRecords();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, tenant?.id, domain?.id]);

  if (!isOpen || !tenant || !domain) return null;

  const handleActivate = async () => {
    setActionLoading('activate');
    setError(null);
    try {
      const res = await api.activateDomainDns(tenant.id, domain.id);
      setStatus(res);
      if (onChanged) onChanged();
    } catch (err: any) {
      setError(err.message || 'Domain activation failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetry = async () => {
    setActionLoading('retry');
    setError(null);
    try {
      const res = await api.retryVerifyDomainDns(tenant.id, domain.id);
      setStatus(res);
      if (onChanged) onChanged();
    } catch (err: any) {
      setError(err.message || 'Retry / verify failed.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCopyZoneFile = () => {
    if (!status?.dnsZoneFile) return;
    navigator.clipboard.writeText(status.dnsZoneFile);
    setZoneFileCopied(true);
    setTimeout(() => setZoneFileCopied(false), 2000);
  };

  const handleExportZoneFile = () => {
    if (!status?.dnsZoneFile || !domain) return;
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
  const badge = badgeProps(dnsStatus);
  const recordsReady = liveCheck?.allFound === true;
  const showActivateButton = dnsStatus === 'not_started';
  const canRetry = dnsStatus === 'activating' || dnsStatus === 'conflict' || dnsStatus === 'activation_failed';

  return (
    <div className="modal-backdrop-mock">
      <div className="modal-card max-w-2xl">
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Domain Activation</h3>
            <p className="text-xs text-slate-500 mt-0.5">{tenant.name} · {domain.domainName}</p>
          </div>
          <button onClick={onClose} className="modal-close-btn">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body space-y-4">
          {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

          <div className="flex items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <span className="text-xs text-slate-500">DNS Activation Status</span>
            <StatusBadge status={badge.status} label={badge.label} />
          </div>

          {loading && <p className="text-xs text-slate-500">Loading current status…</p>}

          {dnsStatus === 'not_started' && !loading && (
            <p className="text-xs text-slate-600 leading-relaxed">
              This domain has not been activated yet. Clicking <strong>Activate Domain</strong> creates it in
              Stalwart, fetches its real DKIM keys, and builds the required MX/SPF/DKIM/DMARC records. If the
              Tenant Admin has connected a DNS provider (GoDaddy, Hostinger, or Cloudflare), those records are
              published automatically. If not, Toowix generates a full DNS zone file below that can be configured
              manually with any DNS provider — no credential connection required.
            </p>
          )}

          {dnsStatus === 'not_started' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                  <Search size={13} className="text-slate-500" />
                  Tenant DNS Readiness
                </span>
                <button
                  type="button"
                  onClick={checkRecords}
                  disabled={checking}
                  className="btn-secondary btn-sm text-[11px] inline-flex items-center gap-1 disabled:opacity-50"
                >
                  <RefreshCw size={11} className={checking ? 'animate-spin' : ''} />
                  {checking ? 'Checking…' : 'Re-check'}
                </button>
              </div>

              {liveCheck && (
                <div className={`p-3 rounded-lg border space-y-2 ${liveCheck.allFound ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
                  <div className={`flex items-center gap-1.5 text-xs font-semibold ${liveCheck.allFound ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {liveCheck.allFound ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
                    <span>
                      {liveCheck.allFound
                        ? 'All required DNS records are live publicly — ready to activate.'
                        : `${liveCheck.results.filter((r) => !r.found).length} of ${liveCheck.results.length} required records not detected yet. The tenant has not finished DNS setup — Activate is disabled until they do.`}
                    </span>
                  </div>
                  {!liveCheck.allFound && (
                    <div className="space-y-1">
                      {liveCheck.results.filter((r) => !r.found).map((r, i) => (
                        <div key={i} className="flex items-center gap-2 font-mono text-[11px] px-2 py-1 rounded bg-white/70 text-amber-900">
                          <XCircle size={11} className="text-amber-600 shrink-0" />
                          <span className="font-semibold">{r.type}</span>
                          <span className="text-slate-500 truncate">{r.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
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
                Ask the customer to resolve the conflict in their DNS provider, then click Retry / Verify.
              </p>
            </div>
          )}

          {dnsStatus === 'activating' && (
            <p className="text-xs text-slate-600">
              DNS records were published. Waiting for public propagation — this can take a few minutes up to ~48
              hours. Click Retry / Verify to check again now, or wait for the automatic background check.
            </p>
          )}

          {dnsStatus === 'activation_failed' && (
            <p className="text-xs text-rose-700">
              DNS propagation did not complete within the allowed window. Verify the records below are published at
              the customer's DNS provider, then click Retry / Verify.
            </p>
          )}

          {dnsStatus === 'active' && (
            <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-xs font-medium">
              <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
              <span>Domain is fully active. Mail service is live and the tenant's trial has started.</span>
            </div>
          )}
          {status?.dnsZoneFile && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="field-label flex items-center gap-1.5">
                  <FileText size={12} />
                  Manual Setup — Raw DNS Zone File
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleCopyZoneFile}
                    className="btn-secondary btn-sm text-[11px] inline-flex items-center gap-1"
                  >
                    {zoneFileCopied ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                    {zoneFileCopied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    onClick={handleExportZoneFile}
                    className="btn-secondary btn-sm text-[11px] inline-flex items-center gap-1"
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
                Paste this directly into your DNS provider's zone file or import feature — or add the records into your DNS provider.
              </p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <Button size="md" variant="secondary" onClick={onClose}>
            Close
          </Button>
          {canRetry && (
            <Button size="md" variant="secondary" onClick={handleRetry} loading={actionLoading === 'retry'}>
              <RefreshCw size={15} className={actionLoading === 'retry' ? 'animate-spin' : ''} />
              <span>Retry / Verify</span>
            </Button>
          )}
          {showActivateButton && (
            <Button
              size="md"
              variant="primary"
              onClick={handleActivate}
              loading={actionLoading === 'activate'}
              disabled={!recordsReady}
              title={recordsReady ? undefined : 'Waiting for the tenant to finish DNS setup — records not yet detected publicly'}
            >
              <PlayCircle size={15} />
              <span>Activate Domain</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
