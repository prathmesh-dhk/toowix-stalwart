import React, { useState, useEffect, useCallback } from 'react';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Unlock,
  Shield,
  ShieldAlert,
  X,
  Plus,
  Copy,
  Check,
  Clock,
  Ban,
} from 'lucide-react';
import { api } from '../api';
import { IpCheckResult, BlockedIpItem } from '../types';

interface BlockedIpsViewProps {
  domainId?: string;
  domainName?: string;
  onSwitchToAllowed?: (prefillIp?: string) => void;
}

export const BlockedIpsView: React.FC<BlockedIpsViewProps> = ({
  domainId,
  domainName,
  onSwitchToAllowed,
}) => {
  // Blocked IPs list state
  const [blockedList, setBlockedList] = useState<BlockedIpItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [tableSearch, setTableSearch] = useState('');

  // Diagnostic lookup state
  const [checkIpInput, setCheckIpInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<IpCheckResult | null>(null);
  const [unblocking, setUnblocking] = useState(false);

  // Add Block Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [inputAddress, setInputAddress] = useState('');
  const [inputReason, setInputReason] = useState('');
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Unblock modal state
  const [unblockingTarget, setUnblockingTarget] = useState<BlockedIpItem | null>(null);

  // Notifications & Clipboard
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [copiedIp, setCopiedIp] = useState<string | null>(null);

  const fetchBlockedIps = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await api.getBlockedIps(domainId);
      setBlockedList(res.list || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load blocked IPs');
    } finally {
      setLoadingList(false);
    }
  }, [domainId]);

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
      const res = await api.checkIpStatus(clean, domainId);
      setCheckResult(res);
    } catch (err: any) {
      setError(err.message || 'Failed to check IP status');
    } finally {
      setChecking(false);
    }
  };

  const handleDiagnosticUnblock = async () => {
    if (!checkResult) return;

    setUnblocking(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.unblockIp({
        id: checkResult.blockedEntry?.id,
        address: checkResult.ip,
        domainId,
      });

      setSuccessMsg(`IP address ${checkResult.ip} has been unblocked.`);
      setCheckResult({
        ...checkResult,
        isBlocked: false,
        blockedEntry: null,
      });
      await fetchBlockedIps();
    } catch (err: any) {
      setError(err.message || 'Failed to unblock IP');
    } finally {
      setUnblocking(false);
    }
  };

  const handleAddBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanAddress = inputAddress.trim();
    if (!cleanAddress) return;

    setSubmittingAdd(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.blockIp({
        address: cleanAddress,
        reason: inputReason.trim() || 'Blocked by Administrator',
        domainId,
      });
      setSuccessMsg(`IP address ${cleanAddress} has been blocked.`);
      setShowAddModal(false);
      setInputAddress('');
      setInputReason('');
      await fetchBlockedIps();
    } catch (err: any) {
      setError(err.message || 'Failed to block IP');
    } finally {
      setSubmittingAdd(false);
    }
  };

  const handleConfirmUnblockRow = async () => {
    if (!unblockingTarget) return;

    setUnblocking(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.unblockIp({
        id: unblockingTarget.id,
        address: unblockingTarget.address,
        domainId,
      });
      setSuccessMsg(`IP address ${unblockingTarget.address} has been unblocked.`);
      setUnblockingTarget(null);
      await fetchBlockedIps();
    } catch (err: any) {
      setError(err.message || 'Failed to unblock IP');
    } finally {
      setUnblocking(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIp(text);
    setTimeout(() => setCopiedIp(null), 2000);
  };

  const filteredList = blockedList.filter((item) =>
    item.address.toLowerCase().includes(tableSearch.toLowerCase()) ||
    (item.reason && item.reason.toLowerCase().includes(tableSearch.toLowerCase()))
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Toast Notifications */}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            onClick={() => setSuccessMsg(null)}
            className="text-emerald-600 hover:text-emerald-800 cursor-pointer"
          >
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
          <button
            onClick={() => setError(null)}
            className="text-rose-600 hover:text-rose-800 cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* DIAGNOSTIC LOOKUP CARD */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-7 shadow-xs flex flex-col gap-5">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Check Blocked IP</h2>
          <p className="text-xs text-slate-500 mt-1">
            Look up an IP address to see if it was blocked by failed login attempts, and unblock it.
          </p>
        </div>

        {/* Search Input Form */}
        <form onSubmit={handleDiagnosticCheck} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Enter IP address (e.g. 192.0.2.1)"
              value={checkIpInput}
              onChange={(e) => {
                setCheckIpInput(e.target.value);
                if (checkResult) setCheckResult(null);
              }}
              className="w-full pl-9 pr-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={checking || !checkIpInput.trim()}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 shrink-0 cursor-pointer shadow-xs"
          >
            {checking ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
            <span>Check IP</span>
          </button>
        </form>

        {/* Diagnostic Result */}
        {checkResult && (
          <div
            className={`p-4 sm:p-5 rounded-xl border transition-all ${
              checkResult.isBlocked
                ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-slate-900">
                      {checkResult.ip}
                    </span>
                    <span
                      className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${
                        checkResult.isBlocked
                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}
                    >
                      {checkResult.isBlocked ? 'Blocked' : 'Not Blocked'}
                    </span>
                    {checkResult.isAllowed && (
                      <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-800 border border-blue-200">
                        Allowed
                      </span>
                    )}
                  </div>

                  <p className="text-xs mt-1 text-slate-600 leading-relaxed">
                    {checkResult.isBlocked
                      ? 'This IP address is blocked due to failed login attempts. Mail connections from this network are denied.'
                      : 'This IP address is not blocked and can connect to mail normally.'}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                {checkResult.isBlocked && (
                  <button
                    onClick={handleDiagnosticUnblock}
                    disabled={unblocking}
                    className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold shadow-xs flex items-center gap-2 cursor-pointer transition-colors"
                  >
                    {unblocking ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Unlock size={14} />
                    )}
                    <span>Unblock IP</span>
                  </button>
                )}

                {onSwitchToAllowed && !checkResult.isAllowed && (
                  <button
                    onClick={() => onSwitchToAllowed(checkResult.ip)}
                    className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-lg text-xs font-medium shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Shield size={14} className="text-indigo-600" />
                    <span>Add to Allowed IPs</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* BLOCKED IPS LIST & TABLE */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Blocked IPs ({blockedList.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {domainName
                ? `Denied IP addresses and subnets for @${domainName}.`
                : 'Denied IP addresses and subnets.'}
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-end sm:self-center">
            <button
              onClick={fetchBlockedIps}
              disabled={loadingList}
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg border border-slate-200 shadow-xs transition-colors cursor-pointer"
              title="Refresh list"
            >
              <RefreshCw size={16} className={loadingList ? 'animate-spin' : ''} />
            </button>

            <button
              onClick={() => setShowAddModal(true)}
              className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-medium shadow-xs flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Plus size={15} />
              <span>Block IP</span>
            </button>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          {/* Table Search Header */}
          <div className="p-3.5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
              <input
                type="text"
                placeholder="Filter by IP address or reason..."
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-md text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-rose-500 focus:border-rose-500 font-mono"
              />
            </div>

            <span className="text-xs text-slate-500">
              Showing <strong className="text-slate-700">{filteredList.length}</strong> of{' '}
              <strong className="text-slate-700">{blockedList.length}</strong>
            </span>
          </div>

          {loadingList ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-2">
              <RefreshCw size={22} className="animate-spin text-rose-600" />
              <span className="text-xs font-medium text-slate-500">Loading blocked IPs...</span>
            </div>
          ) : filteredList.length === 0 ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
              <Ban size={32} className="text-slate-300" />
              <div className="flex flex-col gap-1 items-center">
                <span className="text-sm font-semibold text-slate-700">No blocked IPs</span>
                <span className="text-xs text-slate-500 max-w-md">
                  {tableSearch
                    ? 'No blocked IP addresses match your filter.'
                    : 'No IP addresses are currently blocked for this domain.'}
                </span>
              </div>
              {!tableSearch && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="mt-1 px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  + Block an IP
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600">
                <thead className="bg-slate-50 border-b border-slate-100 text-slate-500 uppercase tracking-wider font-semibold">
                  <tr>
                    <th className="px-5 py-3">IP Address / Subnet</th>
                    <th className="px-5 py-3">Reason / Details</th>
                    <th className="px-5 py-3">Blocked At</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredList.map((item) => {
                    const isCopied = copiedIp === item.address;

                    return (
                      <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-5 py-3.5 font-mono text-slate-900 font-medium">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-900">{item.address}</span>
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
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-rose-50 text-rose-800 border border-rose-200/60">
                            <ShieldAlert size={12} className="text-rose-600 shrink-0" />
                            <span>{item.reason || 'Blocked'}</span>
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
                                  })
                                : 'System Record'}
                            </span>
                          </div>
                        </td>

                        <td className="px-5 py-3.5 text-right">
                          <button
                            onClick={() => setUnblockingTarget(item)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-rose-700 hover:bg-rose-50 rounded-md transition-colors cursor-pointer border border-transparent hover:border-rose-200"
                            title="Unblock this IP"
                          >
                            <Unlock size={13} />
                            <span>Unblock</span>
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
      </div>

      {/* MODAL: ADD BLOCKED IP */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-5 page-content-scaled">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-rose-50 text-rose-600 rounded-lg">
                  <ShieldAlert size={18} />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">Block IP Address</h3>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Connections from this IP address or CIDR subnet will be denied immediately by the mail firewall.
            </p>

            <form onSubmit={handleAddBlock} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-700">
                  IP Address or CIDR Range <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 198.51.100.1 or 203.0.113.0/24"
                  value={inputAddress}
                  onChange={(e) => setInputAddress(e.target.value)}
                  className="px-3 py-2 text-xs font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-rose-600 focus:border-rose-600"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-700">
                  Reason or Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Suspicious brute-force attacks"
                  value={inputReason}
                  onChange={(e) => setInputReason(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-rose-600 focus:border-rose-600"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 mt-2">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingAdd || !inputAddress.trim()}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  {submittingAdd && <RefreshCw size={13} className="animate-spin" />}
                  <span>Block IP</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRM UNBLOCK ROW */}
      {unblockingTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-sm bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4 page-content-scaled">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
                  <Unlock size={18} />
                </div>
                <h3 className="text-sm font-semibold text-slate-900">Unblock IP Address</h3>
              </div>
              <button
                onClick={() => setUnblockingTarget(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to unblock{' '}
              <strong className="font-mono text-slate-900">{unblockingTarget.address}</strong>? It will immediately be allowed to connect to mail services.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setUnblockingTarget(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmUnblockRow}
                disabled={unblocking}
                className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                {unblocking && <RefreshCw size={13} className="animate-spin" />}
                <span>Unblock IP</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

