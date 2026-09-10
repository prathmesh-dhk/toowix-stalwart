import React, { useState, useEffect, useCallback } from 'react';
import {
  Smartphone,
  Mail,
  Key,
  Check,
  Copy,
  RefreshCw,
  Trash2,
  Lock,
  QrCode,
  CheckCircle2,
  X,
  Edit3,
  Info,
} from 'lucide-react';
import { api } from '../api';
import { SecuritySettings, UserContext } from '../types';

interface SecuritySettingsViewProps {
  user?: UserContext | null;
}

export const SecuritySettingsView: React.FC<SecuritySettingsViewProps> = ({ user }) => {
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  // Recovery email states
  const [isEditingRecovery, setIsEditingRecovery] = useState(false);
  const [recoveryEmailInput, setRecoveryEmailInput] = useState('');
  const [recoveryOtpInput, setRecoveryOtpInput] = useState('');
  const [awaitingRecoveryOtp, setAwaitingRecoveryOtp] = useState(false);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [confirmRemoveRecovery, setConfirmRemoveRecovery] = useState(false);

  // 2FA states
  const [switching2Fa, setSwitching2Fa] = useState(false);
  const [confirmDisable2Fa, setConfirmDisable2Fa] = useState(false);
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [totpCodeInput, setTotpCodeInput] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getSecuritySettings();
      setSettings(data);
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to load security settings.' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Handle Recovery Email OTP Send
  const handleSendRecoveryOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!recoveryEmailInput || !recoveryEmailInput.includes('@')) {
      setFeedback({ type: 'error', message: 'Please enter a valid recovery email address.' });
      return;
    }

    setRecoveryLoading(true);
    setFeedback(null);
    try {
      const res = await api.sendRecoveryEmailOtp(recoveryEmailInput.trim().toLowerCase());
      setAwaitingRecoveryOtp(true);
      setFeedback({
        type: 'info',
        message: res.message || `A 6-digit verification code was sent to ${recoveryEmailInput}.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to send verification code.' });
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Handle Recovery Email OTP Verify
  const handleVerifyRecoveryOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (recoveryOtpInput.trim().length !== 6) {
      setFeedback({ type: 'error', message: 'Please enter the 6-digit verification code.' });
      return;
    }

    setRecoveryLoading(true);
    setFeedback(null);
    try {
      const res = await api.verifyRecoveryEmailOtp(recoveryOtpInput.trim());
      setSettings((prev) => (prev ? { ...prev, recoveryEmail: res.recoveryEmail } : prev));
      setIsEditingRecovery(false);
      setAwaitingRecoveryOtp(false);
      setRecoveryEmailInput('');
      setRecoveryOtpInput('');
      setFeedback({
        type: 'success',
        message: 'Recovery email verified and updated successfully!',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Invalid or expired verification code.' });
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Handle Remove Recovery Email
  const handleRemoveRecoveryEmail = async () => {
    setRecoveryLoading(true);
    setFeedback(null);
    try {
      await api.removeRecoveryEmail();
      setSettings((prev) => (prev ? { ...prev, recoveryEmail: null } : prev));
      setConfirmRemoveRecovery(false);
      setFeedback({ type: 'success', message: 'Recovery email removed.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to remove recovery email.' });
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Handle Switching to Email 2FA
  const handleSwitchToEmail2Fa = async () => {
    setSwitching2Fa(true);
    setFeedback(null);
    try {
      const res = await api.update2FaMode('email');
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              twoFactorEnabled: res.twoFactorEnabled,
              twoFactorMethod: res.twoFactorMethod,
            }
          : prev
      );
      setTotpSetupData(null);
      setFeedback({
        type: 'success',
        message: `Two-Factor Authentication updated to Email OTP. Codes will be sent to ${settings?.email || user?.email}.`,
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to switch to Email 2FA.' });
    } finally {
      setSwitching2Fa(false);
    }
  };

  // Handle Disabling 2FA
  const handleDisable2Fa = async () => {
    setSwitching2Fa(true);
    setFeedback(null);
    try {
      const res = await api.update2FaMode('disabled');
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              twoFactorEnabled: res.twoFactorEnabled,
              twoFactorMethod: res.twoFactorMethod,
            }
          : prev
      );
      setConfirmDisable2Fa(false);
      setTotpSetupData(null);
      setFeedback({
        type: 'info',
        message: 'Two-Factor Authentication has been disabled. You can re-enable it at any time.',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to disable 2FA.' });
    } finally {
      setSwitching2Fa(false);
    }
  };

  // Handle Start TOTP Setup
  const handleStartTotpSetup = async () => {
    setTotpLoading(true);
    setFeedback(null);
    try {
      const data = await api.setupTotp2Fa();
      setTotpSetupData(data);
      setTotpCodeInput('');
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to initiate Authenticator setup.' });
    } finally {
      setTotpLoading(false);
    }
  };

  // Handle Confirm TOTP Setup
  const handleConfirmTotp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (totpCodeInput.trim().length !== 6) {
      setFeedback({ type: 'error', message: 'Please enter the 6-digit code from your authenticator app.' });
      return;
    }

    setTotpLoading(true);
    setFeedback(null);
    try {
      await api.confirmTotp2Fa(totpCodeInput.trim());
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              twoFactorEnabled: true,
              twoFactorMethod: 'totp',
              hasTotpConfigured: true,
            }
          : prev
      );
      setTotpSetupData(null);
      setTotpCodeInput('');
      setFeedback({
        type: 'success',
        message: 'Authenticator App 2FA successfully configured and activated!',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Invalid 6-digit verification code.' });
    } finally {
      setTotpLoading(false);
    }
  };

  const copySecretToClipboard = (secret: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
      </div>
    );
  }

  const accountEmail = settings?.email || user?.email || 'admin@organization.com';
  const current2FaMethod = settings?.twoFactorEnabled ? settings.twoFactorMethod || 'totp' : 'disabled';

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      {/* Minimal Header */}
      <div className="flex flex-col gap-1 pb-1">
        <h1 className="text-xl font-semibold text-slate-900 tracking-tight">Account Security</h1>
        <p className="text-xs text-slate-500">
          Manage your two-factor authentication methods and backup recovery email.
        </p>
      </div>

      {/* Global Minimal Feedback Message */}
      {feedback && (
        <div className="flex items-center justify-between px-4 py-3 bg-indigo-50/50 border border-indigo-200/70 rounded-lg text-xs text-indigo-900 animate-in fade-in duration-150">
          <div className="flex items-center gap-2 min-w-0">
            <Info className="w-4 h-4 text-indigo-600 shrink-0" />
            <span className="truncate">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-indigo-400 hover:text-indigo-700 p-0.5 ml-2 shrink-0 cursor-pointer"
            aria-label="Close message"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SECTION 1: TWO-FACTOR AUTHENTICATION METHODS                          */}
      {/* ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Two-Factor Authentication (2FA) Methods</h2>
            <p className="text-xs text-slate-500 mt-0.5">Protect your administrative account with an additional verification step at sign-in.</p>
          </div>
          <span className="text-[11px] font-medium text-slate-400 hidden sm:inline">
            Active: {current2FaMethod === 'totp' ? 'Authenticator App' : current2FaMethod === 'email' ? 'Email OTP' : 'Disabled'}
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {/* Option 1: Authenticator App (TOTP) */}
          <div className={`p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
            current2FaMethod === 'totp' ? 'bg-indigo-50/20' : 'bg-white'
          }`}>
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0 mt-0.5">
                <Smartphone className="w-4 h-4" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">Authenticator App (TOTP)</span>
                  {current2FaMethod === 'totp' && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-full">
                      <Check className="w-3 h-3 text-indigo-600" /> Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Generate secure 6-digit codes with Google Authenticator, 1Password, or Authy.
                </p>
              </div>
            </div>

            <div className="shrink-0 sm:self-center pl-12 sm:pl-0">
              {current2FaMethod === 'totp' ? (
                <button
                  type="button"
                  onClick={handleStartTotpSetup}
                  disabled={totpLoading}
                  className="px-3.5 py-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100/70 border border-indigo-200/60 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Reconfigure App</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStartTotpSetup}
                  disabled={totpLoading}
                  className="px-3.5 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Key className="w-3.5 h-3.5" />
                  <span>Setup Authenticator</span>
                </button>
              )}
            </div>
          </div>

          {/* Option 2: Email Verification OTP */}
          <div className={`p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
            current2FaMethod === 'email' ? 'bg-indigo-50/20' : 'bg-white'
          }`}>
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0 mt-0.5">
                <Mail className="w-4 h-4" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">Email Verification OTP</span>
                  {current2FaMethod === 'email' && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-full">
                      <Check className="w-3 h-3 text-indigo-600" /> Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Receive a 6-digit one-time code sent directly to your registered account email: <span className="font-mono text-slate-700 font-medium">{accountEmail}</span>
                </p>
              </div>
            </div>

            <div className="shrink-0 sm:self-center pl-12 sm:pl-0">
              {current2FaMethod === 'email' ? (
                <span className="text-xs text-indigo-600 font-medium inline-flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Enforced at login
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleSwitchToEmail2Fa}
                  disabled={switching2Fa}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:text-indigo-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Switch to Email 2FA
                </button>
              )}
            </div>
          </div>

          {/* Option 3: Password Only */}
          <div className={`p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
            current2FaMethod === 'disabled' ? 'bg-indigo-50/20' : 'bg-white'
          }`}>
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0 mt-0.5">
                <Lock className="w-4 h-4" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900">Password Only</span>
                  {current2FaMethod === 'disabled' && (
                    <span className="inline-flex items-center text-[11px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Sign in using your password only. No secondary verification step.
                </p>
              </div>
            </div>

            <div className="shrink-0 sm:self-center pl-12 sm:pl-0">
              {current2FaMethod === 'disabled' ? (
                <span className="text-xs text-slate-400 font-medium">Standard protection</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDisable2Fa(true)}
                  className="px-3.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Disable 2FA
                </button>
              )}
            </div>
          </div>

          {/* Inline TOTP Setup Panel */}
          {totpSetupData && (
            <div className="p-5 bg-indigo-50/30 border-t border-indigo-100 flex flex-col gap-4 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <QrCode className="w-4 h-4 text-indigo-600" />
                  <span className="text-xs font-semibold text-slate-900">Configure Authenticator App</span>
                </div>
                <button
                  onClick={() => setTotpSetupData(null)}
                  className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col md:flex-row items-center gap-6">
                <div className="flex flex-col items-center gap-2 bg-white p-3 rounded-lg border border-slate-200 shrink-0">
                  <img
                    src={totpSetupData.qrCodeDataUrl}
                    alt="TOTP QR Code"
                    className="w-36 h-36 object-contain"
                  />
                  <div className="flex items-center gap-1.5">
                    <code className="text-[11px] font-mono bg-slate-50 px-2 py-0.5 rounded text-slate-700 border border-slate-100 select-all">
                      {totpSetupData.secret}
                    </code>
                    <button
                      type="button"
                      onClick={() => copySecretToClipboard(totpSetupData.secret)}
                      className="text-xs text-indigo-600 hover:text-indigo-800 p-1 cursor-pointer"
                      title="Copy Secret"
                    >
                      {copiedSecret ? <Check className="w-3.5 h-3.5 text-indigo-600" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <form onSubmit={handleConfirmTotp} className="flex flex-col gap-3 flex-1 w-full max-w-sm">
                  <div>
                    <label className="text-xs font-medium text-slate-700 block mb-1">Enter 6-Digit Code</label>
                    <input
                      type="text"
                      maxLength={6}
                      pattern="[0-9]{6}"
                      placeholder="000000"
                      value={totpCodeInput}
                      onChange={(e) => setTotpCodeInput(e.target.value.replace(/\D/g, ''))}
                      className="w-full px-3 py-2 font-mono text-center tracking-widest text-base font-bold border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      autoFocus
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={totpLoading || totpCodeInput.trim().length !== 6}
                      className="flex-1 px-4 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                    >
                      {totpLoading ? 'Verifying...' : 'Confirm & Activate TOTP'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setTotpSetupData(null)}
                      className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Confirm Disable Prompt */}
          {confirmDisable2Fa && (
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-150">
              <div className="flex items-start gap-2.5">
                <Lock className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-semibold text-slate-900">Are you sure you want to disable 2FA?</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Your account will rely on password authentication only.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 pl-6 sm:pl-0">
                <button
                  type="button"
                  onClick={handleDisable2Fa}
                  disabled={switching2Fa}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
                >
                  {switching2Fa ? 'Disabling...' : 'Yes, Disable 2FA'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDisable2Fa(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ===================================================================== */}
      {/* SECTION 2: RECOVERY EMAIL ADDRESS                                     */}
      {/* ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Recovery Email Address</h2>
            <p className="text-xs text-slate-500 mt-0.5">Used for emergency password reset passcodes and out-of-band recovery.</p>
          </div>
          {settings?.recoveryEmail && !isEditingRecovery && (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-full">
              <Check className="w-3 h-3 text-indigo-600" /> Verified
            </span>
          )}
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Active verified recovery email */}
          {settings?.recoveryEmail && !isEditingRecovery && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600 shrink-0">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="text-xs text-slate-400 block">Current Recovery Address</span>
                  <span className="font-mono text-sm font-medium text-slate-900 truncate block">
                    {settings.recoveryEmail}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 pl-12 sm:pl-0">
                <button
                  type="button"
                  onClick={() => {
                    setRecoveryEmailInput(settings.recoveryEmail || '');
                    setIsEditingRecovery(true);
                    setAwaitingRecoveryOtp(false);
                  }}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-indigo-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Change Email</span>
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveRecovery(true)}
                  aria-label="Remove recovery email"
                  className="p-1.5 text-slate-400 hover:text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                  title="Remove recovery email"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Remove Confirmation */}
          {confirmRemoveRecovery && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in duration-150">
              <div className="flex items-start gap-2">
                <Mail className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-semibold text-slate-900">Remove Recovery Email?</h4>
                  <p className="text-xs text-slate-500 mt-0.5">
                    You will not be able to receive recovery OTPs at this address.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 pl-6 sm:pl-0">
                <button
                  type="button"
                  onClick={handleRemoveRecoveryEmail}
                  disabled={recoveryLoading}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition-colors cursor-pointer"
                >
                  {recoveryLoading ? 'Removing...' : 'Yes, Remove'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveRecovery(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Form to enter new recovery email */}
          {(!settings?.recoveryEmail || isEditingRecovery) && !awaitingRecoveryOtp && (
            <form onSubmit={handleSendRecoveryOtp} className="flex flex-col gap-3 max-w-lg">
              <label className="text-xs font-medium text-slate-700">
                {settings?.recoveryEmail ? 'New Recovery Email Address' : 'Enter Recovery Email Address'}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  placeholder="e.g. backup@gmail.com"
                  value={recoveryEmailInput}
                  onChange={(e) => setRecoveryEmailInput(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  required
                />
                <button
                  type="submit"
                  disabled={recoveryLoading || !recoveryEmailInput.trim()}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer shrink-0"
                >
                  {recoveryLoading ? 'Sending...' : 'Send Verification Code'}
                </button>
                {isEditingRecovery && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingRecovery(false);
                      setRecoveryEmailInput('');
                    }}
                    className="px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg transition-colors cursor-pointer shrink-0"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}

          {/* Form to enter recovery OTP */}
          {awaitingRecoveryOtp && (
            <form onSubmit={handleVerifyRecoveryOtp} className="flex flex-col gap-3 max-w-md p-4 bg-indigo-50/20 border border-indigo-100 rounded-lg animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-700">
                  Enter 6-digit code sent to <strong className="text-indigo-600">{recoveryEmailInput}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => setAwaitingRecoveryOtp(false)}
                  className="text-slate-400 hover:text-slate-600 p-0.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  placeholder="123456"
                  value={recoveryOtpInput}
                  onChange={(e) => setRecoveryOtpInput(e.target.value.replace(/\D/g, ''))}
                  className="w-32 px-3 py-2 font-mono text-center tracking-widest text-sm font-bold border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={recoveryLoading || recoveryOtpInput.trim().length !== 6}
                  className="px-3.5 py-2 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer"
                >
                  {recoveryLoading ? 'Verifying...' : 'Verify & Save Email'}
                </button>
                <button
                  type="button"
                  onClick={() => handleSendRecoveryOtp()}
                  disabled={recoveryLoading}
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium underline px-1 cursor-pointer"
                >
                  Resend Code
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </div>
  );
};
