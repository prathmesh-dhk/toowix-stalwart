import React, { useState } from 'react';
import { DomainItem } from '../types';
import { api } from '../api';
import { AlertTriangle, Loader2, X, Trash2 } from 'lucide-react';

interface DomainDeletionModalProps {
  domain: DomainItem | null;
  isOpen: boolean;
  onClose: () => void;
  onDeleted: () => void;
}

export const DomainDeletionModal: React.FC<DomainDeletionModalProps> = ({
  domain,
  isOpen,
  onClose,
  onDeleted,
}) => {
  const [confirmationInput, setConfirmationInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !domain) return null;

  const isConfirmed = confirmationInput.trim().toLowerCase() === domain.domainName.toLowerCase();
  const mailboxCount = domain.mailboxCount ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isConfirmed || mailboxCount > 0 || loading) return;

    setLoading(true);
    setError(null);

    try {
      await api.deleteDomain(domain.id);
      onDeleted();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to delete domain.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-[2px] p-4 overflow-y-auto animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 md:p-7 flex flex-col gap-5 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200/60 flex items-center justify-center text-rose-600 shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Delete Domain</h3>
              <p className="text-xs text-slate-500 font-mono mt-0.5">{domain.domainName}</p>
            </div>
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

        {/* Warning Callout */}
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900 flex flex-col gap-2">
          <div className="flex items-center gap-2 font-semibold text-rose-800">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>This deletes the domain immediately</span>
          </div>
          <p className="leading-relaxed text-rose-700">
            No Super Admin review needed since this domain has no mailboxes. This cannot be undone.
          </p>
          <ul className="list-disc pl-4 text-rose-800 space-y-1">
            <li>Any active Stripe subscription for this domain will be <strong>permanently cancelled</strong>.</li>
            <li>Stored DNS provider credentials and zone records will be purged.</li>
            <li>Stalwart mail routing rules and DKIM keys for <strong>{domain.domainName}</strong> will be erased.</li>
          </ul>
        </div>

        {mailboxCount > 0 ? (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold block mb-0.5">Cannot Delete Active Mailboxes</strong>
              This domain currently has {mailboxCount} active {mailboxCount === 1 ? 'mailbox' : 'mailboxes'}. You must remove all mailboxes before deleting it.
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {/* Confirmation typing */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-slate-700">
                To confirm, type <span className="font-mono text-rose-600 font-bold select-all">{domain.domainName}</span> below:
              </label>
              <input
                type="text"
                value={confirmationInput}
                onChange={(e) => setConfirmationInput(e.target.value)}
                placeholder={domain.domainName}
                className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 transition-all placeholder:text-slate-400"
                autoComplete="off"
              />
            </div>

            {/* Actions */}
            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!isConfirmed || loading}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting…</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Domain</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
