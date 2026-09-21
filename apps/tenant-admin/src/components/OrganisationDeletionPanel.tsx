import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Clock, Trash2 } from 'lucide-react';
import { api } from '../api';
import { OrganisationDeletionState, OrganisationDeletionView } from '../types';

interface OrganisationDeletionPanelProps {
  organisationName: string;
  /** How many domains the organisation still has — all of them must be deleted first. */
  domainCount: number;
  /** Takes the admin to where domains are deleted. */
  onGoToDomains?: () => void;
  /** Called once the organisation has been permanently deleted — the caller should sign the user out. */
  onDeleted: () => void;
}

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Danger-zone card for permanently deleting the organisation. It only ever shows the *current* step:
 * reason → exact name (suspends the org) → 7 days → request the code → 24 hours → code emailed → enter it
 * (deletes the org). The organisation can be restored at any step before the code is entered.
 * Every wait is enforced by the server; the dates shown here only reflect it.
 */
export const OrganisationDeletionPanel: React.FC<OrganisationDeletionPanelProps> = ({ organisationName, domainCount, onGoToDomains, onDeleted }) => {
  const [state, setState] = useState<OrganisationDeletionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askingReason, setAskingReason] = useState(false);
  const [reason, setReason] = useState('');
  const [typedName, setTypedName] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setState(await api.getOrganisationDeletion());
    } catch (err: any) {
      setError(err.message || 'Could not load the deletion status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Keep the "unlocks at" gates honest without a page refresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const deletion = state?.deletion ?? null;
  const timings = state?.timings;

  const run = async (action: () => Promise<{ deletion: OrganisationDeletionView | null }>, after?: (d: OrganisationDeletionView | null) => void) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setState((prev) => ({ deletion: result.deletion, timings: (result as Partial<OrganisationDeletionState>).timings ?? prev!.timings }));
      after?.(result.deletion);
    } catch (err: any) {
      setError(err.message || 'That step failed.');
      // The server is the source of truth — resync.
      load();
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.cancelOrganisationDeletion();
      setState((prev) => (prev ? { ...prev, deletion: null } : prev));
      setAskingReason(false);
      setTypedName('');
      setOtpCode('');
    } catch (err: any) {
      setError(err.message || 'Could not restore the organisation.');
      load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="bg-white border border-rose-200 rounded-2xl p-6 sm:p-7 shadow-xs text-xs text-slate-500">Loading deletion status…</div>;
  }

  const unlocked = !deletion?.nextActionAvailableAt || new Date(deletion.nextActionAvailableAt).getTime() <= now;
  const restoreLabel = deletion?.stage === 'requested' ? 'Never mind' : 'Restore organisation';

  const restoreButton = (
    <button type="button" disabled={busy} onClick={restore} className={`btn btn-sm ${deletion?.stage === 'requested' ? 'btn-secondary' : 'btn-success'}`} id="btn-cancel-organisation-deletion">
      {restoreLabel}
    </button>
  );

  const waitNotice = (text: string, when: string) => (
    <p className="text-xs text-slate-600 flex items-start gap-1.5 max-w-2xl">
      <Clock className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
      <span>
        {text} <strong>{formatWhen(when)}</strong>.
      </span>
    </p>
  );

  return (
    <div className="bg-white border border-rose-200 rounded-2xl p-6 sm:p-7 shadow-xs flex flex-col gap-5" id="organisation-deletion-panel">
      <div className="pb-4 border-b border-rose-100">
        <h2 className="text-xs font-bold uppercase tracking-wider text-rose-950">Delete organisation</h2>
        <p className="text-xs text-slate-500 mt-1">Permanently remove this organisation and everything in it.</p>
      </div>

      {error && (
        <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Nothing in progress: explain, then ask for a reason */}
      {!deletion && !askingReason && (
        <>
          <div className="flex flex-col gap-1 max-w-2xl">
            <span className="text-xs font-semibold text-slate-900">Permanently delete {organisationName}</span>
            <p className="text-xs text-slate-500 leading-relaxed">
              Deletes the organisation with all of its domains, mailboxes, DNS credentials and administrator accounts. This cannot be undone,
              and the registration email can never be used to register again. The organisation is suspended straight away and you can restore it
              at any point before the final code is entered.
            </p>
          </div>
          {domainCount > 0 ? (
            <div className="mx-auto w-full max-w-2xl flex flex-col gap-3">
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900" id="organisation-deletion-domains-notice">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  You still have <strong>{domainCount} domain{domainCount === 1 ? '' : 's'}</strong>. Every domain must be deleted before the organisation can be deleted.
                </span>
              </div>
              {onGoToDomains && (
                <div>
                  <button type="button" onClick={onGoToDomains} className="btn btn-secondary btn-sm" id="btn-go-to-domains">
                    Go to Domains
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto w-full max-w-2xl flex justify-start">
              <button type="button" onClick={() => setAskingReason(true)} className="btn btn-danger btn-sm flex items-center gap-1.5" id="btn-start-organisation-deletion">
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete organisation…</span>
              </button>
            </div>
          )}
        </>
      )}

      {/* Step 1: reason */}
      {!deletion && askingReason && (
        <div className="flex flex-col gap-3 max-w-2xl">
          <label htmlFor="deletion-reason" className="text-xs font-semibold text-slate-900">
            Why are you deleting it? <span className="font-normal text-slate-500">(optional, kept in the audit record)</span>
          </label>
          <input id="deletion-reason" type="text" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Closing the company" className="form-input text-xs" autoComplete="off" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => api.requestOrganisationDeletion(reason.trim() || undefined), () => setAskingReason(false))}
              className="btn btn-danger btn-sm"
            >
              {busy ? 'Continuing…' : 'Continue'}
            </button>
            <button type="button" disabled={busy} onClick={() => setAskingReason(false)} className="btn btn-secondary btn-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Step 2: exact name — this is what suspends the organisation */}
      {deletion?.nextAction === 'confirm_name' && (
        <div className="flex flex-col gap-3 max-w-xl">
          <label htmlFor="deletion-name" className="text-xs font-semibold text-slate-900">
            Type <span className="underline">{deletion.organisationName}</span> exactly to confirm
          </label>
          <p className="text-xs text-slate-500 leading-relaxed">
            Your organisation is suspended as soon as you confirm: mailboxes stop working and nothing can be changed. You can restore it any time before the
            final code is entered.
          </p>
          <input id="deletion-name" value={typedName} onChange={(e) => setTypedName(e.target.value)} className="form-input text-xs" autoComplete="off" />
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy || typedName !== deletion.organisationName}
              onClick={() => run(() => api.confirmOrganisationName(typedName))}
              className="btn btn-danger btn-sm"
            >
              {busy ? 'Suspending…' : 'Confirm and suspend organisation'}
            </button>
            {restoreButton}
          </div>
        </div>
      )}

      {/* Step 3: suspended, 7-day wait, then request the code */}
      {deletion?.nextAction === 'initiate_otp' && (
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 max-w-2xl">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>{deletion.organisationName}</strong> is suspended and scheduled for deletion. Nothing can be changed until you restore it or it is deleted.
            </span>
          </div>
          {!unlocked && deletion.nextActionAvailableAt ? (
            waitNotice(`You can request the deletion code after the ${timings?.suspensionDays ?? 7}-day suspension, on`, deletion.nextActionAvailableAt)
          ) : (
            <p className="text-xs text-slate-600">The suspension period is over. You can now request the deletion code.</p>
          )}
          <div className="flex items-center gap-2">
            {unlocked && (
              <button type="button" disabled={busy} onClick={() => run(() => api.initiateOrganisationOtp())} className="btn btn-danger btn-sm">
                Request deletion code
              </button>
            )}
            {restoreButton}
          </div>
        </div>
      )}

      {/* Step 4a: code requested, 24-hour wait, then it is emailed */}
      {deletion?.nextAction === 'generate_final_otp' && (
        <div className="flex flex-col gap-3">
          {!unlocked && deletion.nextActionAvailableAt ? (
            waitNotice(`Deletion code requested. It can be sent to your email after ${timings?.otpWaitHours ?? 24} hours, on`, deletion.nextActionAvailableAt)
          ) : (
            <p className="text-xs text-slate-600">You can now have the deletion code sent to your email.</p>
          )}
          <div className="flex items-center gap-2">
            {unlocked && (
              <button type="button" disabled={busy} onClick={() => run(() => api.generateOrganisationOtp())} className="btn btn-danger btn-sm">
                Send code to my email
              </button>
            )}
            {restoreButton}
          </div>
        </div>
      )}

      {/* Step 4b: enter the code — this deletes the organisation */}
      {deletion?.nextAction === 'verify_final_otp' && (
        <div className="flex flex-col gap-3 max-w-xl">
          <label htmlFor="deletion-otp" className="text-xs font-semibold text-slate-900">
            Enter the 6-digit code we emailed you
          </label>
          <p className="text-xs text-slate-500 leading-relaxed">
            The code is valid for {timings?.finalOtpMinutes ?? 10} minutes. Entering it permanently deletes {deletion.organisationName} and signs you out.
          </p>
          <input
            id="deletion-otp"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            className="form-input w-48 text-center text-sm tracking-[0.4em] font-mono"
            autoComplete="one-time-code"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy || otpCode.length !== 6}
              onClick={() =>
                run(() => api.verifyOrganisationOtp(otpCode), (d) => {
                  setOtpCode('');
                  if (d?.stage === 'completed') onDeleted();
                })
              }
              className="btn btn-danger btn-sm flex items-center gap-1.5"
              id="btn-final-delete-organisation"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {busy ? 'Deleting…' : 'Verify and permanently delete'}
            </button>
            <button type="button" disabled={busy} onClick={() => run(() => api.generateOrganisationOtp())} className="btn btn-secondary btn-sm">
              Send a new code
            </button>
            {restoreButton}
          </div>
        </div>
      )}
    </div>
  );
};
