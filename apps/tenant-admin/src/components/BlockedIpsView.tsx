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
  Info,
  ExternalLink,
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

  const handleUseLocalIp = () => {
    setCheckIpInput('127.0.0.1');
    setCheckResult(null);
  };

  const handleUnblock = async () => {
    if (!checkResult) return;

    setUnblocking(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await api.unblockIp({
        id: checkResult.blockedEntry?.id,
        address: checkResult.ip,
      });

      setSuccessMsg(
        res.message || `IP address ${checkResult.ip} has been unblocked and Stalwart firewall rules reloaded.`
      );

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
    <div className="flex flex-col gap-6 max-w-4xl">
      {/* Toast Notifications */}
      {successMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl flex items-center justify-between text-sm animate-in fade-in duration-200">
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
        <div className="p-4 bg-rose-50 border border-rose-200 text-rose-800 rounded-xl flex items-center justify-between text-sm animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <AlertTriangle size={18} className="text-rose-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-600 hover:text-rose-800 cursor-pointer">
            <X size={16} />
          </button>
        </div>
      )}

      {/* SEARCH & DIAGNOSTIC CARD */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-col gap-6">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Search size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Check & Unblock IP Address
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Search an IP address to see if it is currently banned by Stalwart’s firewall and unblock it immediately.
              </p>
            </div>
          </div>
        </div>

        {/* Search Input Form */}
        <form onSubmit={handleDiagnosticCheck} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Enter IP address (e.g. 203.0.113.42 or 198.51.100.15)"
              value={checkIpInput}
              onChange={(e) => {
                setCheckIpInput(e.target.value);
                if (checkResult) setCheckResult(null);
              }}
              className="w-full pl-9 pr-24 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-mono"
            />
            <button
              type="button"
              onClick={handleUseLocalIp}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50/80 hover:bg-indigo-100 px-2 py-1 rounded transition-colors cursor-pointer"
            >
              Fill 127.0.0.1
            </button>
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
            className={`p-5 rounded-xl border transition-all ${
              checkResult.isBlocked
                ? 'bg-rose-50/70 border-rose-200 text-rose-950'
                : 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
              <div className="flex items-start gap-3.5">
                {checkResult.isBlocked ? (
                  <div className="p-2.5 bg-rose-100 rounded-xl text-rose-600 shrink-0 mt-0.5">
                    <ShieldAlert size={22} />
                  </div>
                ) : (
                  <div className="p-2.5 bg-emerald-100 rounded-xl text-emerald-600 shrink-0 mt-0.5">
                    <CheckCircle2 size={22} />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold tracking-tight text-slate-900">
                      {checkResult.ip}
                    </span>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-semibold inline-flex items-center gap-1.5 ${
                        checkResult.isBlocked
                          ? 'bg-rose-100 text-rose-800 border border-rose-200'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          checkResult.isBlocked ? 'bg-rose-500 animate-pulse' : 'bg-emerald-500'
                        }`}
                      ></span>
                      {checkResult.isBlocked ? 'CURRENTLY BLOCKED' : 'NOT BLOCKED'}
                    </span>
                    {checkResult.isAllowed && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-800 border border-blue-200">
                        WHITELISTED
                      </span>
                    )}
                  </div>

                  <p className="text-xs mt-1.5 text-slate-600 leading-relaxed">
                    {checkResult.isBlocked
                      ? `This IP address is blocked on Stalwart (${checkResult.blockedEntry?.reason || 'Auto-ban trigger'}). Inbound requests and mail authentication from this address are dropped.`
                      : 'This IP address has clean standing and is not restricted by Stalwart’s firewall rules.'}
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
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

      {/* GUIDANCE & BEST PRACTICES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4.5 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
            <Info size={14} className="text-indigo-600" />
            <span>Why do IPs get blocked?</span>
          </span>
          <p className="text-xs text-slate-500 leading-relaxed">
            Stalwart automatically bans IP addresses that exceed failed authentication thresholds (e.g. incorrect email passwords entered repeatedly in Outlook or Apple Mail) to prevent brute-force attacks.
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4.5 flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
            <Shield size={14} className="text-emerald-600" />
            <span>How to prevent accidental blocks</span>
          </span>
          <p className="text-xs text-slate-500 leading-relaxed">
            If your office or branch uses a static public IP address or VPN, add it to the{' '}
            <strong className="text-slate-700">Allowed IPs</strong> tab. Whitelisted addresses are exempt from rate limits and auto-banning.
          </p>
        </div>
      </div>
    </div>
  );
};
