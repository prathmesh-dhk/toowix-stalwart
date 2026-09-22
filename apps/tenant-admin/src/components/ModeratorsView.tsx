import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trash2,
  Ban,
  X,
  Users,
  Clock,
  ShieldCheck,
} from 'lucide-react';
import { api } from '../api';
import { ModeratorItem, DomainItem } from '../types';

interface ModeratorsViewProps {
  domains: DomainItem[];
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let out = '';
  for (let i = 0; i < 16; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export const ModeratorsView: React.FC<ModeratorsViewProps> = ({ domains }) => {
  const [moderators, setModerators] = useState<ModeratorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addPassword, setAddPassword] = useState('');
  const [addScope, setAddScope] = useState<string[]>([]);
  const [submittingAdd, setSubmittingAdd] = useState(false);

  const [editingScope, setEditingScope] = useState<ModeratorItem | null>(null);
  const [editScope, setEditScope] = useState<string[]>([]);
  const [savingScope, setSavingScope] = useState(false);

  const [deletingTarget, setDeletingTarget] = useState<ModeratorItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const domainName = (id: string) => domains.find((d) => d.id === id)?.domainName || id;

  const fetchModerators = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listModerators();
      setModerators(res.moderators || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load moderators');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModerators();
  }, [fetchModerators]);

  const toggleScopeDomain = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((d) => d !== id) : [...list, id]);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addEmail.trim() || !addPassword) return;

    setSubmittingAdd(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.createModerator({ email: addEmail.trim(), password: addPassword, scopedDomainIds: addScope });
      setSuccessMsg(`Moderator ${addEmail.trim()} created.`);
      setShowAddModal(false);
      setAddEmail('');
      setAddPassword('');
      setAddScope([]);
      await fetchModerators();
    } catch (err: any) {
      setError(err.message || 'Failed to create moderator');
    } finally {
      setSubmittingAdd(false);
    }
  };

  const openEditScope = (m: ModeratorItem) => {
    setEditingScope(m);
    setEditScope(m.scopedDomainIds);
  };

  const handleSaveScope = async () => {
    if (!editingScope) return;
    setSavingScope(true);
    setError(null);
    try {
      await api.updateModerator(editingScope.id, { scopedDomainIds: editScope });
      setSuccessMsg(`Scope updated for ${editingScope.email}.`);
      setEditingScope(null);
      await fetchModerators();
    } catch (err: any) {
      setError(err.message || 'Failed to update scope');
    } finally {
      setSavingScope(false);
    }
  };

  const handleToggleStatus = async (m: ModeratorItem) => {
    setTogglingId(m.id);
    setError(null);
    try {
      await api.updateModerator(m.id, { status: m.status === 'active' ? 'disabled' : 'active' });
      await fetchModerators();
    } catch (err: any) {
      setError(err.message || 'Failed to update status');
    } finally {
      setTogglingId(null);
    }
  };

  const handleRemove = async () => {
    if (!deletingTarget) return;
    setDeletingId(deletingTarget.id);
    setError(null);
    try {
      await api.deleteModerator(deletingTarget.id);
      setSuccessMsg(`Moderator ${deletingTarget.email} removed.`);
      setDeletingTarget(null);
      await fetchModerators();
    } catch (err: any) {
      setError(err.message || 'Failed to remove moderator');
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = moderators.filter((m) => m.email.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <div className="flex flex-col gap-6">
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-800 cursor-pointer">
            <X size={16} />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-600 hover:text-rose-800 cursor-pointer">
            <X size={16} />
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Moderators ({moderators.length})</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Accounts that can manage mailboxes on specific domains only — no billing, domain, or security access.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-center">
          <button
            onClick={fetchModerators}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 shadow-xs transition-colors cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => {
              setAddPassword(generatePassword());
              setShowAddModal(true);
            }}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Plus size={15} />
            <span>Add Moderator</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Filter by email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <span className="text-xs text-slate-500">
            Showing <strong className="text-slate-700">{filtered.length}</strong> of{' '}
            <strong className="text-slate-700">{moderators.length}</strong>
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
            <RefreshCw size={22} className="animate-spin text-indigo-600" />
            <span className="text-xs font-medium text-slate-500">Loading moderators...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
            <Users size={32} className="text-slate-300" />
            <div className="flex flex-col gap-1 items-center">
              <span className="text-sm font-semibold text-slate-700">No moderators yet</span>
              <span className="text-xs text-slate-500 max-w-md">
                {searchQuery ? 'No moderators match your filter.' : 'Add a moderator to let someone manage mailboxes on specific domains.'}
              </span>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3">Email</th>
                  <th className="px-5 py-3">Scoped Domains</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Created</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-slate-900">{m.email}</td>
                    <td className="px-5 py-3.5">
                      {m.scopedDomainIds.length === 0 ? (
                        <span className="text-slate-400 italic">No domains assigned</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {m.scopedDomainIds.map((id) => (
                            <span
                              key={id}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/60"
                            >
                              {domainName(id)}
                            </span>
                          ))}
                        </div>
                      )}
                      <button
                        onClick={() => openEditScope(m)}
                        className="mt-1.5 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer block"
                      >
                        Edit scope
                      </button>
                    </td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border ${
                          m.status === 'active'
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200/60'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        <ShieldCheck size={12} className={m.status === 'active' ? 'text-emerald-600' : 'text-slate-400'} />
                        <span>{m.status === 'active' ? 'Active' : 'Disabled'}</span>
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">
                      <div className="flex items-center gap-1.5">
                        <Clock size={12} className="text-slate-400" />
                        <span>{new Date(m.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          onClick={() => handleToggleStatus(m)}
                          disabled={togglingId === m.id}
                          className="px-2.5 py-1 text-slate-600 hover:text-slate-800 hover:bg-slate-100 border border-slate-200 rounded-md font-medium text-[11px] transition-colors inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <Ban size={12} />
                          <span>{m.status === 'active' ? 'Disable' : 'Enable'}</span>
                        </button>
                        <button
                          onClick={() => setDeletingTarget(m)}
                          className="px-2.5 py-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200/70 rounded-md font-medium text-[11px] transition-colors inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 size={12} />
                          <span>Remove</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: ADD MODERATOR */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Add Moderator</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAdd} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Email <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  placeholder="moderator@yourcompany.com"
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Password <span className="text-rose-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={addPassword}
                    onChange={(e) => setAddPassword(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                    required
                    minLength={8}
                  />
                  <button
                    type="button"
                    onClick={() => setAddPassword(generatePassword())}
                    className="px-3 py-2 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-medium cursor-pointer whitespace-nowrap"
                  >
                    Regenerate
                  </button>
                </div>
                <span className="text-[11px] text-slate-400 mt-1 block">Share this with them directly — it won't be shown again.</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-2">Domain scope</label>
                {domains.length === 0 ? (
                  <p className="text-xs text-slate-400">No domains to assign yet.</p>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                    {domains.map((d) => (
                      <label key={d.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={addScope.includes(d.id)}
                          onChange={() => toggleScopeDomain(addScope, setAddScope, d.id)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <span>{d.domainName}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAdd || !addEmail.trim() || addPassword.length < 8}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {submittingAdd && <RefreshCw size={12} className="animate-spin" />}
                  <span>Add Moderator</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT SCOPE */}
      {editingScope && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Edit Scope — {editingScope.email}</h3>
              <button onClick={() => setEditingScope(null)} className="text-slate-400 hover:text-slate-600 cursor-pointer">
                <X size={18} />
              </button>
            </div>

            {domains.length === 0 ? (
              <p className="text-xs text-slate-400">No domains to assign yet.</p>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto border border-slate-200 rounded-lg p-2.5">
                {domains.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editScope.includes(d.id)}
                      onChange={() => toggleScopeDomain(editScope, setEditScope, d.id)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>{d.domainName}</span>
                  </label>
                ))}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setEditingScope(null)}
                className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveScope}
                disabled={savingScope}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {savingScope && <RefreshCw size={12} className="animate-spin" />}
                <span>Save Scope</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRM REMOVAL */}
      {deletingTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-sm bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-rose-100 text-rose-600 rounded-lg shrink-0">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Remove Moderator?</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Are you sure you want to remove <strong className="text-slate-800">{deletingTarget.email}</strong>? They will lose access immediately.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setDeletingTarget(null)}
                className="px-3.5 py-1.5 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={deletingId === deletingTarget.id}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-xs"
              >
                {deletingId === deletingTarget.id && <RefreshCw size={12} className="animate-spin" />}
                <span>Remove</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
