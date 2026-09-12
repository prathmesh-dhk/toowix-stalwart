import React, { useState } from 'react';
import { UserContext } from '../types';
import { Mail, LogOut, ShieldCheck, ShieldAlert, Building2, ExternalLink, X, QrCode, CheckCircle2, Laptop, Copy, Check, Printer } from 'lucide-react';
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
      <header className="navbar">
        <div className="brand">
          <img src={toowixLogo} alt="Toowix" className="w-8 h-8 brand-icon object-contain" />
          <span>TOOWIX <span style={{ color: 'var(--primary-light)', fontWeight: 400 }}>MAIL</span></span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
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
            href="http://localhost:8888"
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
      </header>

      {/* Active Devices & Sessions Modal */}
      <ActiveSessionsModal
        isOpen={showSessionsModal}
        onClose={() => setShowSessionsModal(false)}
      />

      {/* 2FA Setup Modal */}
      {show2FaModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            padding: '20px',
          }}
        >
          <div
            style={{
              background: '#18181b',
              border: '1px solid #27272a',
              borderRadius: '12px',
              maxWidth: '440px',
              width: '100%',
              padding: '24px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
              position: 'relative',
              color: '#fafafa',
            }}
          >
            <button
              onClick={() => setShow2FaModal(false)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'transparent',
                border: 'none',
                color: '#a1a1aa',
                cursor: 'pointer',
              }}
            >
              <X size={20} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '8px',
                  background: 'rgba(59, 130, 246, 0.15)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#3b82f6',
                }}
              >
                <QrCode size={20} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Set up two-factor authentication</h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#a1a1aa' }}>Enhance account security</p>
              </div>
            </div>

            {error && (
              <div
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  borderRadius: '6px',
                  padding: '10px 12px',
                  fontSize: '0.85rem',
                  marginBottom: '16px',
                }}
              >
                {error}
              </div>
            )}

            {success ? (
              <div style={{ padding: '16px 0' }}>
                <CheckCircle2 size={40} color="#10b981" style={{ margin: '0 auto 10px', display: 'block' }} />
                <h4 style={{ margin: '0 0 6px', fontSize: '1.05rem', color: '#10b981', textAlign: 'center' }}>Two-factor authentication enabled</h4>
                <p style={{ margin: '0 0 16px', fontSize: '0.825rem', color: '#a1a1aa', textAlign: 'center' }}>
                  {setupBackupCodes.length > 0
                    ? 'Save your 10 emergency backup codes. A copy has also been sent to your email.'
                    : 'Your account is now protected. You will be prompted for a verification code when signing in.'}
                </p>

                {setupBackupCodes.length > 0 && (
                  <div style={{ marginBottom: '16px' }}>
                    <div
                      style={{
                        background: '#18181b',
                        padding: '16px',
                        borderRadius: '8px',
                        border: '1px solid #27272a',
                        fontFamily: 'monospace',
                        fontSize: '0.9rem',
                        fontWeight: 600,
                        letterSpacing: '0.1em',
                        textAlign: 'center',
                        color: '#a5b4fc',
                        userSelect: 'all',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      {setupBackupCodes.map((code, idx) => (
                        <div key={idx}>
                          {code}
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(setupBackupCodes.join('\n'));
                          setCopiedCodes(true);
                          setTimeout(() => setCopiedCodes(false), 2000);
                        }}
                        className="btn btn-secondary"
                        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
                      >
                        {copiedCodes ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
                        <span>{copiedCodes ? 'Copied' : 'Copy all'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={handlePrintBackupCodes}
                        className="btn btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '0 14px' }}
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
                        className="btn btn-primary"
                        style={{ flex: 1 }}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : loading && !setupData ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#a1a1aa' }}>
                Setting up authentication...
              </div>
            ) : setupData ? (
              <form onSubmit={handleConfirm2Fa}>
                <p style={{ fontSize: '0.875rem', color: '#d4d4d8', marginBottom: '14px', lineHeight: 1.4 }}>
                  1. Scan this QR code with your authenticator app:
                </p>

                <div
                  style={{
                    background: '#ffffff',
                    padding: '12px',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '14px',
                  }}
                >
                  <img
                    src={setupData.qrCodeDataUrl}
                    alt="2FA QR Code"
                    style={{ width: '180px', height: '180px', display: 'block' }}
                  />
                </div>

                <div
                  style={{
                    background: '#27272a',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontFamily: 'monospace',
                    color: '#e4e4e7',
                    textAlign: 'center',
                    marginBottom: '16px',
                    wordBreak: 'break-all',
                  }}
                >
                  Manual key: <strong>{setupData.secret}</strong>
                </div>

                <p style={{ fontSize: '0.875rem', color: '#d4d4d8', marginBottom: '8px' }}>
                  2. Enter the 6-digit code from your app:
                </p>

                <input
                  type="text"
                  maxLength={6}
                  placeholder="123456"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    fontSize: '1.1rem',
                    letterSpacing: '3px',
                    textAlign: 'center',
                    fontFamily: 'monospace',
                    borderRadius: '6px',
                    background: '#27272a',
                    border: '1px solid #3f3f46',
                    color: '#fafafa',
                    marginBottom: '16px',
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />

                <div style={{ display: 'flex', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setShow2FaModal(false)}
                    className="btn btn-secondary"
                    style={{ flex: 1 }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={loading || totpCode.length !== 6}
                    style={{ flex: 1 }}
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
