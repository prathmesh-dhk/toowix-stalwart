import React, { useCallback, useEffect, useState } from 'react';
import { Archive, CheckCircle2, RefreshCw, Search, ShieldAlert, XCircle } from 'lucide-react';
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
  completed: 'Completed',
  final_otp_sent: 'Final OTP sent',
};

const actorLine = (a: DeletionActorSnapshot | null) => (a ? `${a.name || a.email} · ${a.role === 'SUPER_ADMIN' ? 'Super Admin' : 'Tenant Admin'}` : 'System');
const deviceLine = (n: DeletionNetworkSnapshot | null) => (n ? `${n.deviceType} · ${n.os} · ${n.browser}${n.browserVersion ? ` ${n.browserVersion}` : ''}` : '—');

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[11px] font-medium text-slate-500">{label}</span>
    <span className="text-xs text-slate-900 break-words">{children}</span>
  </div>
);

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
          {(['completed', 'active'] as ListMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-md font-medium cursor-pointer ${mode === m ? 'bg-white text-indigo-600 font-semibold shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {m === 'completed' ? 'Deleted' : 'In progress'}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or domain"
            aria-label="Search deleted organisations"
            className="form-input h-8 text-xs pl-8 w-64"
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
        <div className="overflow-x-auto">
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
                    className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer align-top"
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
          <p className="text-[11px] text-slate-500 mt-3">{total} record{total === 1 ? '' : 's'}</p>
        </div>
      )}

      <Modal isOpen={!!selected} onClose={() => setSelected(null)} title={selected ? `${selected.organisationName} — deletion record` : ''} maxWidth="max-w-6xl">
        {selected && (
          <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-x-8 gap-y-6">
            {/* Summary */}
            <div className="flex flex-col gap-3.5 lg:border-r lg:border-slate-100 lg:pr-8">
              <Field label="Status"><StatusBadge status={selected.stage} /></Field>
              <Field label="Organisation ID"><span className="font-mono text-[11px] break-all">{selected.organisationId}</span></Field>
              <Field label="Registration email">{selected.registrationEmail ?? '—'}</Field>
              <Field label="Domains">{selected.domains.length ? selected.domains.join(', ') : '—'}</Field>
              <Field label="Organisation created">{formatDateTime(selected.organisationCreatedAt)}</Field>
              <Field label="Reason given">{selected.reason || '—'}</Field>
              <Field label="Deletion initiated">
                {formatDateTime(selected.initiatedAt)}
                <span className="block text-slate-500">{actorLine(selected.initiatedBy)}</span>
              </Field>
              <Field label="Deletion completed">
                {selected.completedAt ? formatDateTime(selected.completedAt) : '—'}
                {selected.completedAt && <span className="block text-slate-500">{actorLine(selected.completedBy)}</span>}
              </Field>
              <Field label="OTP verification">
                <span className="capitalize">{selected.otpVerification.replace('_', ' ')}</span>
                {selected.otpVerifiedAt ? ` · ${formatDateTime(selected.otpVerifiedAt)}` : ''}
              </Field>
              <Field label="Deletion path">{selected.path === 'forced' ? 'Forced immediate delete (timeline bypassed)' : 'Standard security timeline'}</Field>
              <Field label="Email restriction">
                {selected.emailRestriction.email
                  ? `Permanently blocked since ${formatDateTime(selected.emailRestriction.blockedAt)}`
                  : 'Not applied yet'}
              </Field>
              <Field label="Re-registration">
                {selected.reRegistration.status === 'blocked'
                  ? `Blocked · ${selected.reRegistration.blockedAttempts.length} attempt${selected.reRegistration.blockedAttempts.length === 1 ? '' : 's'} refused`
                  : 'Not blocked (deletion not completed, or no registration email on record)'}
              </Field>
            </div>

            {/* Timeline */}
            <div className="flex flex-col gap-5 min-w-0">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-slate-900">Security timeline</span>
                {detailLoading && !selected.timeline && <span className="text-xs text-slate-500">Loading timeline…</span>}
                <ol className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {(selected.timeline ?? []).map((entry: DeletionTimelineEntry, i: number) => {
                    const n = entry.network;
                    return (
                      <li key={i} className="p-3 rounded-lg border border-slate-200 flex flex-col gap-1.5 min-w-0">
                        <div className="flex items-start justify-between gap-3">
                          <span className="flex items-center gap-1.5 min-w-0">
                            {entry.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <XCircle className="w-4 h-4 text-rose-600 shrink-0" />}
                            <span className="text-xs font-semibold text-slate-900">
                              {STAGE_LABEL[entry.stage] ?? entry.stage}
                              {!entry.success && <span className="ml-1.5 text-rose-600 font-medium">failed</span>}
                            </span>
                          </span>
                          <span className="text-[11px] text-slate-500 shrink-0">{formatDateTime(entry.at)}</span>
                        </div>
                        <div className="text-[11px] text-slate-600">{actorLine(entry.actor)}</div>
                        {entry.message && <div className="text-[11px] text-slate-500 italic">“{entry.message}”</div>}
                        {n && (
                          <div className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-100 pt-1.5">
                            <div>
                              <span className="font-mono text-slate-700">{n.ip}</span>
                              {n.ipVersion ? <span className="text-slate-400"> IPv{n.ipVersion}</span> : null} · {n.location}
                            </div>
                            <div className="capitalize">
                              {n.deviceType} · {n.os} · {n.browser}
                              {n.browserVersion ? ` v${n.browserVersion}` : ''}
                            </div>
                            {n.sessionId && (
                              <div className="font-mono text-[10px] text-slate-400 truncate" title={n.sessionId}>
                                session {n.sessionId}
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>

              {selected.reRegistration.blockedAttempts.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                    <ShieldAlert size={12} /> Refused re-registration attempts (latest 100)
                  </span>
                  <ul className="text-[11px] text-slate-700 max-h-28 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                    {[...selected.reRegistration.blockedAttempts].reverse().map((a, i) => (
                      <li key={i} className="px-3 py-1.5 flex justify-between gap-3">
                        <span>{formatDateTime(a.at)} · {a.source}</span>
                        <span className="font-mono">{a.ip} · {a.location}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
};
