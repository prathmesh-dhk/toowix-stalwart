import React, { useState } from 'react';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Unlock,
  Shield,
  ShieldAlert,
  X,
} from 'lucide-react';
import { api } from '../api';
import { IpCheckResult } from '../types';

interface BlockedIpsViewProps {
  onSwitchToAllowed?: (prefillIp?: string) => void;
}

export const BlockedIpsView: React.FC<BlockedIpsViewProps> = ({ onSwitchToAllowed }) => {
  const [checkIpInput, setCheckIpInput] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<IpCheckResult | null>(null);
  const [unblocking, setUnblocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

  const handleUnblock = async () => {
    if (!checkResult) return;

    setUnblocking(true);
    setError(null);
    setSuccessMsg(null);
    try {
      await api.unblockIp({
        id: checkResult.blockedEntry?.id,
        address: checkResult.ip,
      });

      setSuccessMsg(`IP address ${checkResult.ip} has been unblocked.`);

      // Update state to unblocked
      setCheckResult({
        ...checkResult,
        isBlocked: false,
        blockedEntry: null,
      });
    } catch (err: any) {
      setError(err.message || 'Failed to unblock IP');
    } finally {
      setUnblocking(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
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

      {/* SEARCH CARD */}
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
                    onClick={handleUnblock}
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
    </div>
  );
};
