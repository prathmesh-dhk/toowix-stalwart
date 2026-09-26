import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { MailboxItem, MailboxAliasItem } from '../../types';
import { Modal } from '../ui/Modal';

interface ManageAliasesModalProps {
  isOpen: boolean;
  onClose: () => void;
  mailbox: MailboxItem | null;
  onAliasesUpdated?: () => void;
}

export const ManageAliasesModal: React.FC<ManageAliasesModalProps> = ({
  isOpen,
  onClose,
  mailbox,
  onAliasesUpdated,
}) => {
  const [aliases, setAliases] = useState<MailboxAliasItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [localPart, setLocalPart] = useState('');
  const mailboxDomain = mailbox?.address.split('@')[1] || '';

  const fetchAliases = useCallback(async () => {
    if (!mailbox) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.listMailboxAliases(mailbox.id);
      setAliases(res.aliases || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load aliases.');
    } finally {
      setLoading(false);
    }
  }, [mailbox]);

  useEffect(() => {
    if (isOpen && mailbox) {
      fetchAliases();
      setLocalPart('');
      setError(null);
    }
  }, [isOpen, mailbox, fetchAliases]);

  const handleAddAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mailbox) return;

    const trimmedLocal = localPart.trim().toLowerCase();
    if (!trimmedLocal) return;

    if (!/^[a-zA-Z0-9._-]+$/.test(trimmedLocal)) {
      setError('Letters, numbers, dots, hyphens, and underscores only.');
      return;
    }

    setAdding(true);
    setError(null);

    try {
      const res = await api.addMailboxAlias(mailbox.id, {
        localPart: trimmedLocal,
      });

      setAliases((prev) => [...prev, res.alias]);
      setLocalPart('');
      if (onAliasesUpdated) onAliasesUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to add alias.');
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteAlias = async (alias: MailboxAliasItem) => {
    if (!mailbox) return;
    setDeletingId(alias.id);
    setError(null);

    try {
      await api.deleteMailboxAlias(mailbox.id, alias.id);
      setAliases((prev) => prev.filter((a) => a.id !== alias.id));
      if (onAliasesUpdated) onAliasesUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to delete alias.');
    } finally {
      setDeletingId(null);
    }
  };

  if (!mailbox) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Email Aliases"
      maxWidth="max-w-[420px]"
    >
      <div className="space-y-3.5">
        <p className="text-xs text-slate-500 -mt-2">
          Deliver alternate addresses to <span className="font-medium text-slate-800 font-mono">{mailbox.address}</span>
        </p>

        {/* Minimalist Single-Line Add Form */}
        <form onSubmit={handleAddAlias} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <input
              type="text"
              value={localPart}
              onChange={(e) => setLocalPart(e.target.value.toLowerCase())}
              placeholder="alias"
              className="flex-1 min-w-0 text-base sm:text-xs px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-1.5 focus:ring-indigo-500 font-mono bg-white min-h-[44px] sm:min-h-0"
              required
              autoFocus
            />

            <span className="text-xs font-mono text-slate-600 px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg select-none shrink-0 min-h-[44px] sm:min-h-0 flex items-center">
              @{mailboxDomain}
            </span>
          </div>

          <button
            type="submit"
            disabled={adding || !localPart.trim()}
            className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors shrink-0 flex items-center justify-center gap-1 cursor-pointer min-h-[44px]"
          >
            {adding ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Add Alias</span>
              </>
            )}
          </button>
        </form>

        {/* Error message */}
        {error && (
          <div className="text-xs text-rose-600 bg-rose-50 border border-rose-200/60 rounded-lg px-2.5 py-1.5 flex items-center justify-between gap-2">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-rose-400 hover:text-rose-700 text-sm leading-none"
            >
              &times;
            </button>
          </div>
        )}

        {/* Aliases List */}
        <div className="pt-2 border-t border-slate-100">
          {loading ? (
            <div className="py-6 flex items-center justify-center text-slate-400 text-xs gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
              <span>Loading...</span>
            </div>
          ) : aliases.length === 0 ? (
            <p className="py-4 text-center text-xs text-slate-400">
              No aliases added yet.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-56 overflow-y-auto">
              {aliases.map((alias) => (
                <div
                  key={alias.id}
                  className="flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100/80 border border-slate-200/60 rounded-lg text-xs transition-colors group"
                >
                  <span className="font-mono text-slate-800 font-medium truncate">
                    {alias.address}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDeleteAlias(alias)}
                    disabled={deletingId === alias.id}
                    className="min-w-[40px] min-h-[40px] flex items-center justify-center text-slate-400 hover:text-rose-600 rounded transition-colors disabled:opacity-50 cursor-pointer shrink-0"
                    title={`Delete alias ${alias.address}`}
                    aria-label={`Delete alias ${alias.address}`}
                  >
                    {deletingId === alias.id ? (
                      <Loader2 className="w-4 h-4 animate-spin text-rose-500" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
