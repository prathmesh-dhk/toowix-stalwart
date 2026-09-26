import React, { useState, useEffect, useCallback } from 'react';
import {
  Smartphone,
  Mail,
  Lock,
  Check,
  Copy,
  Trash2,
  AlertCircle,
  X,
  ArrowRight,
  ArrowLeft,
  Plus,
  Info,
  Loader2,
  KeyRound,
  Printer,
} from 'lucide-react';
import { api } from '../api';
import { SecuritySettings, UserContext } from '../types';

interface SecuritySettingsViewProps {
  user?: UserContext | null;
  on2FaStatusChange?: (enabled: boolean) => void;
}

export const SecuritySettingsView: React.FC<SecuritySettingsViewProps> = ({ user, on2FaStatusChange }) => {
  const [settings, setSettings] = useState<SecuritySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  useEffect(() => {
    if (settings?.twoFactorEnabled !== undefined) {
      on2FaStatusChange?.(settings.twoFactorEnabled);
    }
  }, [settings?.twoFactorEnabled, on2FaStatusChange]);

  // Authenticator (TOTP) Modal State
  const [isTotpModalOpen, setIsTotpModalOpen] = useState(false);
  const [totpStep, setTotpStep] = useState<1 | 2>(1);
  const [totpSetupData, setTotpSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [totpCodeInput, setTotpCodeInput] = useState('');
  const [totpLoading, setTotpLoading] = useState(false);
  const [totpError, setTotpError] = useState<string | null>(null);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Emergency Backup Codes Modal State
  const [backupCodesModal, setBackupCodesModal] = useState<{ isOpen: boolean; codes: string[]; isRegenerated?: boolean }>({
    isOpen: false,
    codes: [],
  });
  const [copiedBackupCodes, setCopiedBackupCodes] = useState(false);

  // Recovery Email Modal State
  const [isRecoveryModalOpen, setIsRecoveryModalOpen] = useState(false);
  const [recoveryStep, setRecoveryStep] = useState<1 | 2>(1);
  const [recoveryEmailInput, setRecoveryEmailInput] = useState('');
  const [recoveryOtpInput, setRecoveryOtpInput] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  // Confirmation Modals
  const [confirmDisable2Fa, setConfirmDisable2Fa] = useState(false);
  const [confirmRemoveRecovery, setConfirmRemoveRecovery] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch current settings
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

  // Open Authenticator Setup Modal
  const handleOpenTotpModal = async () => {
    setIsTotpModalOpen(true);
    setTotpStep(1);
    setTotpCodeInput('');
    setTotpError(null);
    setTotpLoading(true);
    try {
      const data = await api.setupTotp2Fa();
      setTotpSetupData(data);
    } catch (err: any) {
      setTotpError(err.message || 'Failed to generate authenticator secret. Please try again.');
    } finally {
      setTotpLoading(false);
    }
  };

  const handleCloseTotpModal = () => {
    setIsTotpModalOpen(false);
    setTotpSetupData(null);
    setTotpCodeInput('');
    setTotpError(null);
    setTotpStep(1);
  };

  // Confirm TOTP in Modal (Step 2)
  const handleConfirmTotp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (totpCodeInput.trim().length !== 6) {
      setTotpError('Please enter the complete 6-digit code.');
      return;
    }

    setTotpLoading(true);
    setTotpError(null);
    try {
      const res = await api.confirmTotp2Fa(totpCodeInput.trim());
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              twoFactorEnabled: true,
              twoFactorMethod: 'totp',
              hasTotpConfigured: true,
              remainingBackupCodes: 10,
            }
          : prev
      );
      handleCloseTotpModal();
      if (res.backupCodes && res.backupCodes.length > 0) {
        setBackupCodesModal({ isOpen: true, codes: res.backupCodes });
      } else {
        setFeedback({
          type: 'success',
          message: 'Authenticator App 2FA successfully configured and activated!',
        });
      }
    } catch (err: any) {
      setTotpError(err.message || 'Invalid verification code. Please check and try again.');
    } finally {
      setTotpLoading(false);
    }
  };

  const copySecretToClipboard = (secret: string) => {
    navigator.clipboard.writeText(secret);
    setCopiedSecret(true);
    setTimeout(() => setCopiedSecret(false), 2000);
  };

  // Open Recovery Email Modal - NEVER pre-fill default email; user enters fresh email
  const handleOpenRecoveryModal = () => {
    setRecoveryEmailInput('');
    setRecoveryOtpInput('');
    setRecoveryStep(1);
    setRecoveryError(null);
    setIsRecoveryModalOpen(true);
  };

  const handleCloseRecoveryModal = () => {
    setIsRecoveryModalOpen(false);
    setRecoveryEmailInput('');
    setRecoveryOtpInput('');
    setRecoveryError(null);
    setRecoveryStep(1);
  };

  // Send Recovery Email OTP (Step 1 -> Step 2)
  const handleSendRecoveryOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanEmail = recoveryEmailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.indexOf('.') === -1) {
      setRecoveryError('Please enter a valid email address.');
      return;
    }

    setRecoveryLoading(true);
    setRecoveryError(null);
    try {
      await api.sendRecoveryEmailOtp(cleanEmail);
      setRecoveryStep(2);
    } catch (err: any) {
      setRecoveryError(err.message || 'Failed to send verification code. Please try again.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Verify Recovery Email OTP (Step 2 Submit)
  const handleVerifyRecoveryOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (recoveryOtpInput.trim().length !== 6) {
      setRecoveryError('Please enter the 6-digit verification code.');
      return;
    }

    setRecoveryLoading(true);
    setRecoveryError(null);
    try {
      const res = await api.verifyRecoveryEmailOtp(recoveryOtpInput.trim());
      setSettings((prev) => (prev ? { ...prev, recoveryEmail: res.recoveryEmail } : prev));
      handleCloseRecoveryModal();
      setFeedback({
        type: 'success',
        message: 'Recovery email verified and updated successfully!',
      });
    } catch (err: any) {
      setRecoveryError(err.message || 'Invalid or expired verification code.');
    } finally {
      setRecoveryLoading(false);
    }
  };

  // Remove Recovery Email
  const handleRemoveRecoveryEmail = async () => {
    setActionLoading(true);
    setFeedback(null);
    try {
      await api.removeRecoveryEmail();
      setSettings((prev) => (prev ? { ...prev, recoveryEmail: null } : prev));
      setConfirmRemoveRecovery(false);
      setFeedback({ type: 'success', message: 'Recovery email removed.' });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to remove recovery email.' });
    } finally {
      setActionLoading(false);
    }
  };

  // Switch to Email 2FA
  const handleSwitchToEmail2Fa = async () => {
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await api.update2FaMode('email');
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              twoFactorEnabled: res.twoFactorEnabled,
              twoFactorMethod: res.twoFactorMethod,
              remainingBackupCodes: res.remainingBackupCodes ?? prev.remainingBackupCodes,
            }
          : prev
      );
      if (res.backupCodes && res.backupCodes.length > 0) {
        setBackupCodesModal({ isOpen: true, codes: res.backupCodes });
      } else {
        setFeedback({
          type: 'success',
          message: `Two-Factor Authentication updated to Email OTP. Codes will be sent to ${settings?.email || user?.email}.`,
        });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to switch to Email 2FA.' });
    } finally {
      setActionLoading(false);
    }
  };

  // Regenerate Backup Codes
  const handleRegenerateBackupCodes = async () => {
    setActionLoading(true);
    setFeedback(null);
    try {
      const res = await api.regenerateBackupCodes();
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              remainingBackupCodes: res.remainingBackupCodes,
            }
          : prev
      );
      setBackupCodesModal({ isOpen: true, codes: res.backupCodes, isRegenerated: true });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to regenerate backup codes.' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopyAllBackupCodes = () => {
    if (!backupCodesModal.codes.length) return;
    navigator.clipboard.writeText(backupCodesModal.codes.join('\n'));
    setCopiedBackupCodes(true);
    setTimeout(() => setCopiedBackupCodes(false), 2000);
  };

  const handlePrintBackupCodes = () => {
    if (!backupCodesModal.codes.length) return;
    try {
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        window.print();
        return;
      }
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Toowix Mail - Emergency Backup Codes</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                padding: 40px;
                color: #0f172a;
                max-width: 480px;
                margin: 0 auto;
              }
              .header {
                border-bottom: 2px solid #e2e8f0;
                padding-bottom: 16px;
                margin-bottom: 20px;
              }
              h1 {
                font-size: 20px;
                margin: 0 0 6px 0;
                color: #0f172a;
              }
              p {
                font-size: 13px;
                color: #64748b;
                margin: 0;
                line-height: 1.5;
              }
              .alert {
                background: #fffbeb;
                border: 1px solid #fde68a;
                padding: 10px 14px;
                border-radius: 8px;
                font-size: 12px;
                color: #92400e;
                margin: 16px 0 20px 0;
              }
              .codes-block {
                background: #f8fafc;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                padding: 18px 24px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 15px;
                line-height: 1.9;
                text-align: center;
                font-weight: 700;
                letter-spacing: 1.5px;
              }
              .code-row {
                padding: 1px 0;
              }
              .footer {
                margin-top: 24px;
                font-size: 11px;
                color: #94a3b8;
                text-align: center;
                border-top: 1px solid #f1f5f9;
                padding-top: 12px;
              }
            </style>
        </head>
        <body>
          <div class="header">
            <h1>Toowix Mail - Emergency Backup Codes</h1>
            <p>Keep these 10 single-use codes in a safe place. Each code can only be used once to bypass two-factor authentication.</p>
          </div>
          <div class="alert">
            Important: Each code can only be used once. If you regenerate new codes, all previous codes will stop working.
          </div>
          <div class="codes-block">
            ${backupCodesModal.codes.map((code) => `
              <div class="code-row">${code}</div>
            `).join('')}
          </div>
            <div class="footer">
              Generated on ${new Date().toLocaleDateString()} &bull; Toowix Account Security
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    } catch {
      window.print();
    }
  };

  // Disable 2FA
  const handleDisable2Fa = async () => {
    setActionLoading(true);
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
      setFeedback({
        type: 'info',
        message: 'Two-Factor Authentication has been disabled. You can re-enable it at any time.',
      });
    } catch (err: any) {
      setFeedback({ type: 'error', message: err.message || 'Failed to disable 2FA.' });
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
      </div>
    );
  }

  const accountEmail = settings?.email || user?.email || 'admin@organization.com';
  const current2FaMethod = settings?.twoFactorEnabled ? settings.twoFactorMethod || 'totp' : 'disabled';
  const isEmailOtpActive = current2FaMethod === 'email';

  // Do not treat default primary email as a recovery email
  const hasValidRecoveryEmail = Boolean(
    settings?.recoveryEmail &&
    settings.recoveryEmail.trim() !== '' &&
    settings.recoveryEmail.toLowerCase() !== accountEmail.toLowerCase()
  );

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Page Header */}
      <div className="pb-1">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Account Security</h1>
        <p className="text-sm text-slate-500 mt-1">
          Manage two-factor authentication methods and backup recovery email.
        </p>
      </div>

      {/* Global Toast Feedback */}
      {feedback && (
        <div className="flex items-center justify-between px-4 py-3 bg-indigo-50 border border-indigo-200/80 rounded-xl text-xs text-indigo-900 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <Info className="w-4 h-4 text-indigo-600 shrink-0" />
            <span className="font-medium truncate">{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-indigo-400 hover:text-indigo-700 p-1 rounded-lg transition-colors cursor-pointer shrink-0 ml-2"
            aria-label="Close notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SECTION 1: TWO-FACTOR AUTHENTICATION (2FA) METHODS                    */}
      {/* ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 shadow-xs flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Two-Factor Authentication (2FA) Methods
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Select and configure your primary two-factor verification method.
            </p>
          </div>
          <div className="flex items-center gap-1.5 self-start sm:self-auto">
            <span className="text-xs text-slate-400 font-medium">Status:</span>
            {current2FaMethod !== 'disabled' ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Enforced
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                Disabled
              </span>
            )}
          </div>
        </div>

        {/* 3 Horizontal Stacked Rows */}
        <div className="flex flex-col gap-3.5">
          {/* Method 1: Authenticator App (TOTP) */}
          <div className="p-4 sm:p-5 rounded-xl border border-slate-200/90 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all">
            <div className="flex items-start sm:items-center gap-4 min-w-0">
              {/* Consistent Icon Style */}
              <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <Smartphone className="w-5 h-5" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-900">Authenticator App (TOTP)</h3>
                  {current2FaMethod === 'totp' ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Active
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/60 px-2 py-0.5 rounded-full">
                      Recommended
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Generate secure 6-digit verification codes using Google Authenticator, 1Password, or Authy.
                </p>
              </div>
            </div>

            <div className="shrink-0 w-full sm:w-auto sm:self-center">
              <button
                type="button"
                onClick={handleOpenTotpModal}
                disabled={actionLoading}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg transition-colors cursor-pointer shadow-xs whitespace-nowrap flex items-center justify-center"
              >
                {current2FaMethod === 'totp' ? 'Reconfigure App' : 'Set up Authenticator'}
              </button>
            </div>
          </div>

          {/* Method 2: Email Verification OTP (With On/Off Toggle Switch) */}
          <div className="p-4 sm:p-5 rounded-xl border border-slate-200/90 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all">
            <div className="flex items-start sm:items-center gap-4 min-w-0">
              {/* Consistent Icon Style */}
              <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <Mail className="w-5 h-5" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-900">Email Verification OTP</h3>
                  {isEmailOtpActive && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Verification codes are delivered directly to your administrative mailbox:
                </p>
                <div className="mt-1.5">
                  <span className="inline-block px-3 py-1 bg-slate-50 border border-slate-200 rounded-md font-mono text-xs text-slate-800 font-semibold break-all">
                    {accountEmail}
                  </span>
                </div>
              </div>
            </div>

            {/* Toggle Switch */}
            <div className="shrink-0 w-full sm:w-auto sm:self-center flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={isEmailOtpActive}
                aria-label={isEmailOtpActive ? 'Email 2FA Active' : 'Switch to Email 2FA'}
                onClick={() => {
                  if (isEmailOtpActive) {
                    setConfirmDisable2Fa(true);
                  } else {
                    handleSwitchToEmail2Fa();
                  }
                }}
                disabled={actionLoading}
                className="w-full sm:w-auto min-h-[44px] flex items-center justify-between sm:justify-start gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition-colors cursor-pointer text-xs font-medium text-slate-700 shadow-2xs"
              >
                <span>{isEmailOtpActive ? 'Email 2FA Active' : 'Switch to Email 2FA'}</span>
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                    isEmailOtpActive ? 'bg-indigo-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      isEmailOtpActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </span>
              </button>
            </div>
          </div>

          {/* Method 3: Password Only */}
          <div className="p-4 sm:p-5 rounded-xl border border-slate-200/90 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all">
            <div className="flex items-start sm:items-center gap-4 min-w-0">
              {/* Consistent Icon Style */}
              <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-900">Password Only</h3>
                  {current2FaMethod === 'disabled' && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200/60">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
                      Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Sign in using your account password without a secondary verification prompt.
                </p>
              </div>
            </div>

            <div className="shrink-0 w-full sm:w-auto sm:self-center">
              {current2FaMethod === 'disabled' ? (
                <span className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs text-slate-400 font-medium inline-flex items-center justify-center bg-slate-50 rounded-lg border border-slate-200 whitespace-nowrap">
                  Standard protection
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDisable2Fa(true)}
                  disabled={actionLoading}
                  className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-medium text-slate-700 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 bg-white border border-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shadow-2xs flex items-center justify-center"
                >
                  Disable 2FA
                </button>
              )}
            </div>
          </div>

          {/* Emergency Backup Codes Row (Visible when 2FA is active) */}
          {settings?.twoFactorEnabled && (
            <div className="p-4 sm:p-5 rounded-xl border border-slate-200/90 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all">
              <div className="flex items-start sm:items-center gap-4 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-bold text-slate-900">Emergency Backup Codes</h3>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                      {settings.remainingBackupCodes !== undefined ? `${settings.remainingBackupCodes} of 10 remaining` : 'Active'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Single-use 8-character codes to bypass 2FA if you lose access to your primary device.
                  </p>
                </div>
              </div>

              <div className="shrink-0 w-full sm:w-auto sm:self-center">
                <button
                  type="button"
                  onClick={handleRegenerateBackupCodes}
                  disabled={actionLoading}
                  className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-semibold text-slate-700 hover:text-indigo-600 hover:bg-indigo-50 bg-white border border-slate-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap shadow-2xs flex items-center justify-center"
                >
                  Regenerate codes
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ===================================================================== */}
      {/* SECTION 2: RECOVERY EMAIL ADDRESS                                     */}
      {/* ===================================================================== */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-7 shadow-xs flex flex-col gap-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Recovery Email Address
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Designated out-of-band mailbox for password resets and security notices.
            </p>
          </div>
          <div>
            {hasValidRecoveryEmail ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Verified
              </span>
            ) : (
              <span className="text-xs text-slate-400 font-normal">Not configured</span>
            )}
          </div>
        </div>

        {hasValidRecoveryEmail ? (
          <div className="p-4 sm:p-5 rounded-xl border border-slate-200/90 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all">
            <div className="flex items-start sm:items-center gap-4 min-w-0">
              {/* Consistent Icon Style */}
              <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                <Mail className="w-5 h-5" />
              </div>
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-xs text-slate-400 font-medium">Backup Email</span>
                <span className="font-mono text-sm font-bold text-slate-900 truncate">
                  {settings?.recoveryEmail}
                </span>
                <span className="text-xs text-slate-500 mt-0.5">
                  Used for recovery if primary domain MX routing is unavailable.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto sm:self-center">
              <button
                type="button"
                onClick={handleOpenRecoveryModal}
                className="flex-1 sm:flex-initial min-h-[44px] px-3.5 py-2 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs whitespace-nowrap flex items-center justify-center"
              >
                Change email
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemoveRecovery(true)}
                aria-label="Remove recovery email"
                title="Remove recovery email"
                className="min-w-[44px] min-h-[44px] p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg transition-colors cursor-pointer shadow-2xs flex items-center justify-center"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-xl border border-dashed border-slate-200 bg-slate-50/50">
            <div className="flex items-start gap-3.5 min-w-0">
              {/* Consistent Icon Style */}
              <div className="w-11 h-11 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0 mt-0.5">
                <Mail className="w-5 h-5" />
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-sm font-semibold text-slate-900">No recovery email configured</span>
                <p className="text-xs text-slate-500 leading-relaxed max-w-xl">
                  Add an emergency email address to recover your account if you lose access to your primary email or 2FA authenticator.
                </p>
              </div>
            </div>

            <div className="shrink-0 w-full sm:w-auto sm:self-center">
              <button
                type="button"
                onClick={handleOpenRecoveryModal}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg transition-colors cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Recovery Email</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* POPUP MODAL: AUTHENTICATOR APP SETUP (2-STEP)                         */}
      {/* ===================================================================== */}
      {isTotpModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={handleCloseTotpModal}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200/80 shadow-xl w-full max-w-md p-6 flex flex-col gap-5 animate-in zoom-in-95 duration-150 modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100/80 flex items-center justify-center text-indigo-600 shadow-xs shrink-0">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">
                      {totpStep === 1 ? 'Scan QR Code' : 'Verify Code'}
                    </h3>
                    <span className="text-[10px] font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200/60">
                      Step {totpStep} of 2
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {totpStep === 1
                      ? 'Scan with your authenticator app to link your account.'
                      : 'Enter the 6-digit code shown in your app to activate.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseTotpModal}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Error Banner */}
            {totpError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{totpError}</span>
              </div>
            )}

            {/* STEP 1: SCAN QR CODE & SECRET */}
            {totpStep === 1 && (
              <div className="flex flex-col items-center gap-4">
                {totpLoading || !totpSetupData ? (
                  <div className="h-44 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                  </div>
                ) : (
                  <>
                    <div className="p-3.5 bg-white border border-slate-200 rounded-2xl shadow-2xs">
                      <img
                        src={totpSetupData.qrCodeDataUrl}
                        alt="TOTP QR Code"
                        className="w-40 h-40 object-contain block"
                      />
                    </div>

                    <div className="w-full flex flex-col gap-1.5 text-center">
                      <span className="text-xs text-slate-500">Or enter secret key manually:</span>
                      <div className="flex items-center justify-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                        <code className="font-mono text-xs text-slate-800 tracking-wider font-semibold select-all break-all">
                          {totpSetupData.secret}
                        </code>
                        <button
                          type="button"
                          onClick={() => copySecretToClipboard(totpSetupData.secret)}
                          className="min-h-[40px] px-2 text-xs text-indigo-600 hover:text-indigo-800 cursor-pointer flex items-center gap-1 font-medium"
                          title="Copy Secret"
                        >
                          {copiedSecret ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                              <span className="text-[11px] text-emerald-600">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span className="text-[11px]">Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </>
                )}

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 w-full pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleCloseTotpModal}
                    className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl transition-colors cursor-pointer flex items-center justify-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTotpError(null);
                      setTotpStep(2);
                    }}
                    disabled={totpLoading || !totpSetupData}
                    className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 rounded-xl transition-colors cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <span>Next: Enter Code</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: VERIFY 6-DIGIT CODE */}
            {totpStep === 2 && (
              <form onSubmit={handleConfirmTotp} className="flex flex-col gap-4">
                <div className="flex flex-col items-center gap-3 py-2">
                  <label className="text-xs font-medium text-slate-700 text-center">
                    Enter the 6-digit verification code from your authenticator app
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    placeholder="000000"
                    value={totpCodeInput}
                    onChange={(e) => setTotpCodeInput(e.target.value.replace(/\D/g, ''))}
                    className="w-full sm:w-48 px-4 py-2.5 font-mono text-center tracking-[0.35em] text-xl font-bold border border-slate-200 rounded-xl bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all shadow-2xs min-h-[48px]"
                    autoFocus
                  />
                  <span className="text-[11px] text-slate-400 text-center">
                    Codes refresh every 30 seconds
                  </span>
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between w-full pt-2 border-t border-slate-100 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setTotpError(null);
                      setTotpStep(1);
                    }}
                    className="w-full sm:w-auto min-h-[44px] px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back</span>
                  </button>
                  <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCloseTotpModal}
                      className="w-full sm:w-auto min-h-[44px] px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl transition-colors cursor-pointer flex items-center justify-center"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={totpLoading || totpCodeInput.trim().length !== 6}
                      className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 rounded-xl transition-colors cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
                    >
                      {totpLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Verifying...</span>
                        </>
                      ) : (
                        <span>Verify & Activate</span>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* POPUP MODAL: RECOVERY EMAIL SETUP (2-STEP: Enter Email -> Enter OTP) */}
      {/* ===================================================================== */}
      {isRecoveryModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={handleCloseRecoveryModal}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200/80 shadow-xl w-full max-w-md p-6 flex flex-col gap-5 animate-in zoom-in-95 duration-150 modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100/80 flex items-center justify-center text-indigo-600 shadow-xs shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">
                      {recoveryStep === 1
                        ? settings?.recoveryEmail
                          ? 'Change Recovery Email'
                          : 'Add Recovery Email'
                        : 'Verify Email'}
                    </h3>
                    <span className="text-[10px] font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full border border-indigo-200/60">
                      Step {recoveryStep} of 2
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {recoveryStep === 1
                      ? 'Enter an external email address for account recovery.'
                      : `Enter the code sent to ${recoveryEmailInput}.`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseRecoveryModal}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Error Banner */}
            {recoveryError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span>{recoveryError}</span>
              </div>
            )}

            {/* STEP 1: ENTER EMAIL */}
            {recoveryStep === 1 && (
              <form onSubmit={handleSendRecoveryOtp} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Emergency Recovery Email
                  </label>
                  <input
                    type="email"
                    placeholder="e.g. backup@gmail.com"
                    value={recoveryEmailInput}
                    onChange={(e) => setRecoveryEmailInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-base sm:text-xs border border-slate-200 rounded-xl bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all min-h-[44px] sm:min-h-0"
                    required
                    autoFocus
                  />
                  <span className="text-[11px] text-slate-400">
                    A 6-digit confirmation OTP will be sent to verify ownership.
                  </span>
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleCloseRecoveryModal}
                    className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl transition-colors cursor-pointer flex items-center justify-center"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={recoveryLoading || !recoveryEmailInput.trim()}
                    className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 rounded-xl transition-colors cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
                  >
                    {recoveryLoading ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <span>Continue</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2: VERIFY OTP */}
            {recoveryStep === 2 && (
              <form onSubmit={handleVerifyRecoveryOtp} className="flex flex-col gap-4">
                <div className="flex flex-col items-center gap-3 py-2">
                  <label className="text-xs font-medium text-slate-700 text-center">
                    Enter the 6-digit code sent to <strong className="text-indigo-600">{recoveryEmailInput}</strong>
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    pattern="[0-9]{6}"
                    placeholder="123456"
                    value={recoveryOtpInput}
                    onChange={(e) => setRecoveryOtpInput(e.target.value.replace(/\D/g, ''))}
                    className="w-full sm:w-48 px-4 py-2.5 font-mono text-center tracking-[0.35em] text-xl font-bold border border-slate-200 rounded-xl bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all shadow-2xs min-h-[48px]"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => handleSendRecoveryOtp()}
                    disabled={recoveryLoading}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-medium underline cursor-pointer min-h-[44px] flex items-center"
                  >
                    Didn't receive code? Resend
                  </button>
                </div>

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between w-full pt-2 border-t border-slate-100 gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      setRecoveryError(null);
                      setRecoveryStep(1);
                    }}
                    className="w-full sm:w-auto min-h-[44px] px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-1"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Back</span>
                  </button>
                  <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5">
                    <button
                      type="button"
                      onClick={handleCloseRecoveryModal}
                      className="w-full sm:w-auto min-h-[44px] px-3.5 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl transition-colors cursor-pointer flex items-center justify-center"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={recoveryLoading || recoveryOtpInput.trim().length !== 6}
                      className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 rounded-xl transition-colors cursor-pointer shadow-xs flex items-center justify-center gap-1.5"
                    >
                      {recoveryLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Verifying...</span>
                        </>
                      ) : (
                        <span>Verify & Save</span>
                      )}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* POPUP MODAL: CONFIRM DISABLE 2FA                                      */}
      {/* ===================================================================== */}
      {confirmDisable2Fa && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setConfirmDisable2Fa(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200/80 shadow-xl w-full max-w-sm p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150 modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 shrink-0">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">Disable 2FA?</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  Your administrative account will rely on password authentication only without a secondary verification step.
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmDisable2Fa(false)}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl transition-colors cursor-pointer flex items-center justify-center"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDisable2Fa}
                disabled={actionLoading}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer flex items-center justify-center"
              >
                {actionLoading ? 'Disabling...' : 'Yes, Disable 2FA'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* POPUP MODAL: CONFIRM REMOVE RECOVERY EMAIL                            */}
      {/* ===================================================================== */}
      {confirmRemoveRecovery && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={() => setConfirmRemoveRecovery(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200/80 shadow-xl w-full max-w-sm p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150 modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-center text-rose-600 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900">Remove Recovery Email?</h3>
                <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                  You will no longer be able to receive emergency account recovery or password reset codes at this address.
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setConfirmRemoveRecovery(false)}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-xl transition-colors cursor-pointer flex items-center justify-center"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRemoveRecoveryEmail}
                disabled={actionLoading}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors cursor-pointer flex items-center justify-center"
              >
                {actionLoading ? 'Removing...' : 'Yes, Remove'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* POPUP MODAL: EMERGENCY BACKUP CODES                                   */}
      {/* ===================================================================== */}
      {backupCodesModal.isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xl max-w-md w-full p-6 flex flex-col gap-4 animate-in zoom-in-95 duration-150 modal-card">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Backup Codes
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Save these 10 single-use codes in a secure location.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBackupCodesModal({ isOpen: false, codes: [] })}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-900 leading-relaxed">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <span>Each code can only be used once. If you ever lose access to your primary 2FA method, click <strong>"Use backup code"</strong> at login. A copy has also been sent to your email.</span>
                </div>
              </div>
            </div>

            {/* Single clean block of codes with no lines and no numbers */}
            <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-3 sm:p-4 font-mono text-xs sm:text-sm font-semibold tracking-wider sm:tracking-widest text-slate-900 text-center select-all grid grid-cols-1 sm:grid-cols-2 gap-2">
              {backupCodesModal.codes.map((code, idx) => (
                <div key={idx} className="bg-white border border-slate-200/80 rounded-lg py-2 px-3 shadow-2xs">
                  {code}
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1 border-t border-slate-100">
              <button
                type="button"
                onClick={handleCopyAllBackupCodes}
                className="w-full sm:flex-1 min-h-[44px] flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer shadow-2xs"
              >
                {copiedBackupCodes ? (
                  <>
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span className="text-emerald-700">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4 text-slate-500" />
                    <span>Copy all codes</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={handlePrintBackupCodes}
                className="w-full sm:w-auto min-h-[44px] flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors cursor-pointer shadow-2xs"
              >
                <Printer className="w-4 h-4 text-slate-500" />
                <span>Print</span>
              </button>
              <button
                type="button"
                onClick={() => setBackupCodesModal({ isOpen: false, codes: [] })}
                className="w-full sm:flex-1 min-h-[44px] px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-xs font-semibold text-white transition-colors cursor-pointer shadow-xs flex items-center justify-center text-center"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
