import React, { useState } from 'react';
import { UserContext } from '../types';
import { Mail, LogOut, ShieldCheck, ShieldAlert, Building2, ExternalLink, X, QrCode, CheckCircle2 } from 'lucide-react';
import { api } from '../api';

interface NavbarProps {
  user: UserContext;
  onLogout: () => void;
  onUserUpdated?: (user: UserContext) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ user, onLogout, onUserUpdated }) => {
  const [show2FaModal, setShow2FaModal] = useState(false);
  const [setupData, setSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

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
      await api.confirm2Fa(totpCode);
      setSuccess(true);
      if (onUserUpdated) {
        onUserUpdated({ ...user, twoFactorEnabled: true });
      }
      setTimeout(() => {
        setShow2FaModal(false);
        setSetupData(null);
        setTotpCode('');
      }, 1500);
    } catch (err: any) {
      setError(err.message || 'Verification failed. The code is invalid or has expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <header className="navbar">
        <div className="brand">
          <div className="brand-icon">
            <Mail size={20} color="#ffffff" />
          </div>
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
              <div style={{ textAlign: 'center', padding: '24px 0' }}>
                <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 12px' }} />
                <h4 style={{ margin: '0 0 6px', fontSize: '1.1rem', color: '#10b981' }}>Two-factor authentication enabled</h4>
                <p style={{ margin: 0, fontSize: '0.85rem', color: '#a1a1aa' }}>
                  Your account is now protected. You will be prompted for a verification code when signing in.
                </p>
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
