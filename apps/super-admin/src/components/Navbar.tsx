import React, { useState } from 'react';
import { UserContext } from '../types';
import { Mail, LogOut, ShieldCheck, ShieldAlert, Building2, ExternalLink, X, QrCode, CheckCircle2, Laptop, Copy, Check, Printer, MoreVertical } from 'lucide-react';
import { api } from '../api';
import toowixLogo from '../assets/toowix-logo.svg';
import { ActiveSessionsModal } from './modals/ActiveSessionsModal';

interface NavbarProps {
  user: UserContext;
  onLogout: () => void;
  onUserUpdated?: (user: UserContext) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, onLogout, onUserUpdated }) => {
  const [show2FaModal, setShow2FaModal] = useState(false);
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [setupData, setSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [setupBackupCodes, setSetupBackupCodes] = useState<string[]>([]);
  const [copiedCodes, setCopiedCodes] = useState(false);

  const handleOpen2FaSetup = async () => {
    setShow2FaModal(true);
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      const data = await api.setup2Fa();
      setSetupData(data);
    } catch (err: any) {
      setError(err.message || 'Unable to set up two-factor authentication. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm2Fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpCode || totpCode.length !== 6) {
      setError('Enter a valid 6-digit code.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await api.confirm2Fa(totpCode);
      setSuccess(true);
      if (res.backupCodes && res.backupCodes.length > 0) {
        setSetupBackupCodes(res.backupCodes);
      }
      if (onUserUpdated) {
        onUserUpdated({ ...user, twoFactorEnabled: true });
      }
      if (!res.backupCodes || res.backupCodes.length === 0) {
        setTimeout(() => {
          setShow2FaModal(false);
          setSetupData(null);
          setTotpCode('');
          setSuccess(false);
        }, 1500);
      }
    } catch (err: any) {
      setError(err.message || 'Verification failed. The code is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  const handlePrintBackupCodes = () => {
    if (!setupBackupCodes.length) return;
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
              ${setupBackupCodes.map((code) => `
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

  return (
    <>
      <header className="navbar px-4 sm:px-6 flex items-center justify-between">
        <div className="brand flex items-center gap-2.5">
          <img src={toowixLogo} alt="Toowix" className="w-8 h-8 brand-icon object-contain" />
          <span className="font-semibold text-sm tracking-tight">TOOWIX <span style={{ color: 'var(--primary-light)', fontWeight: 400 }}>MAIL</span></span>
        </div>

        {/* Desktop Navigation Items (>= 768px) */}
        <div className="hidden md:flex items-center gap-4">
          {user.role === 'SUPER_ADMIN' ? (
            <span className="badge badge-platform">
              <ShieldCheck size={14} /> Super Admin
            </span>
          ) : (
            <span className="badge badge-tenant">
              <Building2 size={14} /> Tenant Admin
            </span>
          )}

          {user.twoFactorEnabled ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '3px 8px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 600,
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.3)',
              }}
              title="Two-factor authentication is active"
            >
              <ShieldCheck size={13} /> 2FA enabled
            </span>
          ) : (
            <button
              onClick={handleOpen2FaSetup}
              className="btn btn-sm"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 9px',
                borderRadius: '4px',
                fontSize: '0.75rem',
                fontWeight: 600,
                background: 'rgba(234, 179, 8, 0.12)',
                color: '#facc15',
                border: '1px solid rgba(234, 179, 8, 0.4)',
                cursor: 'pointer',
              }}
              title="Set up two-factor authentication"
            >
              <ShieldAlert size={13} /> Set up 2FA
            </button>
          )}

          <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            {user.email}
          </span>

          <button
            onClick={() => setShowSessionsModal(true)}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Manage logged-in devices and sessions"
          >
            <Laptop size={14} color="var(--primary)" />
            <span>Devices</span>
          </button>

          <a
            href={(import.meta as any).env?.VITE_WEBMAIL_URL || 'http://localhost:8888'}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none', color: 'var(--text-main)' }}
            title="Open Webmail"
          >
            <Mail size={14} color="var(--primary)" />
            <span>Webmail</span>
            <ExternalLink size={12} color="var(--text-dim)" />
          </a>

          <button
            onClick={onLogout}
            className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            title="Log out"
          >
            <LogOut size={14} />
            <span>Log out</span>
          </button>
        </div>

        {/* Mobile Navigation Toggle (< 768px) */}
        <div className="flex md:hidden items-center gap-1 relative">
          <button
            onClick={() => setShowSessionsModal(true)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            title="Devices"
            aria-label="Devices"
          >
            <Laptop size={18} color="var(--primary)" />
          </button>
          <a
            href={(import.meta as any).env?.VITE_WEBMAIL_URL || 'http://localhost:8888'}
            target="_blank"
            rel="noopener noreferrer"
            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            title="Webmail"
            aria-label="Webmail"
          >
            <Mail size={18} color="var(--primary)" />
          </a>
          <button
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
            aria-label="More options"
          >
            {showMobileMenu ? <X size={18} /> : <MoreVertical size={18} />}
          </button>

          {/* Mobile Menu Dropdown */}
          {showMobileMenu && (
            <div className="absolute right-0 top-12 w-56 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-3.5 py-2.5 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-900 truncate">{user.email}</p>
                <p className="text-[11px] text-slate-500 capitalize">{user.role.replace(/_/g, ' ').toLowerCase()}</p>
              </div>

              {!user.twoFactorEnabled && (
                <button
                  onClick={() => {
                    setShowMobileMenu(false);
                    handleOpen2FaSetup();
                  }}
                  className="w-full min-h-[44px] text-left px-3.5 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50 flex items-center gap-2.5 transition-colors cursor-pointer"
                >
                  <ShieldAlert size={16} className="text-amber-500" />
                  <span>Set up 2FA</span>
                </button>
              )}

              <button
                onClick={() => {
                  setShowMobileMenu(false);
                  onLogout();
                }}
                className="w-full min-h-[44px] text-left px-3.5 py-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2.5 transition-colors border-t border-slate-100 cursor-pointer"
              >
                <LogOut size={16} />
                <span>Log out</span>
              </button>
            </div>
          )}
        </div>
      </header>


      {/* Active Devices & Sessions Modal */}
      <ActiveSessionsModal
        isOpen={showSessionsModal}
        onClose={() => setShowSessionsModal(false)}
      />

      {/* 2FA Setup Modal */}
      {show2FaModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/75 backdrop-blur-xs animate-in fade-in duration-150"
          role="dialog"
          aria-modal="true"
        >
          <div className="relative w-full max-w-md bg-zinc-900 text-zinc-100 rounded-2xl shadow-2xl border border-zinc-800 p-5 sm:p-6 flex flex-col gap-4 max-h-[calc(100dvh-24px)] overflow-y-auto">
            <button
              type="button"
              onClick={() => setShow2FaModal(false)}
              className="min-w-[44px] min-h-[44px] p-2 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer flex items-center justify-center absolute top-3 right-3"
              aria-label="Close"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 pr-10">
              <div className="w-10 h-10 rounded-xl bg-blue-500/15 text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/20">
                <QrCode size={20} />
              </div>
              <div>
                <h3 className="text-base font-semibold text-zinc-100">Set up two-factor authentication</h3>
                <p className="text-xs text-zinc-400 mt-0.5">Enhance account security</p>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-500/15 border border-red-500/30 rounded-xl text-xs text-red-400">
                {error}
              </div>
            )}

            {success ? (
              <div className="py-2">
                <CheckCircle2 size={40} className="text-emerald-500 mx-auto mb-2.5 block" />
                <h4 className="text-base font-semibold text-emerald-400 text-center mb-1">Two-factor authentication enabled</h4>
                <p className="text-xs text-zinc-400 text-center mb-4 leading-relaxed">
                  {setupBackupCodes.length > 0
                    ? 'Save your 10 emergency backup codes. A copy has also been sent to your email.'
                    : 'Your account is now protected. You will be prompted for a verification code when signing in.'}
                </p>

                {setupBackupCodes.length > 0 && (
                  <div className="space-y-3">
                    <div className="bg-zinc-950 p-3.5 rounded-xl border border-zinc-800 font-mono text-xs font-semibold tracking-wider text-indigo-300 text-center select-all grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {setupBackupCodes.map((code, idx) => (
                        <div key={idx} className="bg-zinc-900 border border-zinc-800/80 rounded-lg py-1.5 px-2">
                          {code}
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(setupBackupCodes.join('\n'));
                          setCopiedCodes(true);
                          setTimeout(() => setCopiedCodes(false), 2000);
                        }}
                        className="w-full sm:flex-1 min-h-[44px] px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        {copiedCodes ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        <span>{copiedCodes ? 'Copied' : 'Copy all'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handlePrintBackupCodes}
                        className="w-full sm:w-auto min-h-[44px] px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Printer size={14} />
                        <span>Print</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShow2FaModal(false);
                          setSetupData(null);
                          setTotpCode('');
                          setSuccess(false);
                          setSetupBackupCodes([]);
                        }}
                        className="w-full sm:flex-1 min-h-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold inline-flex items-center justify-center transition-colors cursor-pointer shadow-xs"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : loading && !setupData ? (
              <div className="text-center py-10 text-zinc-400 text-xs">
                Setting up authentication...
              </div>
            ) : setupData ? (
              <form onSubmit={handleConfirm2Fa} className="flex flex-col gap-3.5">
                <p className="text-xs text-zinc-300 leading-relaxed">
                  1. Scan this QR code with your authenticator app:
                </p>

                <div className="bg-white p-3 rounded-xl flex items-center justify-center max-w-[200px] w-full mx-auto">
                  <img
                    src={setupData.qrCodeDataUrl}
                    alt="2FA QR Code"
                    className="w-36 h-36 object-contain block"
                  />
                </div>

                <div className="bg-zinc-800/80 px-3 py-2 rounded-xl text-[11px] font-mono text-zinc-300 text-center break-all border border-zinc-700/60">
                  Manual key: <strong className="text-zinc-100 select-all">{setupData.secret}</strong>
                </div>

                <p className="text-xs text-zinc-300 pt-1">
                  2. Enter the 6-digit code from your app:
                </p>

                <input
                  type="text"
                  maxLength={6}
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-2.5 min-h-[48px] text-lg font-mono text-center tracking-[0.35em] bg-zinc-800 border border-zinc-700 rounded-xl text-zinc-100 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-zinc-500 placeholder:tracking-normal"
                />

                <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center gap-2.5 pt-2 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setShow2FaModal(false)}
                    className="w-full sm:flex-1 min-h-[44px] px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-medium transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="w-full sm:flex-1 min-h-[44px] px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shadow-xs"
                    disabled={loading || totpCode.length !== 6}
                  >
                    {loading ? 'Verifying...' : 'Enable 2FA'}
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
};
