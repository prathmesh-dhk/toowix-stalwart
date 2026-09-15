import React, { useState, useEffect, useCallback } from 'react';
import {
  ShieldAlert,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Unlock,
  Shield,
  Plus,
  X,
  Copy,
  Check,
  Globe,
  Clock,
  ExternalLink,
} from 'lucide-react';
import { api } from '../api';
import { BlockedIpItem, IpCheckResult } from '../types';

interface BlockedIpsViewProps {
  onSwitchToAllowed?: (prefillIp?: string) => void;
}

export const BlockedIpsView: React.FC<BlockedIpsViewProps> = ({ onSwitchToAllowed }) => {
  const [blockedList, setBlockedList] = useState<BlockedIpItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Diagnostic Check states
  const [checkIpInput, setCheckIpInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<IpCheckResult | null>(null);

  // Unblock action loading state (holds id or 'diagnostic')
  const [unblockingId, setUnblockingId] = useState<string | null>(null);

  // Manual Block modal state
  const [showBlockModal, setShowBlockModal] = useState(false);
  const [modalIp, setModalIp] = useState('');
  const [modalReason, setModalReason] = useState('manual');
  const [submittingBlock, setSubmittingBlock] = useState(false);

  // Copied IP state
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  const fetchBlockedIps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getBlockedIps();
      setBlockedList(res.list || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load blocked IPs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBlockedIps();
  }, [fetchBlockedIps]);

  const handleDiagnosticCheck = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = checkIpInput.trim();
    if (!clean) return;

    setChecking(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await api.checkIpStatus(clean);
      setCheckResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to check IP status');
    } finally {
      setChecking(false);
    }
  };

  const handleUseMyIp = () => {
    // Fill with client's IP from current device if available or prompt
    setCheckIpInput('127.0.0.1');
    setCheckResult(null);
  };

  const handleUnblock = async (id?: string, address?: string) => {
    setUnblockingId(id || address || 'diagnostic');
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await api.unblockIp({ id, address });
      setSuccessMsg(res.message || 'IP address unblocked and Stalwart firewall reloaded successfully.');

      // Clear diagnostic state if we unblocked that address
      if (checkResult && (checkResult.blockedEntry?.id === id || checkResult.ip === address)) {
        setCheckResult({
          ...checkResult,
          isBlocked: false,
          blockedEntry: null,
        });
      }

      await fetchBlockedIps();
    } catch (err: any) {
      setError(err.message || 'Failed to unblock IP');
    } finally {
      setUnblockingId(null);
    }
  };

  const handleManualBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalIp.trim()) return;

    setSubmittingBlock(true);
    setError(null);
    try {
      await api.blockIp({ address: modalIp.trim(), reason: modalReason });
      setSuccessMsg(`IP ${modalIp.trim()} blocked successfully.`);
      setShowBlockModal(false);
      setModalIp('');
      await fetchBlockedIps();
    } catch (err: any) {
      setError(err.message || 'Failed to block IP address');
    } finally {
      setSubmittingBlock(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIp(text);
    setTimeout(() => setCopiedIp(null), 2000);
  };

  const filteredList = blockedList.filter((item) =>
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

      {/* TOP SECTION: Diagnostic IP Status Checker */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Search size={18} className="text-indigo-600" />
            <span>IP Block Diagnostic & Automated Unblocker</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Search any IP address to instantly verify if Stalwart’s firewall has blocked it due to repeated login failures, rate-limiting, or security triggers.
          </p>
        </div>

        <form onSubmit={handleDiagnosticCheck} className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="e.g. 203.0.113.42 or 198.51.100.15"
              value={checkIpInput}
              onChange={(e) => {
                setCheckIpInput(e.target.value);
                if (checkResult) setCheckResult(null);
              }}
              className="w-full pl-9 pr-24 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono"
            />
            <button
              type="button"
              onClick={handleUseMyIp}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50/80 hover:bg-indigo-100 px-2 py-1 rounded transition-colors"
            >
              Fill 127.0.0.1
            </button>
          </div>

          <button
            type="submit"
            disabled={checking || !checkIpInput.trim()}
            className="w-full sm:w-auto px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 shrink-0 cursor-pointer shadow-xs"
          >
            {checking ? <RefreshCw size={16} className="animate-spin" /> : <ShieldAlert size={16} />}
            <span>Check IP Status</span>
          </button>
        </form>

        {/* Diagnostic Result Card */}
        {checkResult && (
          <div
            className={`p-4 rounded-xl border transition-all ${
              checkResult.isBlocked
                ? 'bg-rose-50/80 border-rose-200 text-rose-900'
                : 'bg-emerald-50/80 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                {checkResult.isBlocked ? (
                  <div className="p-2 bg-rose-100 rounded-lg text-rose-600 shrink-0 mt-0.5">
                    <ShieldAlert size={20} />
                  </div>
                ) : (
                  <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600 shrink-0 mt-0.5">
                    <CheckCircle2 size={20} />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold">{checkResult.ip}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        checkResult.isBlocked
                          ? 'bg-rose-200/70 text-rose-800'
                          : 'bg-emerald-200/70 text-emerald-800'
                      }`}
                    >
                      {checkResult.isBlocked ? 'CURRENTLY BLOCKED' : 'NOT BLOCKED'}
                    </span>
                    {checkResult.isAllowed && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-800">
                        WHITELISTED
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-1 opacity-90">
                    {checkResult.isBlocked
                      ? `Reason: ${checkResult.blockedEntry?.reason || 'Automatic brute-force trigger'}. Connections from this address to mail ports (SMTP/IMAP) are rejected.`
                      : 'This IP address has clean standing and is not restricted by Stalwart’s firewall.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {checkResult.isBlocked && (
                  <button
                    onClick={() => handleUnblock(checkResult.blockedEntry?.id, checkResult.ip)}
                    disabled={unblockingId === (checkResult.blockedEntry?.id || checkResult.ip)}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    {unblockingId === (checkResult.blockedEntry?.id || checkResult.ip) ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Unlock size={14} />
                    )}
                    <span>Unblock IP Now</span>
                  </button>
                )}

                {onSwitchToAllowed && !checkResult.isAllowed && (
                  <button
                    onClick={() => onSwitchToAllowed(checkResult.ip)}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Shield size={14} className="text-indigo-600" />
                    <span>Whitelist IP</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SUMMARY STATS & ACTION CONTROLS */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Active Blocked IPs ({blockedList.length})
          </h3>
          <p className="text-xs text-slate-500">
            Automated firewall rules. Unblocking an address immediately removes it from Stalwart and reloads the live firewall cache.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-center">
          <button
            onClick={fetchBlockedIps}
            disabled={loading}
            className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 shadow-xs transition-colors cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={() => setShowBlockModal(true)}
            className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-medium shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Plus size={14} />
            <span>Block IP Address</span>
          </button>
        </div>
      </div>

      {/* BLOCKED IPS LIST TABLE */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        {/* Table Search Header */}
        <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input
              type="text"
              placeholder="Filter by IP address or reason..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
            />
          </div>

          <span className="text-xs text-slate-500">
            Showing <strong className="text-slate-700">{filteredList.length}</strong> of{' '}
            <strong className="text-slate-700">{blockedList.length}</strong> blocked addresses
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
            <RefreshCw size={24} className="animate-spin text-indigo-600" />
            <span className="text-xs font-medium text-slate-600">Retrieving firewall rules from Stalwart...</span>
          </div>
        ) : filteredList.length === 0 ? (
          <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
            <Globe size={32} className="text-slate-300" />
            <span className="text-sm font-semibold text-slate-700">No blocked IP addresses</span>
            <span className="text-xs text-slate-500 max-w-md">
              {searchQuery
                ? 'No blocked IP addresses match your filter.'
                : 'There are currently no active IP bans on this Stalwart mail server. Any automated bans from brute-force authentication will appear here.'}
            </span>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="px-5 py-3">IP Address / Network</th>
                  <th className="px-5 py-3">Trigger / Reason</th>
                  <th className="px-5 py-3">Blocked Since</th>
                  <th className="px-5 py-3">Expiry</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredList.map((item) => {
                  const isUnblocking = unblockingId === item.id;
                  const isCopied = copiedIp === item.address;

                  return (
                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-5 py-3.5 font-mono text-slate-900 font-medium">
                        <div className="flex items-center gap-2">
                          <span>{item.address}</span>
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
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-700 border border-rose-200/60">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                          <span>{item.reason || 'Auto-ban (Security trigger)'}</span>
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

                      <td className="px-5 py-3.5 text-slate-500">
                        {item.expiresAt ? (
                          <span>{new Date(item.expiresAt).toLocaleDateString()}</span>
                        ) : (
                          <span className="text-slate-400 italic">Permanent until unblocked</span>
                        )}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {onSwitchToAllowed && (
                            <button
                              onClick={() => onSwitchToAllowed(item.address)}
                              className="px-2.5 py-1.5 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-200/80 rounded-md font-medium text-[11px] transition-colors cursor-pointer"
                              title="Add to Whitelist"
                            >
                              Whitelist
                            </button>
                          )}

                          <button
                            onClick={() => handleUnblock(item.id, item.address)}
                            disabled={isUnblocking}
                            className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-md font-medium text-[11px] transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            {isUnblocking ? (
                              <RefreshCw size={12} className="animate-spin" />
                            ) : (
                              <Unlock size={12} />
                            )}
                            <span>Unblock</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL: MANUAL BLOCK IP */}
      {showBlockModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <ShieldAlert size={18} className="text-rose-600" />
                <span>Manually Block an IP Address</span>
              </h3>
              <button
                onClick={() => setShowBlockModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Connections from this IP or network subnet will be immediately dropped by Stalwart.
            </p>

            <form onSubmit={handleManualBlock} className="flex flex-col gap-4 mt-2">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  IP Address or CIDR Subnet <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. 203.0.113.88 or 198.51.100.0/24"
                  value={modalIp}
                  onChange={(e) => setModalIp(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Reason / Trigger
                </label>
                <input
                  type="text"
                  placeholder="e.g. Suspicious unauthorized activity"
                  value={modalReason}
                  onChange={(e) => setModalReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowBlockModal(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg text-xs font-medium cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingBlock || !modalIp.trim()}
                  className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer shadow-xs"
                >
                  {submittingBlock && <RefreshCw size={12} className="animate-spin" />}
                  <span>Block Address</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
