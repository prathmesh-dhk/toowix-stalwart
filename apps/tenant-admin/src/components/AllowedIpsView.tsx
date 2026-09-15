import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldCheck,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Plus,
  Trash2,
  Copy,
  Check,
  Globe,
  Clock,
  Info,
  X,
} from 'lucide-react';
import { api } from '../api';
import { AllowedIpItem } from '../types';

interface AllowedIpsViewProps {
  initialPrefillIp?: string;
  onClearPrefillIp?: () => void;
}

export const AllowedIpsView: React.FC<AllowedIpsViewProps> = ({
  initialPrefillIp,
  onClearPrefillIp,
}) => {
  const [allowedList, setAllowedList] = useState<AllowedIpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [inputAddress, setInputAddress] = useState('');
  const [inputReason, setInputReason] = useState('');
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Delete modal state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingTarget, setDeletingTarget] = useState<AllowedIpItem | null>(null);

  // Copied IP state
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  const fetchAllowedIps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAllowedIps();
      setAllowedList(res.list || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load allowed IPs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllowedIps();
  }, [fetchAllowedIps]);

  useEffect(() => {
    if (initialPrefillIp) {
      setInputAddress(initialPrefillIp);
      setInputReason('Whitelisted from Blocked IPs');
      setShowAddModal(true);
      if (onClearPrefillIp) onClearPrefillIp();
    }
  }, [initialPrefillIp, onClearPrefillIp]);

  const handleAddAllowedIp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAddress = inputAddress.trim();
    if (!cleanAddress) return;

    setSubmittingAdd(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.addAllowedIp({
        address: cleanAddress,
        reason: inputReason.trim() || 'Whitelisted by administrator',
      });
      setSuccessMsg(`IP ${cleanAddress} added to allowlist successfully.`);
      setShowAddModal(false);
      setInputAddress('');
      setInputReason('');
      await fetchAllowedIps();
    } catch (err: any) {
      setError(err.message || 'Failed to add allowed IP');
    } finally {
      setSubmittingAdd(false);
    }
  };

  const handleRemove = async () => {
    if (!deletingTarget) return;

    setDeletingId(deletingTarget.id);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.removeAllowedIp(deletingTarget.id);
      setSuccessMsg(`IP ${deletingTarget.address} removed from allowlist.`);
      setDeletingTarget(null);
      await fetchAllowedIps();
    } catch (err: any) {
      setError(err.message || 'Failed to remove allowed IP');
    } finally {
      setDeletingId(null);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIp(text);
    setTimeout(() => setCopiedIp(null), 2000);
  };

  const filteredList = allowedList.filter((item) =>
    item.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (item.reason && item.reason.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Toast Notifications */}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-between text-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-600 hover:text-emerald-800">
            <X size={16} />
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center justify-between text-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-600 hover:text-rose-800">
            <X size={16} />
          </button>
        </div>
      )}

      {/* EDUCATIONAL INFO CARD */}
      <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl p-5 flex items-start gap-3.5 text-indigo-950">
        <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
        <div className="flex flex-col gap-1 text-xs">
          <span className="font-semibold text-indigo-900 text-sm">
            Allowed IPs (Firewall Whitelist)
          </span>
          <p className="text-indigo-800/90 leading-relaxed">
            IP addresses and CIDR subnets listed here bypass Stalwart’s automated rate-limiting, connection throttling, and brute-force ban rules. Add your static office IPs, VPN gateways, or internal mail servers to guarantee they never experience connectivity lockouts.
          </p>
        </div>
      </div>

      {/* HEADER CONTROLS */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Whitelisted Addresses ({allowedList.length})
          </h3>
          <p className="text-xs text-slate-500">
            Connections from these addresses will always be accepted without restriction.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-center">
          <button
            onClick={fetchAllowedIps}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 shadow-xs transition-colors cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Plus size={15} />
            <span>Add Whitelisted IP</span>
          </button>
        </div>
      </div>

      {/* ALLOWED IPS TABLE */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Search Header */}
        <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Filter by IP address or description..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
            />
          </div>

          <span className="text-xs text-slate-500">
            Showing <strong className="text-slate-700">{filteredList.length}</strong> of{' '}
            <strong className="text-slate-700">{allowedList.length}</strong> whitelisted addresses
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
            <RefreshCw size={24} className="animate-spin text-indigo-600" />
            <span className="text-xs font-medium text-slate-600">Loading allowed IPs from Stalwart...</span>
          </div>
        ) : filteredList.length === 0 ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
            <Globe size={32} className="text-slate-300" />
            <div className="flex flex-col gap-1 items-center">
              <span className="text-sm font-semibold text-slate-700">No whitelisted IP addresses</span>
              <span className="text-xs text-slate-500 max-w-md">
                {searchQuery
                  ? 'No whitelisted addresses match your filter.'
                  : 'You haven’t added any IP addresses to the whitelist yet. Whitelisting your office network ensures uninterrupted email access.'}
              </span>
            </div>
            {!searchQuery && (
              <button
                onClick={() => setShowAddModal(true)}
                className="mt-2 px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                + Add Office IP to Whitelist
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3">IP Address / Subnet (CIDR)</th>
                  <th className="px-5 py-3">Label / Description</th>
                  <th className="px-5 py-3">Added Date</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredList.map((item) => {
                  const isCopied = copiedIp === item.address;

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-slate-900 font-medium">
                        <div className="flex items-center gap-2">
                          <span className="text-indigo-900">{item.address}</span>
                          <button
                            onClick={() => copyToClipboard(item.address)}
                            className="text-slate-400 hover:text-slate-600 transition-colors p-1"
                            title="Copy IP"
                          >
                            {isCopied ? (
                              <Check size={12} className="text-emerald-600" />
                            ) : (
                              <Copy size={12} />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="px-5 py-3.5">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200/60">
                          <ShieldCheck size={12} className="text-emerald-600 shrink-0" />
                          <span>{item.reason || 'Whitelisted'}</span>
                        </span>
                      </td>

                      <td className="px-5 py-3.5 text-slate-500">
                        <div className="flex items-center gap-1.5">
                          <Clock size={12} className="text-slate-400" />
                          <span>
                            {item.createdAt
                              ? new Date(item.createdAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : 'System Record'}
                          </span>
                        </div>
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <button
                          onClick={() => setDeletingTarget(item)}
                          className="px-2.5 py-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200/70 rounded-md font-medium text-[11px] transition-colors inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 size={12} />
                          <span>Remove</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: ADD ALLOWED IP */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <ShieldCheck size={18} className="text-emerald-600" />
                <span>Whitelist an IP Address or CIDR</span>
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Whitelisting exempts the address from rate limits, connection caps, and automatic brute-force banning.
            </p>

            <form onSubmit={handleAddAllowedIp} className="flex flex-col gap-4 mt-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  IP Address or CIDR Notation <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 203.0.113.15 or 198.51.100.0/24"
                  value={inputAddress}
                  onChange={(e) => setInputAddress(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  required
                />
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Accepts individual IPv4/IPv6 addresses or CIDR network blocks.
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Description / Purpose
                </label>
                <input
                  type="text"
                  placeholder="e.g. Headquarters Office, Branch VPN, Monitoring"
                  value={inputReason}
                  onChange={(e) => setInputReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                />
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
                  disabled={submittingAdd || !inputAddress.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {submittingAdd && <RefreshCw size={12} className="animate-spin" />}
                  <span>Add to Whitelist</span>
                </button>
              </div>
            </form>
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
                <h3 className="text-sm font-semibold text-slate-900">Remove from Whitelist?</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Are you sure you want to remove <strong className="font-mono text-slate-800">{deletingTarget.address}</strong>?
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
              After removal, this address will no longer be exempt from rate limits or automated brute-force protection.
            </p>

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
                <span>Confirm Remove</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
