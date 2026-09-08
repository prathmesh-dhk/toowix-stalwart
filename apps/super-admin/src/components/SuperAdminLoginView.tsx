import React, { useState, useEffect, useRef } from 'react';
import { api, setStoredToken } from '../api';
import { UserContext } from '../types';
import { Button } from './ui/Button';
import { Alert } from './ui/Alert';
import { Mail, ShieldCheck, Eye, EyeOff, Smartphone } from 'lucide-react';
import toowixLogo from '../assets/toowix-logo.svg';

interface SuperAdminLoginViewProps {
  onSuccess: (user: UserContext) => void;
  onSwitchPortal?: () => void;
  onForgotPassword?: (email?: string) => void;
}

export const SuperAdminLoginView: React.FC<SuperAdminLoginViewProps> = ({
  onSuccess,
  onForgotPassword,
}) => {
  const [email, setEmail] = useState(() => {
    return localStorage.getItem('toowix_superadmin_remember_email') || '';
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    return !!localStorage.getItem('toowix_superadmin_remember_email');
  });

  // Step 2: 2FA State
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [hasRecoveryEmail, setHasRecoveryEmail] = useState(false);
  const [maskedRecoveryEmail, setMaskedRecoveryEmail] = useState<string | null>(null);
  const [twoFactorMethod, setTwoFactorMethod] = useState<'totp' | 'email'>('totp');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [emailOtpCooldown, setEmailOtpCooldown] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Email OTP resend timer
  useEffect(() => {
    if (emailOtpCooldown > 0) {
      const timer = setTimeout(() => setEmailOtpCooldown(emailOtpCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [emailOtpCooldown]);

  // Handle 6-digit inputs
  const handleDigitChange = (index: number, val: string) => {
    const char = val.slice(-1);
    const newDigits = [...digits];
    newDigits[index] = char;
    setDigits(newDigits);

    if (char && index < 5) {
      digitRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  };

  const handleDigitPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').trim().replace(/[^0-9]/g, '').slice(0, 6);
    if (!pasted) return;
    const newDigits = [...digits];
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i];
    }
    setDigits(newDigits);
    const nextIndex = Math.min(pasted.length, 5);
    digitRefs.current[nextIndex]?.focus();
  };

  // Step 1: Submit credentials
  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter your email and password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.superAdminLogin(email, password, undefined, rememberMe);

      if (res.requires2FA && res.tempToken) {
        setTempToken(res.tempToken);
        setHasRecoveryEmail(!!res.hasRecoveryEmail);
        setMaskedRecoveryEmail(res.maskedRecoveryEmail || null);
        setTwoFactorMethod('totp');
        setDigits(['', '', '', '', '', '']);
        setEmailOtpSent(false);
      } else if (res.token) {
        if (rememberMe) {
          localStorage.setItem('toowix_superadmin_remember_email', email.trim().toLowerCase());
        } else {
          localStorage.removeItem('toowix_superadmin_remember_email');
        }
        setStoredToken(res.token);
        onSuccess(res.user);
      }
    } catch (err: any) {
      setError(err.message || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Send OTP to recovery email
  const handleSendEmailOtp = async () => {
    if (!tempToken) return;
    setError(null);
    setSendingEmailOtp(true);
    try {
      await api.send2FaLoginOtp(tempToken);
      setEmailOtpSent(true);
      setEmailOtpCooldown(60);
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code.');
    } finally {
      setSendingEmailOtp(false);
    }
  };

  // Step 2: Verify 2FA code
  const handle2FaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken) {
      setError('Session expired. Please sign in again.');
      return;
    }

    const codeToVerify = digits.join('').trim();
    if (!codeToVerify || codeToVerify.length !== 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.verify2Fa(tempToken, codeToVerify, rememberMe, twoFactorMethod);
      if (rememberMe) {
        localStorage.setItem('toowix_superadmin_remember_email', email.trim().toLowerCase());
      } else {
        localStorage.removeItem('toowix_superadmin_remember_email');
      }
      setStoredToken(res.token);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setTempToken(null);
    setDigits(['', '', '', '', '', '']);
    setEmailOtpSent(false);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between py-10 px-4 sm:px-6 lg:px-8 font-sans antialiased text-slate-800">
      {/* Top Brand Bar */}
      <div className="w-full max-w-md mx-auto flex items-center justify-between mb-8">
        <div className="flex items-center gap-2.5">
          <img src={toowixLogo} alt="Toowix" className="w-8 h-8 object-contain" />
          <span className="text-lg font-bold tracking-tight text-slate-900">toowix</span>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-slate-200 text-slate-600 shadow-xs">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          Super Admin
        </span>
      </div>

      {/* Center Auth Card */}
      <div className="w-full max-w-[440px] mx-auto bg-white rounded-xl border border-slate-200 shadow-xs p-8">
        {error && (
          <div className="mb-5">
            <Alert type="error" message={error} onClose={() => setError(null)} />
          </div>
        )}

        {!tempToken ? (
          /* SCREEN 1: Credential Form */
          <div>
            <div className="mb-6 text-center">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Super Admin sign in</h1>
              <p className="text-xs text-slate-500 mt-1">Enter your credentials to access the platform console.</p>
            </div>

            <form onSubmit={handleCredentialsSubmit} className="space-y-4">
              <div>
                <label className="field-label" htmlFor="adminEmail">
                  Email address
                </label>
                <input
                  id="adminEmail"
                  type="email"
                  required
                  placeholder="admin@toowix.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="field-label mb-0" htmlFor="adminPassword">
                    Password
                  </label>
                  {onForgotPassword && (
                    <button
                      type="button"
                      onClick={() => onForgotPassword(email)}
                      className="text-xs text-indigo-600 hover:text-indigo-700 font-medium hover:underline"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="adminPassword"
                    type={showPassword ? 'text' : 'password'}
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="form-input pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex items-center pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20"
                  />
                  <span className="text-xs text-slate-600">Remember this email</span>
                </label>
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  fullWidth
                  loading={loading}
                >
                  Sign in
                </Button>
              </div>
            </form>
          </div>
        ) : (
          /* SCREEN 2: 2FA Verification */
          <div>
            <div className="mb-6 text-center">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mx-auto mb-3 shadow-xs">
                <ShieldCheck size={20} />
              </div>
              <h2 className="text-xl font-bold text-slate-900 tracking-tight">Two-factor authentication</h2>
              <p className="text-xs text-slate-500 mt-1">Select verification method to complete sign-in.</p>
            </div>

            {/* Method selection */}
            <div className="space-y-2.5 mb-5">
              <div
                onClick={() => {
                  setTwoFactorMethod('totp');
                  setDigits(['', '', '', '', '', '']);
                  setError(null);
                }}
                className={`p-3 rounded-lg border text-xs cursor-pointer flex items-start justify-between transition-all ${twoFactorMethod === 'totp'
                    ? 'border-indigo-600 bg-indigo-50/50'
                    : 'border-slate-200 hover:bg-slate-50'
                  }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded bg-indigo-100/70 text-indigo-700 flex items-center justify-center shrink-0 mt-0.5">
                    <Smartphone size={15} />
                  </div>
                  <div>
                    <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                      <span>Authenticator app (TOTP)</span>
                      <span className="text-[10px] bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded font-medium">Recommended</span>
                    </div>
                    <div className="text-slate-500 text-[11px] mt-0.5">Code from your authenticator app</div>
                  </div>
                </div>
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center mt-1 bg-white ${twoFactorMethod === 'totp' ? 'border-indigo-600' : 'border-slate-300'
                  }`}>
                  {twoFactorMethod === 'totp' && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                </div>
              </div>

              {hasRecoveryEmail && (
                <div
                  onClick={() => {
                    setTwoFactorMethod('email');
                    setDigits(['', '', '', '', '', '']);
                    setError(null);
                    if (!emailOtpSent) handleSendEmailOtp();
                  }}
                  className={`p-3 rounded-lg border text-xs cursor-pointer flex items-start justify-between transition-all ${twoFactorMethod === 'email'
                      ? 'border-indigo-600 bg-indigo-50/50'
                      : 'border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-start gap-2.5">
                    <div className="w-7 h-7 rounded bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 mt-0.5">
                      <Mail size={15} />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-900">Email verification code</div>
                      <div className="text-slate-500 text-[11px] mt-0.5">
                        Sent to {maskedRecoveryEmail || 'recovery address'}
                      </div>
                    </div>
                  </div>
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center mt-1 bg-white ${twoFactorMethod === 'email' ? 'border-indigo-600' : 'border-slate-300'
                    }`}>
                    {twoFactorMethod === 'email' && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                  </div>
                </div>
              )}
            </div>

            {/* OTP Digits Form */}
            <form onSubmit={handle2FaSubmit} className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="field-label mb-0">
                    {twoFactorMethod === 'totp' ? '6-digit authenticator code' : '6-digit email code'}
                  </label>
                  {twoFactorMethod === 'email' && (
                    <button
                      type="button"
                      onClick={handleSendEmailOtp}
                      disabled={sendingEmailOtp || emailOtpCooldown > 0}
                      className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50"
                    >
                      {sendingEmailOtp ? 'Sending...' : emailOtpCooldown > 0 ? `Resend (${emailOtpCooldown}s)` : 'Send code'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-6 gap-2" onPaste={handleDigitPaste}>
                  {digits.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => (digitRefs.current[idx] = el)}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleDigitChange(idx, e.target.value)}
                      onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                      className="w-full h-11 text-center text-lg font-bold font-mono text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/15"
                    />
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  fullWidth
                  loading={loading}
                >
                  Verify and sign in
                </Button>
              </div>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={handleBackToLogin}
                  className="text-xs text-slate-500 hover:text-indigo-600 font-medium"
                >
                  ← Back to sign in
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="w-full max-w-md mx-auto text-center mt-8 text-xs text-slate-400">
        <p>© 2026 Toowix Platform. All rights reserved.</p>
      </footer>
    </div>
  );
};
