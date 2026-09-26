import React, { useCallback, useEffect, useState } from 'react';
import {
  Archive,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Globe,
  KeyRound,
  Laptop,
  Lock,
  Mail,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
  XCircle,
} from 'lucide-react';
import { api } from '../../api';
import { DeletedOrganisationRecord, DeletionActorSnapshot, DeletionNetworkSnapshot, DeletionTimelineEntry } from '../../types';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { StatusBadge } from '../ui/StatusBadge';

type ListMode = 'completed' | 'active';

const formatDateTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const STAGE_LABEL: Record<string, string> = {
  requested: 'Deletion requested',
  name_confirmed: 'Organisation name confirmed',
  otp_initiated: 'OTP process initiated',
  otp_generation: 'Final OTP generated',
  otp_verified: 'Final OTP verified',
  final_confirmation: 'Final confirmation / permanent delete',
  cancelled: 'Deletion cancelled',
  expired: 'OTP window lapsed',
  completed: 'Deletion completed',
  final_otp_sent: 'Final OTP sent',
};

const actorLine = (a: DeletionActorSnapshot | null) =>
  a ? `${a.name || a.email} · ${a.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Tenant Admin'}` : 'System';

const deviceLine = (n: DeletionNetworkSnapshot | null) =>
  n ? `${n.deviceType} · ${n.os} · ${n.browser}${n.browserVersion ? ` ${n.browserVersion}` : ''}` : '—';

/**
 * "Deleted Organisations": the permanent record of every organisation deletion. Survives the
 * organisation itself — answers who deleted it, in what role, when, from which IP / location /
 * device, and which security steps they completed.
 */
export const DeletedOrganisationsView: React.FC = () => {
  const [mode, setMode] = useState<ListMode>('completed');
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<DeletedOrganisationRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<DeletedOrganisationRecord | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listDeletedOrganisations({ stage: mode, search: search.trim() || undefined, limit: 50 });
      setItems(res.items);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message || 'Could not load deleted organisations.');
    } finally {
      setLoading(false);
    }
  }, [mode, search]);

  useEffect(() => {
    const id = setTimeout(load, search ? 250 : 0);
    return () => clearTimeout(id);
  }, [load, search]);

  const openDetail = async (row: DeletedOrganisationRecord) => {
    setSelected(row);
    setDetailLoading(true);
    try {
      const { record } = await api.getDeletedOrganisation(row.id);
      setSelected(record);
    } catch (err: any) {
      setError(err.message || 'Could not load the full record.');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <Archive className="w-5 h-5 text-rose-600" />
            <h2 className="text-lg font-semibold text-slate-900">Deleted Organisations</h2>
          </div>
          <p className="text-xs text-slate-500">
            Permanent audit record of every organisation deletion: who, in what role, when, from where, and which security steps they passed.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={load} disabled={loading} className="flex items-center gap-1.5 self-start sm:self-auto">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs w-full sm:w-auto justify-between sm:justify-start">
          {(['completed', 'active'] as ListMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-md font-medium cursor-pointer transition-all min-h-[38px] sm:min-h-0 flex items-center justify-center ${
                mode === m ? 'bg-white text-indigo-600 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {m === 'completed' ? 'Deleted' : 'In progress'}
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or domain"
            aria-label="Search deleted organisations"
            className="form-input h-10 sm:h-8 text-base sm:text-xs pl-8 w-full"
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
          {error}
        </div>
      )}

      {!loading && items.length === 0 ? (
        <p className="text-xs text-slate-500 py-8 text-center">
          {mode === 'completed' ? 'No organisation has been deleted yet.' : 'No deletions are currently in progress.'}
        </p>
      ) : (
        <>
          {/* Desktop Table View */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-4 font-semibold">Organisation</th>
                  <th className="py-2 pr-4 font-semibold">Registered email</th>
                  <th className="py-2 pr-4 font-semibold">Initiated</th>
                  <th className="py-2 pr-4 font-semibold">{mode === 'completed' ? 'Completed' : 'Stage'}</th>
                  <th className="py-2 pr-4 font-semibold">Completed by</th>
                  <th className="py-2 pr-4 font-semibold">IP · Location</th>
                  <th className="py-2 pr-4 font-semibold">Device</th>
                  <th className="py-2 pr-4 font-semibold">OTP</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const by = row.completedBy ?? row.initiatedBy;
                  const net = row.completedNetwork ?? row.initiatedNetwork;
                  return (
                    <tr
                      key={row.id}
                      onClick={() => openDetail(row)}
                      className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer align-top transition-colors"
                    >
                      <td className="py-3 pr-4">
                        <div className="font-semibold text-slate-900">{row.organisationName}</div>
                        <div className="text-[11px] text-slate-500 font-mono">{row.organisationId}</div>
                        {row.path === 'forced' && <span className="text-[10px] font-semibold text-amber-700">Forced delete</span>}
                      </td>
                      <td className="py-3 pr-4 text-slate-700">{row.registrationEmail ?? '—'}</td>
                      <td className="py-3 pr-4 text-slate-700">{formatDateTime(row.initiatedAt)}</td>
                      <td className="py-3 pr-4 text-slate-700">
                        {mode === 'completed' ? formatDateTime(row.completedAt) : <StatusBadge status={row.stage} />}
                      </td>
                      <td className="py-3 pr-4 text-slate-700">{actorLine(by)}</td>
                      <td className="py-3 pr-4 text-slate-700">
                        <div className="font-mono">{net.ip}</div>
                        <div className="text-slate-500">{net.location}</div>
                      </td>
                      <td className="py-3 pr-4 text-slate-700">{deviceLine(net)}</td>
                      <td className="py-3 pr-4 text-slate-700 capitalize">{row.otpVerification.replace('_', ' ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile Stacked Cards View */}
          <div className="md:hidden space-y-3">
            {items.map((row) => {
              const by = row.completedBy ?? row.initiatedBy;
              const net = row.completedNetwork ?? row.initiatedNetwork;
              return (
                <div
                  key={row.id}
                  onClick={() => openDetail(row)}
                  className="p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 shadow-xs transition-all space-y-3 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2.5">
                    <div className="flex items-start gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center shrink-0 border border-rose-100 mt-0.5">
                        <Archive size={16} />
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-sm tracking-tight truncate">
                          {row.organisationName}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono truncate">{row.organisationId}</div>
                      </div>
                    </div>
                    {mode === 'completed' ? (
                      <StatusBadge status="completed">Deleted</StatusBadge>
                    ) : (
                      <StatusBadge status={row.stage} />
                    )}
                  </div>

                  {row.path === 'forced' && (
                    <div className="inline-block text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      Forced Deletion
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                    <div className="bg-slate-50 rounded-lg p-2.5">
                      <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Email</div>
                      <div className="font-medium text-slate-800 truncate mt-0.5" title={row.registrationEmail || ''}>
                        {row.registrationEmail || '—'}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5">
                      <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                        {mode === 'completed' ? 'Completed At' : 'Initiated At'}
                      </div>
                      <div className="font-medium text-slate-800 truncate mt-0.5">
                        {mode === 'completed' ? formatDateTime(row.completedAt) : formatDateTime(row.initiatedAt)}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5">
                      <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Actor</div>
                      <div className="font-medium text-slate-800 truncate mt-0.5" title={actorLine(by)}>
                        {actorLine(by)}
                      </div>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2.5">
                      <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">IP · Location</div>
                      <div className="font-medium text-slate-800 font-mono truncate mt-0.5">
                        {net.ip}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
                    <span className="capitalize text-[11px]">OTP: <strong className="text-slate-700">{row.otpVerification.replace('_', ' ')}</strong></span>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="min-h-[44px] px-3 text-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetail(row);
                      }}
                    >
                      Audit Details
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[11px] text-slate-500 mt-3">{total} record{total === 1 ? '' : 's'}</p>
        </>
      )}

      <Modal
        isOpen={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.organisationName} — Deletion Record` : ''}
        maxWidth="max-w-4xl"
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-slate-400">Permanent security audit record · Immutable log</span>
            <Button variant="secondary" size="sm" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
        }
      >
        {selected && (
          <div className="flex flex-col gap-3.5">
            {/* Executive Summary Top Banner */}
            <div className="bg-gradient-to-r from-slate-50 to-indigo-50/40 border border-slate-200/80 rounded-xl p-3 sm:p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 shadow-xs flex items-center justify-center text-slate-800 font-bold text-sm shrink-0">
                  {selected.organisationName.charAt(0).toUpperCase()}
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-900 tracking-tight truncate">{selected.organisationName}</h3>
                    <StatusBadge status={selected.stage} />
                    {selected.path === 'forced' ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                        Forced Deletion
                      </span>
                    ) : (
                      <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                        Standard Security Timeline
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-slate-500 font-mono mt-0.5">
                    <span>ID: {selected.organisationId}</span>
                    <button
                      type="button"
                      onClick={() => handleCopyId(selected.organisationId)}
                      className="inline-flex items-center gap-1 text-slate-400 hover:text-indigo-600 transition-colors cursor-pointer"
                      title="Copy Organisation ID"
                    >
                      {copiedId ? (
                        <>
                          <Check size={11} className="text-emerald-600" />
                          <span className="text-[10px] text-emerald-600 font-sans font-medium">Copied!</span>
                        </>
                      ) : (
                        <Copy size={11} />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3 text-xs shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-slate-200/70">
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Initiated</span>
                  <span className="text-slate-700 font-medium text-[11px]">{formatDateTime(selected.initiatedAt)}</span>
                </div>
                <div className="w-px h-6 bg-slate-200 hidden sm:block" />
                <div className="flex flex-col">
                  <span className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Completed</span>
                  <span className="text-slate-700 font-medium text-[11px]">
                    {selected.completedAt ? formatDateTime(selected.completedAt) : 'In Progress'}
                  </span>
                </div>
              </div>
            </div>

            {/* Master-Detail 2-Column Grid */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3.5 items-start">
              {/* Left Column: Summary & Restriction Policy (5 cols) */}
              <div className="md:col-span-5 flex flex-col gap-3">
                {/* Card 1: Organisation Profile */}
                <div className="bg-white border border-slate-200/90 rounded-xl p-3 shadow-2xs flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 pb-2 border-b border-slate-100 text-[11px] font-bold text-slate-900 uppercase tracking-wider">
                    <Building2 size={13} className="text-indigo-600" />
                    <span>Organisation Profile</span>
                  </div>

                  <div className="flex flex-col gap-2 text-xs">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Mail size={11} className="text-slate-400" />
                        Registration Email
                      </span>
                      <span className="font-medium text-slate-900 break-all text-xs mt-0.5">{selected.registrationEmail || '—'}</span>
                    </div>

                    <div className="flex flex-col">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Globe size={11} className="text-slate-400" />
                        Associated Domains
                      </span>
                      {selected.domains.length ? (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selected.domains.map((d, i) => (
                            <span key={i} className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 font-mono text-[10px] border border-slate-200/60">
                              {d}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[11px] mt-0.5">None registered</span>
                      )}
                    </div>

                    <div className="flex flex-col">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Calendar size={11} className="text-slate-400" />
                        Created
                      </span>
                      <span className="text-slate-800 text-[11px] mt-0.5">{formatDateTime(selected.organisationCreatedAt)}</span>
                    </div>

                    <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-100">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Reason Given</span>
                      {selected.reason ? (
                        <div className="bg-amber-50/70 border-l-2 border-amber-500 rounded-r-md p-2 text-[11px] text-slate-700 italic leading-snug">
                          “{selected.reason}”
                        </div>
                      ) : (
                        <span className="text-slate-400 italic text-[11px]">No reason provided</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Card 2: Execution & Safeguards */}
                <div className="bg-white border border-slate-200/90 rounded-xl p-3 shadow-2xs flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 pb-2 border-b border-slate-100 text-[11px] font-bold text-slate-900 uppercase tracking-wider">
                    <ShieldCheck size={13} className="text-emerald-600" />
                    <span>Execution & Authorization</span>
                  </div>

                  <div className="flex flex-col gap-2 text-xs">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <User size={11} className="text-slate-400" />
                        Initiated By
                      </span>
                      <span className="font-semibold text-slate-900 text-[11px] mt-0.5">{actorLine(selected.initiatedBy)}</span>
                      <span className="text-[10px] text-slate-500">{formatDateTime(selected.initiatedAt)}</span>
                    </div>

                    <div className="flex flex-col">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <User size={11} className="text-slate-400" />
                        Completed By
                      </span>
                      <span className="font-semibold text-slate-900 text-[11px] mt-0.5">
                        {selected.completedAt ? actorLine(selected.completedBy) : 'Pending finalization'}
                      </span>
                      {selected.completedAt && (
                        <span className="text-[10px] text-slate-500">{formatDateTime(selected.completedAt)}</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-1 pt-1.5 border-t border-slate-100">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <KeyRound size={11} className="text-slate-400" />
                        OTP Verification
                      </span>
                      <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                            selected.otpVerification === 'verified'
                              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                              : selected.otpVerification === 'failed'
                              ? 'bg-rose-50 text-rose-700 border border-rose-200'
                              : 'bg-amber-50 text-amber-700 border border-amber-200'
                          }`}
                        >
                          {selected.otpVerification === 'verified' && <CheckCircle2 size={11} />}
                          <span className="capitalize">{selected.otpVerification.replace('_', ' ')}</span>
                        </span>
                        {selected.otpVerifiedAt && (
                          <span className="text-[10px] text-slate-500">at {formatDateTime(selected.otpVerifiedAt)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Card 3: Restrictions & Enforcement */}
                <div className="bg-white border border-slate-200/90 rounded-xl p-3 shadow-2xs flex flex-col gap-2">
                  <div className="flex items-center gap-1.5 pb-2 border-b border-slate-100 text-[11px] font-bold text-slate-900 uppercase tracking-wider">
                    <Lock size={13} className="text-rose-600" />
                    <span>Security Policy</span>
                  </div>

                  <div className="flex flex-col gap-2 text-xs">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Email Restriction</span>
                      {selected.emailRestriction.email ? (
                        <div className="flex flex-col gap-0.5 bg-rose-50/50 border border-rose-200/80 rounded-lg p-2">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700">
                            <Shield size={11} /> Permanently Restricted
                          </span>
                          <span className="text-[10px] text-rose-600 leading-snug">
                            Blocked since {formatDateTime(selected.emailRestriction.blockedAt)}. New registrations disallowed.
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-[11px]">No email restriction recorded</span>
                      )}
                    </div>

                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-medium text-slate-400 uppercase tracking-wider">Re-registration Guard</span>
                      {selected.reRegistration.status === 'blocked' ? (
                        <div className="flex flex-col gap-0.5 bg-amber-50/50 border border-amber-200/80 rounded-lg p-2">
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-800">
                            <ShieldAlert size={11} /> Guard Active
                          </span>
                          <span className="text-[10px] text-amber-700 leading-snug">
                            {selected.reRegistration.blockedAttempts.length} refused attempt{selected.reRegistration.blockedAttempts.length === 1 ? '' : 's'} intercepted.
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-[11px]">Not blocked</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Security Timeline & Telemetry (7 cols) */}
              <div className="md:col-span-7 flex flex-col gap-3 min-w-0">
                {/* Timeline Header Bar */}
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <Clock size={15} className="text-indigo-600" />
                    <div>
                      <h4 className="text-xs font-bold text-slate-900">Security Timeline</h4>
                      <p className="text-[10px] text-slate-500">Cryptographic and security audit trail of the deletion lifecycle</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {detailLoading && !selected.timeline ? (
                      <span className="text-[11px] text-indigo-600 font-medium flex items-center gap-1">
                        <RefreshCw size={11} className="animate-spin" /> Loading…
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-[10px] font-semibold">
                        {(selected.timeline ?? []).length} steps
                      </span>
                    )}
                  </div>
                </div>

                {/* Vertical Connected Timeline */}
                {(!selected.timeline || selected.timeline.length === 0) && !detailLoading ? (
                  <div className="py-8 text-center text-slate-400 text-xs italic bg-slate-50 rounded-xl border border-slate-200">
                    No security timeline steps recorded for this deletion.
                  </div>
                ) : (
                  <div className="relative pl-6 space-y-3 before:absolute before:left-[11px] before:top-2.5 before:bottom-2.5 before:w-0.5 before:bg-slate-200">
                    {(selected.timeline ?? []).map((entry: DeletionTimelineEntry, i: number) => {
                      const n = entry.network;
                      return (
                        <div key={i} className="relative group">
                          {/* Bullet Icon on Track */}
                          <div className="absolute -left-6 top-1 flex items-center justify-center">
                            {entry.success ? (
                              <div className="w-5 h-5 rounded-full bg-emerald-50 border-2 border-emerald-500 flex items-center justify-center shadow-xs">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              </div>
                            ) : (
                              <div className="w-5 h-5 rounded-full bg-rose-50 border-2 border-rose-500 flex items-center justify-center shadow-xs">
                                <XCircle className="w-3 h-3 text-rose-600" />
                              </div>
                            )}
                          </div>

                          {/* Event Card */}
                          <div className="bg-white border border-slate-200/90 rounded-xl p-3 shadow-2xs hover:border-slate-300 transition-colors flex flex-col gap-2">
                            {/* Step Title & Timestamp */}
                            <div className="flex items-start justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-slate-900">
                                  {STAGE_LABEL[entry.stage] ?? entry.stage}
                                </span>
                                {!entry.success && (
                                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700">
                                    Failed
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] font-medium text-slate-500 whitespace-nowrap">
                                {formatDateTime(entry.at)}
                              </span>
                            </div>

                            {/* Actor Line */}
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                              <User size={12} className="text-slate-400 shrink-0" />
                              <span>{actorLine(entry.actor)}</span>
                            </div>

                            {/* User Message (if any) */}
                            {entry.message && (
                              <div className="bg-slate-50 border border-slate-200/60 rounded-md px-2.5 py-1 text-[11px] text-slate-700 italic">
                                “{entry.message}”
                              </div>
                            )}

                            {/* Network & Telemetry Bar */}
                            {n && (
                              <div className="bg-slate-50/80 border border-slate-200/70 rounded-lg p-2 flex flex-col gap-1 text-[11px]">
                                {/* IP & Location */}
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="flex items-center gap-1 font-mono font-medium text-slate-800">
                                    <Globe size={11} className="text-indigo-500 shrink-0" />
                                    {n.ip}
                                  </span>
                                  {n.ipVersion && (
                                    <span className="text-[9px] font-mono px-1 py-0.2 bg-slate-200/80 rounded text-slate-700 font-semibold">
                                      IPv{n.ipVersion}
                                    </span>
                                  )}
                                  <span className="text-slate-300">·</span>
                                  <span className="text-slate-600">{n.location || 'Localhost'}</span>
                                </div>

                                {/* Device, OS, Browser */}
                                <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-slate-500">
                                  <span className="flex items-center gap-1 capitalize font-medium text-slate-700">
                                    <Laptop size={11} className="text-slate-400 shrink-0" />
                                    {n.deviceType || 'Desktop'}
                                  </span>
                                  <span className="text-slate-300">·</span>
                                  <span>{n.os}</span>
                                  <span className="text-slate-300">·</span>
                                  <span>{n.browser}{n.browserVersion ? ` v${n.browserVersion}` : ''}</span>
                                </div>

                                {/* Session ID */}
                                {n.sessionId && (
                                  <div className="flex items-center gap-1 text-[9px] font-mono text-slate-400 pt-1 border-t border-slate-200/50">
                                    <Lock size={10} className="text-slate-400 shrink-0" />
                                    <span className="truncate" title={n.sessionId}>
                                      Session: {n.sessionId}
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Refused Re-Registration Interceptions */}
                {selected.reRegistration.blockedAttempts.length > 0 && (
                  <div className="mt-1 border border-rose-200 bg-rose-50/40 rounded-xl p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-rose-800">
                        <ShieldAlert size={14} className="text-rose-600" />
                        <span>Refused Re-Registration Attempts</span>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                        {selected.reRegistration.blockedAttempts.length} refused
                      </span>
                    </div>
                    <p className="text-[10px] text-rose-600/90 leading-snug">
                      Submissions from this restricted email were intercepted and rejected by security policy:
                    </p>
                    <ul className="text-xs max-h-32 overflow-y-auto border border-rose-200/80 bg-white rounded-lg divide-y divide-slate-100">
                      {[...selected.reRegistration.blockedAttempts].reverse().map((a, i) => (
                        <li key={i} className="px-3 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-slate-700 hover:bg-slate-50 transition-colors">
                          <div className="flex items-center gap-1.5">
                            <Clock size={11} className="text-slate-400 shrink-0" />
                            <span className="text-[10px] font-medium">{formatDateTime(a.at)}</span>
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 uppercase font-semibold">{a.source}</span>
                          </div>
                          <div className="font-mono text-[10px] text-slate-600 flex items-center gap-1">
                            <span>{a.ip}</span>
                            <span className="text-slate-300">·</span>
                            <span>{a.location}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
};
