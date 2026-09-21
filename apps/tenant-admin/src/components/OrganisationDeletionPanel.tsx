import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Lock, Trash2 } from 'lucide-react';
import { api } from '../api';
import { OrganisationDeletionState, OrganisationDeletionStage, OrganisationDeletionView } from '../types';

interface OrganisationDeletionPanelProps {
  organisationName: string;
  /** Called once the organisation has been permanently deleted — the caller should sign the user out. */
  onDeleted: () => void;
}

const STAGE_ORDER: OrganisationDeletionStage[] = ['requested', 'name_confirmed', 'otp_initiated', 'final_otp_sent', 'otp_verified'];

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Danger-zone card for permanently deleting the organisation. Drives the whole security timeline:
 * 7-day suspension → exact name → 24h wait → OTP window → 24h lock → final OTP → confirm.
 * Every unlock time is enforced by the server; the countdowns here only reflect it.
 */
export const OrganisationDeletionPanel: React.FC<OrganisationDeletionPanelProps> = ({ organisationName, onDeleted }) => {
  const [state, setState] = useState<OrganisationDeletionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStartForm, setShowStartForm] = useState(false);
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

  const run = async (action: () => Promise<{ deletion: OrganisationDeletionView } | OrganisationDeletionState>, after?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      setState((prev) => ({ deletion: result.deletion, timings: (result as OrganisationDeletionState).timings ?? prev?.timings! }));
      after?.();
    } catch (err: any) {
      setError(err.message || 'That step failed.');
      // The server is the source of truth (e.g. the OTP window may have lapsed) — resync.
      load();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.cancelOrganisationDeletion();
      setState((prev) => (prev ? { ...prev, deletion: null } : prev));
      setTypedName('');
      setOtpCode('');
    } catch (err: any) {
      setError(err.message || 'Could not cancel the deletion.');
      load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white border border-rose-200 rounded-xl p-6 shadow-xs text-xs text-slate-500">Loading deletion status…</div>
    );
  }

  const unlocked = !deletion?.nextActionAvailableAt || new Date(deletion.nextActionAvailableAt).getTime() <= now;

  // Row i is done once the deletion has reached stage index >= i; the first row not done is the current one.
  const steps: { key: string; title: string; detail: string }[] = deletion
    ? [
        { key: 'requested', title: 'Deletion requested — organisation suspended', detail: `Suspended until ${formatWhen(deletion.suspensionEndsAt)}. You can cancel any time before the final step.` },
        { key: 'name', title: 'Confirm the organisation name', detail: `Type the exact name. Unlocks ${formatWhen(deletion.suspensionEndsAt)}.` },
        {
          key: 'initiate',
          title: 'Security wait, then start the OTP deletion process',
          detail: deletion.securityWaitEndsAt
            ? `Opens ${formatWhen(deletion.securityWaitEndsAt)} and must be started by ${formatWhen(deletion.otpWindowEndsAt!)}, or the deletion lapses.`
            : `${timings?.securityWaitHours ?? 24}-hour wait after the name is confirmed.`,
        },
        {
          key: 'generate',
          title: 'Second security lock, then request the final code',
          detail: deletion.finalLockEndsAt ? `Final code can be requested from ${formatWhen(deletion.finalLockEndsAt)}.` : `${timings?.finalLockHours ?? 24}-hour lock after the OTP process starts.`,
        },
        { key: 'verify', title: 'Verify the final code', detail: `A 6-digit code is emailed to you and is valid for ${timings?.finalOtpMinutes ?? 10} minutes.` },
        { key: 'delete', title: 'Permanent deletion', detail: 'Deletes everything and signs you out. The registration email is blocked from registering again.' },
      ]
    : [];

  const currentIndex = deletion ? STAGE_ORDER.indexOf(deletion.stage) : -1;

  return (
    <div className="bg-white border border-rose-200 rounded-xl p-6 shadow-xs flex flex-col gap-4" id="organisation-deletion-panel">
      <div className="flex items-center gap-2 pb-3 border-b border-rose-100">
        <Trash2 className="w-5 h-5 text-rose-600" />
        <h3 className="text-sm font-semibold text-rose-950">Delete organisation</h3>
      </div>

      {error && (
        <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {!deletion && (
        <>
          <div className="flex flex-col gap-1 max-w-2xl">
            <span className="text-xs font-semibold text-slate-900">Permanently delete {organisationName}</span>
            <p className="text-xs text-slate-500 leading-relaxed">
              Deletes the organisation with all of its domains, mailboxes, DNS credentials and administrator accounts. This cannot be undone,
              and the registration email can never be used to register again. For your protection, deletion is deliberately slow:
              the organisation is suspended for {timings?.suspensionDays ?? 7} days, then you must confirm its name, wait {timings?.securityWaitHours ?? 24} hours,
              start an OTP process, wait another {timings?.finalLockHours ?? 24} hours, and verify a final emailed code.
            </p>
          </div>

          {!showStartForm ? (
            <div>
              <button
                type="button"
                onClick={() => setShowStartForm(true)}
                className="btn btn-danger btn-sm flex items-center gap-1.5"
                id="btn-start-organisation-deletion"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete organisation…</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-w-2xl p-4 bg-rose-50/50 border border-rose-200/80 rounded-xl">
              <label htmlFor="deletion-reason" className="text-xs font-semibold text-rose-900">
                Why are you deleting it? <span className="font-normal text-rose-700">(optional, kept in the audit record)</span>
              </label>
              <textarea
                id="deletion-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={2}
                className="form-input text-xs w-full border-rose-300"
              />
              <p className="text-xs text-rose-700 leading-relaxed">
                Starting now suspends the organisation immediately: mailboxes stop working and nothing can be changed until you cancel.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => api.requestOrganisationDeletion(reason.trim() || undefined), () => setShowStartForm(false))}
                  className="btn btn-danger btn-sm"
                >
                  {busy ? 'Starting…' : 'Suspend & start deletion'}
                </button>
                <button type="button" onClick={() => setShowStartForm(false)} className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer">
                  Never mind
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {deletion && (
        <>
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>{deletion.organisationName}</strong> is suspended and scheduled for deletion. Nothing can be changed until you cancel or the deletion completes.
            </span>
          </div>

          <ol className="flex flex-col gap-2.5">
            {steps.map((step, i) => {
              const done = i <= currentIndex;
              const current = i === currentIndex + 1;
              return (
                <li key={step.key} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0">
                    {done ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : current ? (
                      <Clock className="w-4 h-4 text-amber-600" />
                    ) : (
                      <Lock className="w-4 h-4 text-slate-300" />
                    )}
                  </span>
                  <span className="flex flex-col">
                    <span className={`text-xs font-semibold ${done ? 'text-slate-500' : current ? 'text-slate-900' : 'text-slate-400'}`}>{step.title}</span>
                    <span className="text-[11px] text-slate-500 leading-relaxed">{step.detail}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          {deletion.nextAction && !unlocked && deletion.nextActionAvailableAt && (
            <p className="text-xs text-slate-600 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              Next step unlocks {formatWhen(deletion.nextActionAvailableAt)}.
            </p>
          )}

          {deletion.nextAction === 'confirm_name' && unlocked && (
            <div className="flex flex-col gap-2 max-w-md">
              <label htmlFor="deletion-name" className="text-xs font-semibold text-slate-900">
                Type <span className="underline">{deletion.organisationName}</span> exactly to continue
              </label>
              <input id="deletion-name" value={typedName} onChange={(e) => setTypedName(e.target.value)} className="form-input text-xs" autoComplete="off" />
              <button
                type="button"
                disabled={busy || typedName !== deletion.organisationName}
                onClick={() => run(() => api.confirmOrganisationName(typedName))}
                className="btn btn-danger btn-sm self-start"
              >
                Confirm name
              </button>
            </div>
          )}

          {deletion.nextAction === 'initiate_otp' && unlocked && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => api.initiateOrganisationOtp())}
              className="btn btn-danger btn-sm self-start"
            >
              Start OTP deletion process
            </button>
          )}

          {deletion.nextAction === 'generate_final_otp' && unlocked && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => api.generateOrganisationOtp())}
              className="btn btn-danger btn-sm self-start"
            >
              Email me the final code
            </button>
          )}

          {deletion.nextAction === 'verify_final_otp' && (
            <div className="flex flex-col gap-2 max-w-xs">
              <label htmlFor="deletion-otp" className="text-xs font-semibold text-slate-900">
                Enter the 6-digit code we emailed you
              </label>
              <input
                id="deletion-otp"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                className="form-input text-sm tracking-[0.4em] font-mono"
                autoComplete="one-time-code"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || otpCode.length !== 6}
                  onClick={() => run(() => api.verifyOrganisationOtp(otpCode), () => setOtpCode(''))}
                  className="btn btn-danger btn-sm"
                >
                  Verify code
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => api.generateOrganisationOtp())}
                  className="px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl cursor-pointer"
                >
                  Send a new code
                </button>
              </div>
            </div>
          )}

          {deletion.nextAction === 'final_confirmation' && (
            <div className="flex flex-col gap-2 max-w-xl p-4 bg-rose-50/50 border border-rose-200/80 rounded-xl">
              <span className="text-xs font-semibold text-rose-900">Code verified. This is the last step.</span>
              <p className="text-xs text-rose-700 leading-relaxed">
                Permanently delete <strong>{deletion.organisationName}</strong>, all of its domains, mailboxes and administrators. You will be signed out.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => run(() => api.completeOrganisationDeletion(), onDeleted)}
                className="btn btn-danger btn-sm self-start flex items-center gap-1.5"
                id="btn-final-delete-organisation"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {busy ? 'Deleting…' : 'Permanently delete organisation'}
              </button>
            </div>
          )}

          <div className="pt-3 border-t border-rose-100">
            <button
              type="button"
              disabled={busy}
              onClick={cancel}
              className="text-xs font-semibold text-slate-700 hover:text-slate-900 underline underline-offset-2 cursor-pointer disabled:opacity-50"
              id="btn-cancel-organisation-deletion"
            >
              Cancel deletion and restore the organisation
            </button>
          </div>
        </>
      )}
    </div>
  );
};
