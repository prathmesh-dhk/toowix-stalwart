import React, { useState, useEffect, useRef } from 'react';
import { api, setStoredToken } from '../api';
import { UserContext } from '../types';
import toowixLogo from '../assets/toowix-logo.svg';

interface TenantAdminLoginViewProps {
  onSuccess: (user: UserContext) => void;
  onGoToRegister: () => void;
  onForgotPassword?: (email?: string) => void;
  onSwitchPortal?: () => void;
}

export const TenantAdminLoginView: React.FC<TenantAdminLoginViewProps> = ({
  onSuccess,
  onGoToRegister,
  onForgotPassword,
}) => {
  const [email, setEmail] = useState(() => {
    return localStorage.getItem('toowix_tenant_remember_email') || '';
  });
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => {
    return !!localStorage.getItem('toowix_tenant_remember_email');
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
      const res = await api.tenantAdminLogin(email, password, undefined, rememberMe);

      if (res.requires2FA && res.tempToken) {
        setTempToken(res.tempToken);
        setHasRecoveryEmail(!!res.hasRecoveryEmail);
        setMaskedRecoveryEmail(res.maskedRecoveryEmail || null);
        setTwoFactorMethod('totp');
        setDigits(['', '', '', '', '', '']);
        setEmailOtpSent(false);
      } else if (res.token) {
        if (rememberMe) {
          localStorage.setItem('toowix_tenant_remember_email', email.trim().toLowerCase());
        } else {
          localStorage.removeItem('toowix_tenant_remember_email');
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
      setError(err.message || 'Failed to send verification code. Please try again.');
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
      setError('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.verify2Fa(tempToken, codeToVerify, rememberMe, twoFactorMethod);
      if (rememberMe) {
        localStorage.setItem('toowix_tenant_remember_email', email.trim().toLowerCase());
      } else {
        localStorage.removeItem('toowix_tenant_remember_email');
      }
      setStoredToken(res.token);
      onSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Invalid verification code. Please try again.');
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
    <div className="font-sans antialiased text-slate-800 bg-slate-50 min-h-screen relative overflow-x-hidden flex flex-col justify-between selection:bg-blue-100 selection:text-blue-700">
      {/* Ambient Background Decor */}
      <div aria-hidden="true" className="fixed inset-0 pointer-events-none ambient-bg z-0">
        <div className="absolute bottom-[22%] left-[-15%] w-[130%] h-[320px] fluid-ribbon opacity-80"></div>
        <div className="absolute bottom-[18%] -left-10 w-[110%] h-[180px] bg-gradient-to-r from-cyan-200/40 via-blue-400/35 to-indigo-300/30 blur-3xl opacity-75"></div>
        <div className="absolute top-1/3 left-24 w-3.5 h-3.5 rounded-full bg-blue-300/60 blur-[1px]"></div>
        <div className="absolute bottom-1/3 left-16 w-5 h-5 rounded-full bg-sky-200/50 blur-[2px]"></div>
        <div className="absolute top-2/5 left-[42%] w-2.5 h-2.5 rounded-full bg-indigo-200/70"></div>
      </div>

      {/* Main Header */}
      <header className="relative z-10 w-full px-8 py-6 lg:px-14 flex items-center justify-between" data-purpose="top-navigation">
        <a className="flex items-center gap-2.5 group outline-none cursor-pointer" href="/" title="Toowix Enterprise Cloud">
          <img src={toowixLogo} alt="Toowix" className="w-8 h-8 object-contain group-hover:scale-105 transition-transform duration-200" />
          <span className="text-2xl font-bold tracking-tight text-slate-900 flex items-center">toowix</span>
        </a>

        {/* Security Pill */}
        <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/70 backdrop-blur-md border border-white/60 shadow-sm text-xs font-medium text-slate-600">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Admin Console</span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-500">Secure</span>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-grow flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Left Hero Showcase */}
          <section aria-label="Cloud Assistant & Identity" className="lg:col-span-6 flex flex-col justify-center items-center lg:items-start pl-0 lg:pl-6">
            {/* Conversational Frosted Speech Bubbles */}
            <div className="space-y-2.5 max-w-sm mb-12 select-none" data-purpose="ai-conversation-preview">
              <div className="dialogue-pill rounded-2xl px-4 py-2 text-xs font-normal text-slate-500 w-fit opacity-70 ml-2">
                Mail domain active
              </div>
              <div className="dialogue-pill rounded-2xl px-4 py-2 text-xs font-medium text-slate-600 w-fit opacity-85 ml-1">
                Organization administrator sign in
              </div>
              <div className="dialogue-pill rounded-2xl px-4.5 py-2.5 text-xs sm:text-sm font-semibold text-slate-800 border border-white shadow-md shadow-blue-900/5">
                Two-factor verification enabled
              </div>
            </div>

            {/* Stylized Identity Graphic Badge */}
            <div className="relative flex flex-col items-start select-none" data-purpose="brand-emblem-cluster">
              <div className="absolute -left-7 -top-4 w-3.5 h-3.5 rounded-full bg-blue-400/40"></div>
              <div className="absolute -left-12 top-6 w-2.5 h-2.5 rounded-full bg-sky-400/30"></div>
              <div className="absolute -left-4 bottom-0 w-3 h-3 rounded-full bg-indigo-400/30"></div>

              <span className="text-[11px] font-bold text-slate-400 tracking-[0.4em] uppercase mb-0.5">ADMIN</span>
              <h1 className="text-6xl sm:text-7xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-blue-950 via-slate-900 to-blue-700 leading-none">
                toowix
              </h1>
              <span className="text-xs font-bold text-slate-400/80 letter-spacing-expanded uppercase mt-2.5">
                ADMIN
              </span>
            </div>
          </section>

          {/* Right Auth Card */}
          <section aria-label="Sign In Panel" className="lg:col-span-6 flex justify-center lg:justify-end">
            <div className="frosted-panel rounded-3xl p-8 sm:p-10 w-full max-w-[460px] bg-white/45 backdrop-blur-xl border border-white/70 shadow-xl shadow-slate-900/5 transition-all duration-300" data-purpose="login-modal-card">
              {/* Error Alert */}
              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <svg className="w-4 h-4 text-red-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd"></path>
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              {!tempToken ? (
                /* ==================================================== */
                /* STEP 1: Tenant Admin Login                           */
                /* ==================================================== */
                <>
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight" id="loginHeading">Sign in to your organization</h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1">Enter your administrator credentials to manage your domain.</p>
                  </div>

                  <form className="space-y-4" onSubmit={handleCredentialsSubmit}>
                    {/* Primary Credential Input */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600" htmlFor="tenantCredential">
                        Email
                      </label>
                      <div className="relative">
                        <input
                          className="w-full h-11 px-4 bg-slate-50/90 border border-slate-200/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                          id="tenantCredential"
                          name="credential"
                          placeholder="admin@company.com"
                          required
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Master Password Input */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-600 mb-1.5" htmlFor="tenantPassword">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          className="w-full h-11 px-4 pr-11 bg-slate-50/90 border border-slate-200/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all font-mono"
                          id="tenantPassword"
                          name="password"
                          placeholder="••••••••••••"
                          required
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                          aria-label="Toggle password view"
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-md focus:outline-none"
                          onClick={() => setShowPassword(!showPassword)}
                          type="button"
                        >
                          {showPassword ? (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"></path>
                              <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"></path>
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8"></path>
                            </svg>
                          )}
                        </button>
                      </div>

                      <div className="flex justify-between items-center pt-2">
                        <label className="flex items-center gap-2 cursor-pointer select-none text-[13px] text-slate-600">
                          <input
                            type="checkbox"
                            id="rememberMe"
                            name="remember"
                            checked={rememberMe}
                            onChange={(e) => setRememberMe(e.target.checked)}
                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
                          />
                          <span className="text-xs text-slate-600">Remember me</span>
                        </label>
                        {onForgotPassword && (
                          <button
                            type="button"
                            onClick={() => onForgotPassword(email)}
                            className="text-xs text-blue-600 hover:text-blue-700 hover:underline font-medium"
                          >
                            Forgot password?
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Submit Button */}
                    <div className="pt-2">
                      <button
                        className="btn btn-primary btn-lg w-full"
                        id="submitLoginBtn"
                        type="submit"
                        disabled={loading}
                      >
                        <span>{loading ? 'Signing in...' : 'Sign in'}</span>
                      </button>
                    </div>

                    {/* Register Organization Link */}
                    <div className="text-center pt-3">
                      <p className="text-xs text-slate-500">
                        Need an admin account?{' '}
                        <button
                          type="button"
                          onClick={onGoToRegister}
                          className="text-blue-600 hover:text-blue-700 font-medium hover:underline cursor-pointer"
                        >
                          Register an organization
                        </button>
                      </p>
                    </div>
                  </form>
                </>
              ) : (
                /* ==================================================== */
                /* STEP 2: Two-Factor Verification                      */
                /* ==================================================== */
                <>
                  <div className="mb-6 flex flex-col items-start">
                    <div className="w-11 h-11 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-3.5 shadow-sm">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" strokeLinecap="round" strokeLinejoin="round"></path>
                      </svg>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Two-factor authentication</h2>
                    <p className="text-sm text-slate-500 mt-1">Choose a verification method to complete sign in.</p>
                  </div>

                  {/* 2FA Method Selector */}
                  <div className="space-y-3 mb-5" data-purpose="method-selector">
                    {/* Method 1: TOTP */}
                    <div
                      className={`cursor-pointer p-3.5 rounded-2xl transition-all duration-200 flex items-start gap-3 relative ${twoFactorMethod === 'totp'
                          ? 'border-2 border-blue-600 bg-blue-50/80 shadow-sm'
                          : 'border border-slate-200/80 bg-white/70 hover:bg-white hover:border-slate-300'
                        }`}
                      onClick={() => {
                        setTwoFactorMethod('totp');
                        setDigits(['', '', '', '', '', '']);
                        setError(null);
                      }}
                    >
                      <div className="w-8 h-8 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600 flex-shrink-0 mt-0.5">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" strokeLinecap="round" strokeLinejoin="round"></path>
                        </svg>
                      </div>
                      <div className="flex-grow min-w-0 pr-6">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-bold text-slate-900">Authenticator app</span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700">Recommended</span>
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed">Enter the 6-digit code from your authenticator app.</p>
                      </div>
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center absolute right-3.5 top-4 bg-white ${twoFactorMethod === 'totp' ? 'border-2 border-blue-600' : 'border-slate-300'}`}>
                        {twoFactorMethod === 'totp' && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                      </div>
                    </div>

                    {/* Method 2: Email OTP */}
                    {hasRecoveryEmail && (
                      <div
                        className={`cursor-pointer p-3.5 rounded-2xl transition-all duration-200 flex items-start gap-3 relative ${twoFactorMethod === 'email'
                            ? 'border-2 border-blue-600 bg-blue-50/80 shadow-sm'
                            : 'border border-slate-200/80 bg-white/70 hover:bg-white hover:border-slate-300'
                          }`}
                        onClick={() => {
                          setTwoFactorMethod('email');
                          setDigits(['', '', '', '', '', '']);
                          setError(null);
                          if (!emailOtpSent) {
                            handleSendEmailOtp();
                          }
                        }}
                      >
                        <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0 mt-0.5">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" strokeLinecap="round" strokeLinejoin="round"></path>
                          </svg>
                        </div>
                        <div className="flex-grow min-w-0 pr-6">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-bold text-slate-800">Email verification code</span>
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">
                            Send a temporary 6-digit code to your recovery email ({maskedRecoveryEmail || 'configured recovery'}).
                          </p>
                        </div>
                        <div className={`w-4 h-4 rounded-full border flex items-center justify-center absolute right-3.5 top-4 bg-white ${twoFactorMethod === 'email' ? 'border-2 border-blue-600' : 'border-slate-300'}`}>
                          {twoFactorMethod === 'email' && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 2FA Code Input Form */}
                  <form className="space-y-4" onSubmit={handle2FaSubmit}>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-semibold text-slate-700">
                          {twoFactorMethod === 'totp' ? 'Authenticator code' : 'Email verification code'}
                        </label>
                        {twoFactorMethod !== 'totp' && (
                          <button
                            type="button"
                            onClick={handleSendEmailOtp}
                            disabled={sendingEmailOtp || emailOtpCooldown > 0}
                            className="text-[11px] text-blue-600 font-medium hover:underline disabled:opacity-50"
                          >
                            {sendingEmailOtp ? 'Sending...' : emailOtpCooldown > 0 ? `Resend (${emailOtpCooldown}s)` : 'Resend code'}
                          </button>
                        )}
                      </div>

                      {/* 6-digit individual inputs */}
                      <div className="grid grid-cols-6 gap-2 sm:gap-2.5" onPaste={handleDigitPaste}>
                        {digits.map((digit, idx) => (
                          <input
                            key={idx}
                            ref={(el) => (digitRefs.current[idx] = el)}
                            className="w-full h-12 text-center text-lg font-bold font-mono text-slate-900 bg-slate-50/90 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all"
                            inputMode="numeric"
                            maxLength={1}
                            type="text"
                            value={digit}
                            onChange={(e) => handleDigitChange(idx, e.target.value)}
                            onKeyDown={(e) => handleDigitKeyDown(idx, e)}
                          />
                        ))}
                      </div>

                      <div className="pt-1">
                        <p className="text-xs text-slate-500 flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                          </svg>
                          <span>
                            {twoFactorMethod === 'totp'
                              ? 'Enter the 6-digit code from your authenticator app.'
                              : `Check your recovery email (${maskedRecoveryEmail || 'recovery address'}) for the code.`}
                          </span>
                        </p>
                      </div>
                    </div>

                    {/* Trust Device Checkbox */}
                    <div className="pt-1">
                      <label className="flex items-center gap-2 cursor-pointer select-none text-[13px] text-slate-600">
                        <input
                          checked={rememberMe}
                          onChange={(e) => setRememberMe(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30"
                          type="checkbox"
                        />
                        <span className="text-xs text-slate-600">Remember this device for 30 days</span>
                      </label>
                    </div>

                    {/* Primary CTA Button */}
                    <div className="pt-2">
                      <button
                        className="btn btn-primary btn-lg w-full"
                        id="submit2FABtn"
                        type="submit"
                        disabled={loading}
                      >
                        <span>{loading ? 'Verifying...' : 'Verify and sign in'}</span>
                      </button>
                    </div>

                    {/* Back to sign-in */}
                    <div className="text-center pt-2 space-y-2.5">
                      <div>
                        <button
                          type="button"
                          className="text-xs font-medium text-slate-500 hover:text-blue-600 transition-colors inline-flex items-center gap-1"
                          onClick={handleBackToLogin}
                        >
                          ← Back to sign in
                        </button>
                      </div>
                      <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                        <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path d="M9 12.75L11.25 15 15 9.75M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9 9 4.03 9 9z" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2"></path>
                        </svg>
                        <span>Encrypted connection</span>
                      </div>
                    </div>
                  </form>
                </>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Main Footer */}
      <footer className="relative z-10 w-full py-4 text-center text-xs text-slate-400" data-purpose="copyright-footer">
        <p>© 2026 Toowix. All rights reserved.</p>
      </footer>
    </div>
  );
};
