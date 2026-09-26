import React, { useState, useEffect, useRef } from 'react';
import { api, setStoredToken } from '../api';
import { UserContext } from '../types';
import { maskEmailPreview } from './ForgotPasswordView';
import toowixLogo from '../assets/toowix-logo.svg';
import {
  AlertCircle,
  Eye,
  EyeOff,
  ShieldCheck,
  Smartphone,
  Mail,
  Clock,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  KeyRound,
} from 'lucide-react';

interface SuperAdminLoginViewProps {
  onSuccess: (user: UserContext) => void;
  onSwitchPortal?: () => void;
  onForgotPassword?: (email?: string) => void;
}

export const SuperAdminLoginView: React.FC<SuperAdminLoginViewProps> = ({
  onSuccess,
  onSwitchPortal,
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
  const [twoFactorStep, setTwoFactorStep] = useState<'select' | 'verify' | 'backup_code'>('select');
  const [hasRecoveryEmail, setHasRecoveryEmail] = useState(false);
  const [hasEmail2Fa, setHasEmail2Fa] = useState(false);
  const [, setHasBackupCodes] = useState(false);
  const [backupCodeInput, setBackupCodeInput] = useState('');
  const [maskedRecoveryEmail, setMaskedRecoveryEmail] = useState<string | null>(null);
  const [maskedEmail, setMaskedEmail] = useState<string | null>(null);
  const [isRecoveryEmail, setIsRecoveryEmail] = useState(false);
  const [twoFactorMethod, setTwoFactorMethod] = useState<'totp' | 'email'>('totp');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [emailOtpSent, setEmailOtpSent] = useState(false);
  const [sendingEmailOtp, setSendingEmailOtp] = useState(false);
  const [emailOtpCooldown, setEmailOtpCooldown] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleLoginSuccess = (loggedInUser: UserContext) => {
    try {
      sessionStorage.removeItem('toowix_dismissed_2fa_banner');
    } catch {
      // ignore
    }
    onSuccess(loggedInUser);
  };

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
        setTwoFactorStep('select');
        setHasRecoveryEmail(!!res.hasRecoveryEmail);
        setHasEmail2Fa(res.hasEmail2Fa ?? true);
        setHasBackupCodes(res.hasBackupCodes ?? false);
        setBackupCodeInput('');
        setMaskedRecoveryEmail(res.maskedRecoveryEmail || null);
        setMaskedEmail(res.maskedEmail || res.maskedRecoveryEmail || (email ? maskEmailPreview(email) : null));
        setIsRecoveryEmail(!!res.isRecoveryEmail);
        setTwoFactorMethod(res.defaultMethod === 'email' ? 'email' : 'totp');
        setDigits(['', '', '', '', '', '']);
        setEmailOtpSent(false);
      } else if (res.token) {
        if (rememberMe) {
          localStorage.setItem('toowix_superadmin_remember_email', email.trim().toLowerCase());
        } else {
          localStorage.removeItem('toowix_superadmin_remember_email');
        }
        setStoredToken(res.token);
        handleLoginSuccess(res.user);
      }
    } catch (err: any) {
      setError(err.message || 'Invalid email or password.');
    } finally {
      setLoading(false);
    }
  };

  const isProceedingRef = useRef(false);

  // Step 2A: Proceed from Method Selection to Verification Step
  const handleProceedToVerify = async () => {
    if (sendingEmailOtp || isProceedingRef.current) return;
    setError(null);
    if (twoFactorMethod === 'email' && !emailOtpSent) {
      isProceedingRef.current = true;
      const sent = await handleSendEmailOtp();
      isProceedingRef.current = false;
      if (!sent) return;
    }
    setDigits(['', '', '', '', '', '']);
    setTwoFactorStep('verify');
  };

  // Focus first digit when entering verify step
  useEffect(() => {
    if (tempToken && twoFactorStep === 'verify') {
      setTimeout(() => {
        digitRefs.current[0]?.focus();
      }, 100);
    }
  }, [tempToken, twoFactorStep]);

  // Step 2: Send OTP to email
  const handleSendEmailOtp = async (): Promise<boolean> => {
    if (!tempToken) return false;
    if (sendingEmailOtp) return false;
    setError(null);
    setSendingEmailOtp(true);
    try {
      const res = await api.send2FaLoginOtp(tempToken);
      if (res.maskedEmail) setMaskedEmail(res.maskedEmail);
      if (res.isRecoveryEmail !== undefined) setIsRecoveryEmail(res.isRecoveryEmail);
      setEmailOtpSent(true);
      setEmailOtpCooldown(60);
      return true;
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code. Please try again.');
      return false;
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
        localStorage.setItem('toowix_superadmin_remember_email', email.trim().toLowerCase());
      } else {
        localStorage.removeItem('toowix_superadmin_remember_email');
      }
      setStoredToken(res.token);
      handleLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Invalid verification code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Bypass with emergency backup code
  const handleBackupCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tempToken) {
      setError('Session expired. Please sign in again.');
      return;
    }

    const cleanCode = backupCodeInput.trim();
    if (!cleanCode) {
      setError('Please enter your emergency backup code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.verify2Fa(tempToken, cleanCode, rememberMe, 'backup_code');
      if (rememberMe) {
        localStorage.setItem('toowix_superadmin_remember_email', email.trim().toLowerCase());
      } else {
        localStorage.removeItem('toowix_superadmin_remember_email');
      }
      setStoredToken(res.token);
      handleLoginSuccess(res.user);
    } catch (err: any) {
      setError(err.message || 'Invalid or previously used backup code. Please check and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setTempToken(null);
    setTwoFactorStep('select');
    setDigits(['', '', '', '', '', '']);
    setBackupCodeInput('');
    setEmailOtpSent(false);
    setError(null);
  };

  const displayTargetEmail = maskedEmail || maskedRecoveryEmail || (email ? maskEmailPreview(email) : '');
  const emailDestinationLabel = isRecoveryEmail ? 'recovery email' : 'email';

  return (
    <div className="font-sans antialiased text-slate-800 bg-slate-50 min-h-screen relative overflow-x-hidden flex flex-col justify-between selection:bg-indigo-100 selection:text-indigo-900">
      {/* Ambient Background Decor */}
      <div aria-hidden="true" className="fixed inset-0 pointer-events-none ambient-bg z-0">
        <div className="absolute bottom-[22%] left-[-15%] w-[130%] h-[320px] fluid-ribbon opacity-80"></div>
        <div className="absolute bottom-[18%] -left-10 w-[110%] h-[180px] bg-gradient-to-r from-cyan-200/40 via-indigo-400/35 to-indigo-300/30 blur-3xl opacity-75"></div>
        <div className="absolute top-1/3 left-24 w-3.5 h-3.5 rounded-full bg-indigo-300/60 blur-[1px]"></div>
        <div className="absolute bottom-1/3 left-16 w-5 h-5 rounded-full bg-sky-200/50 blur-[2px]"></div>
        <div className="absolute top-2/5 left-[42%] w-2.5 h-2.5 rounded-full bg-indigo-200/70"></div>
      </div>

      {/* Main Header */}
      <header className="relative z-10 w-full px-4 py-4 sm:px-8 sm:py-6 lg:px-14 flex items-center justify-between" data-purpose="top-navigation">
        <a className="flex items-center gap-2.5 group outline-none cursor-pointer" href="/" title="Toowix Platform Cloud">
          <img src={toowixLogo} alt="Toowix" className="w-8 h-8 object-contain group-hover:scale-105 transition-transform duration-200" />
          <span className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center">toowix</span>
        </a>

      </header>

      {/* Main Content */}
      <main className="page-content-scaled relative z-10 flex-grow flex items-center justify-center px-4 py-6 sm:px-6 sm:py-8">
        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-8 items-center">
          {/* Left Hero Showcase */}
          <section aria-label="Brand Identity" className="lg:col-span-6 flex flex-col justify-center items-center lg:items-start pl-0 lg:pl-8">
            <div className="flex items-center gap-3 sm:gap-4 lg:gap-6 select-none" data-purpose="brand-logo-lockup">
              <img
                src={toowixLogo}
                alt="Toowix"
                className="w-12 h-12 sm:w-16 sm:h-16 lg:w-24 lg:h-24 object-contain"
              />
              <span className="text-4xl sm:text-5xl lg:text-7xl font-bold tracking-tight text-slate-900 flex items-center">
                toowix
              </span>
            </div>
          </section>

          {/* Right Auth Card */}
          <section aria-label="Sign In Panel" className="lg:col-span-6 flex justify-center lg:justify-end">
            <div className="frosted-panel rounded-2xl sm:rounded-3xl p-5 sm:p-8 lg:p-10 w-full max-w-[460px] bg-white/75 backdrop-blur-xl border border-white/80 shadow-xl shadow-slate-900/5 transition-all duration-300" data-purpose="login-modal-card">
              {/* Error Alert */}
              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {!tempToken ? (
                /* ==================================================== */
                /* STEP 1: Super Admin Login                            */
                /* ==================================================== */
                <>
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight" id="loginHeading">Sign in to platform console</h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1">Enter your administrator credentials to access the platform console.</p>
                  </div>

                  <form className="space-y-4" onSubmit={handleCredentialsSubmit}>
                    {/* Primary Credential Input */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600" htmlFor="adminEmail">
                        Email address
                      </label>
                      <div className="relative">
                        <input
                          className="w-full h-11 px-4 bg-slate-50/90 border border-slate-200/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
                          id="adminEmail"
                          name="email"
                          placeholder="admin@toowix.com"
                          required
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>
                    </div>

                    {/* Master Password Input */}
                    <div className="space-y-1.5">
                      <label className="block text-xs font-medium text-slate-600 mb-1.5" htmlFor="adminPassword">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          className="w-full h-11 px-4 pr-11 bg-slate-50/90 border border-slate-200/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
                          id="adminPassword"
                          name="password"
                          placeholder="••••••••••••"
                          required
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                          aria-label="Toggle visibility"
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-md focus:outline-none"
                          onClick={() => setShowPassword(!showPassword)}
                          type="button"
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
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
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                          />
                          <span className="text-xs text-slate-600">Remember me</span>
                        </label>
                        {onForgotPassword && (
                          <button
                            type="button"
                            onClick={() => onForgotPassword(email)}
                            className="text-xs text-indigo-600 hover:text-indigo-700 hover:underline font-medium"
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

                    {/* Switch Portal Link */}
                    {onSwitchPortal && (
                      <div className="text-center pt-3">
                        <p className="text-xs text-slate-500">
                          Need organization admin?{' '}
                          <button
                            type="button"
                            onClick={onSwitchPortal}
                            className="text-indigo-600 hover:text-indigo-700 font-medium hover:underline cursor-pointer"
                          >
                            Switch to Organization Portal
                          </button>
                        </p>
                      </div>
                    )}
                  </form>
                </>
              ) : (
                /* ==================================================== */
                /* STEP 2: Two-Factor Verification                      */
                /* ==================================================== */
                <>
                  {twoFactorStep === 'select' ? (
                    /* ==================================================== */
                    /* STEP 2A: Select 2FA Method                           */
                    /* ==================================================== */
                    <>
                      <div className="mb-6 flex flex-col items-start">
                        <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-3.5 shadow-sm">
                          <ShieldCheck className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 block">Step 1 of 2</span>
                        <h2 className="text-2xl font-bold text-slate-900 tracking-tight mt-0.5">Two-factor authentication</h2>
                        <p className="text-sm text-slate-500 mt-1">Choose a verification method to complete sign in.</p>
                      </div>

                      {/* 2FA Method Selector */}
                      <div className="space-y-3 mb-6" data-purpose="method-selector">
                        {/* Method 1: TOTP */}
                        <div
                          className={`cursor-pointer p-4 rounded-2xl transition-all duration-200 flex items-start gap-3.5 relative ${
                            twoFactorMethod === 'totp'
                              ? 'border-2 border-indigo-600 bg-indigo-50/80 shadow-sm'
                              : 'border border-slate-200/80 bg-white/70 hover:bg-white hover:border-slate-300'
                          }`}
                          onClick={() => {
                            setTwoFactorMethod('totp');
                            setError(null);
                          }}
                        >
                          <div className="w-9 h-9 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600 flex-shrink-0 mt-0.5">
                            <Smartphone className="w-4 h-4" />
                          </div>
                          <div className="flex-grow min-w-0 pr-6">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="text-xs font-bold text-slate-900">Authenticator app</span>
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-indigo-100 text-indigo-700">Recommended</span>
                            </div>
                            <p className="text-xs text-slate-500 leading-relaxed">Generate verification codes using your authenticator app.</p>
                          </div>
                          <div className={`w-4 h-4 rounded-full border flex items-center justify-center absolute right-3.5 top-4.5 bg-white ${twoFactorMethod === 'totp' ? 'border-2 border-indigo-600' : 'border-slate-300'}`}>
                            {twoFactorMethod === 'totp' && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                          </div>
                        </div>

                        {/* Method 2: Email OTP */}
                        {(hasRecoveryEmail || hasEmail2Fa) && (
                          <div
                            className={`cursor-pointer p-4 rounded-2xl transition-all duration-200 flex items-start gap-3.5 relative ${
                              twoFactorMethod === 'email'
                                ? 'border-2 border-indigo-600 bg-indigo-50/80 shadow-sm'
                                : 'border border-slate-200/80 bg-white/70 hover:bg-white hover:border-slate-300'
                            }`}
                            onClick={() => {
                              setTwoFactorMethod('email');
                              setError(null);
                            }}
                          >
                            <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 flex-shrink-0 mt-0.5">
                              <Mail className="w-4 h-4" />
                            </div>
                            <div className="flex-grow min-w-0 pr-6">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-xs font-bold text-slate-800">Email verification code</span>
                              </div>
                              <p className="text-xs text-slate-500 leading-relaxed">
                                Send a temporary 6-digit code to your {emailDestinationLabel}{displayTargetEmail ? ` (${displayTargetEmail})` : ''}.
                              </p>
                            </div>
                            <div className={`w-4 h-4 rounded-full border flex items-center justify-center absolute right-3.5 top-4.5 bg-white ${twoFactorMethod === 'email' ? 'border-2 border-indigo-600' : 'border-slate-300'}`}>
                              {twoFactorMethod === 'email' && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Continue to Verification Button */}
                      <div className="pt-1">
                        <button
                          className="btn btn-primary btn-lg w-full flex items-center justify-center gap-2"
                          type="button"
                          onClick={handleProceedToVerify}
                          disabled={sendingEmailOtp || isProceedingRef.current}
                        >
                          <span>{sendingEmailOtp ? 'Sending code...' : 'Continue'}</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Use Backup Code Option */}
                      <div className="pt-2 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setTwoFactorStep('backup_code');
                            setBackupCodeInput('');
                            setError(null);
                          }}
                          className="text-xs text-indigo-600 hover:text-indigo-700 font-medium hover:underline cursor-pointer inline-flex items-center gap-1.5"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>Use backup code</span>
                        </button>
                      </div>

                      {/* Back to sign-in */}
                      <div className="text-center pt-2 space-y-2.5">
                        <div>
                          <button
                            type="button"
                            className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1 cursor-pointer"
                            onClick={handleBackToLogin}
                          >
                            <ArrowLeft className="w-3.5 h-3.5" />
                            <span>Back to sign in</span>
                          </button>
                        </div>
                        <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Encrypted connection</span>
                        </div>
                      </div>
                    </>
                  ) : twoFactorStep === 'backup_code' ? (
                    /* ==================================================== */
                    /* STEP 2C: Emergency Backup Code                       */
                    /* ==================================================== */
                    <>
                      <div className="mb-6 flex flex-col items-start">
                        <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-3.5 shadow-sm">
                          <KeyRound className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 block">Emergency Access</span>
                        <h2 className="text-2xl font-bold text-slate-900 tracking-tight mt-0.5">Emergency backup code</h2>
                        <p className="text-sm text-slate-500 mt-1">Enter one of your single-use backup codes to sign in.</p>
                      </div>

                      <form className="space-y-4" onSubmit={handleBackupCodeSubmit}>
                        <div className="space-y-1.5">
                          <label className="text-xs font-semibold text-slate-700 block" htmlFor="backupCodeInput">
                            Backup code
                          </label>
                          <input
                            id="backupCodeInput"
                            type="text"
                            autoFocus
                            placeholder="XXXX-XXXX"
                            value={backupCodeInput}
                            onChange={(e) => setBackupCodeInput(e.target.value)}
                            className="w-full h-11 px-4 bg-slate-50/90 border border-slate-200/80 rounded-xl text-base font-mono tracking-widest uppercase text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all text-center"
                          />
                          <p className="text-[11px] text-slate-400 mt-1">
                            8 characters (e.g. ABCD-EFGH). Each code can only be used once.
                          </p>
                        </div>

                        {/* Trust Device Checkbox */}
                        <div className="pt-1">
                          <label className="flex items-center gap-2 cursor-pointer select-none text-[13px] text-slate-600">
                            <input
                              checked={rememberMe}
                              onChange={(e) => setRememberMe(e.target.checked)}
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
                              type="checkbox"
                            />
                            <span className="text-xs text-slate-600">Remember this device for 30 days</span>
                          </label>
                        </div>

                        {/* Primary CTA Button */}
                        <div className="pt-2">
                          <button
                            className="btn btn-primary btn-lg w-full"
                            id="submitBackupCodeBtn"
                            type="submit"
                            disabled={loading || !backupCodeInput.trim()}
                          >
                            <span>{loading ? 'Verifying...' : 'Verify and sign in'}</span>
                          </button>
                        </div>

                        {/* Navigation back */}
                        <div className="text-center pt-2 space-y-2">
                          <div>
                            <button
                              type="button"
                              className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1 cursor-pointer"
                              onClick={() => {
                                setTwoFactorStep('select');
                                setBackupCodeInput('');
                                setError(null);
                              }}
                            >
                              <ArrowLeft className="w-3.5 h-3.5" />
                              <span>Back to standard verification</span>
                            </button>
                          </div>
                          <div>
                            <button
                              type="button"
                              className="text-xs text-slate-400 hover:text-slate-600 transition-colors inline-flex items-center gap-1 cursor-pointer"
                              onClick={handleBackToLogin}
                            >
                              <span>Back to sign in</span>
                            </button>
                          </div>
                          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 pt-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Encrypted connection</span>
                          </div>
                        </div>
                      </form>
                    </>
                  ) : (
                    /* ==================================================== */
                    /* STEP 2B: Enter OTP / Code Verification               */
                    /* ==================================================== */
                    <>
                      <div className="mb-6 flex flex-col items-start">
                        <div className="w-11 h-11 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-3.5 shadow-sm">
                          <ShieldCheck className="w-5 h-5" />
                        </div>
                        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 block">Step 2 of 2</span>
                        <h2 className="text-2xl font-bold text-slate-900 tracking-tight mt-0.5">
                          {twoFactorMethod === 'totp' ? 'Authenticator verification' : 'Verify email code'}
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">
                          {twoFactorMethod === 'totp'
                            ? 'Enter the 6-digit authenticator code from your authenticator app.'
                            : `Enter the 6-digit verification code sent to ${displayTargetEmail || `your ${emailDestinationLabel}`}.`}
                        </p>
                      </div>

                      {/* Email Destination & Resend Header */}
                      {twoFactorMethod === 'email' && (
                        <div className="mb-4 p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center justify-between text-xs text-slate-700">
                          <div className="flex items-center gap-2 truncate">
                            <Mail className="w-4 h-4 text-indigo-600 shrink-0" />
                            <span className="truncate">
                              Sent to: <strong className="text-slate-900 font-semibold">{displayTargetEmail || emailDestinationLabel}</strong>
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={handleSendEmailOtp}
                            disabled={sendingEmailOtp || emailOtpCooldown > 0}
                            className="text-[11px] text-indigo-600 font-semibold hover:underline disabled:opacity-50 shrink-0 cursor-pointer"
                          >
                            {sendingEmailOtp ? 'Sending...' : emailOtpCooldown > 0 ? `Resend (${emailOtpCooldown}s)` : 'Resend code'}
                          </button>
                        </div>
                      )}

                      {/* 2FA Code Input Form */}
                      <form className="space-y-4" onSubmit={handle2FaSubmit}>
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-slate-700 block">
                            {twoFactorMethod === 'totp' ? 'Authenticator code' : 'Email verification code'}
                          </label>

                          {/* 6-digit individual inputs */}
                          <div className="grid grid-cols-6 gap-1.5 sm:gap-2.5" onPaste={handleDigitPaste}>
                            {digits.map((digit, idx) => (
                              <input
                                key={idx}
                                ref={(el) => (digitRefs.current[idx] = el)}
                                className="w-full h-12 text-center text-lg font-bold tabular-nums text-slate-900 bg-slate-50/90 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
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
                              <Clock className="w-3.5 h-3.5 text-indigo-600 flex-shrink-0" />
                              <span>
                                {twoFactorMethod === 'totp'
                                  ? 'Codes refresh every 30 seconds.'
                                  : 'Codes expire after 10 minutes.'}
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
                              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
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
                            disabled={loading || digits.join('').length !== 6}
                          >
                            <span>{loading ? 'Verifying...' : 'Verify and sign in'}</span>
                          </button>
                        </div>

                        {/* Navigation back */}
                        <div className="text-center pt-2 space-y-2">
                          <div>
                            <button
                              type="button"
                              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                              onClick={() => {
                                setTwoFactorStep('backup_code');
                                setBackupCodeInput('');
                                setError(null);
                              }}
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>Use backup code</span>
                            </button>
                          </div>
                          <div>
                            <button
                              type="button"
                              className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1 cursor-pointer"
                              onClick={() => {
                                setTwoFactorStep('select');
                                setDigits(['', '', '', '', '', '']);
                                setError(null);
                              }}
                            >
                              <ArrowLeft className="w-3.5 h-3.5" />
                              <span>Choose a different method</span>
                            </button>
                          </div>
                          <div>
                            <button
                              type="button"
                              className="text-xs text-slate-400 hover:text-slate-600 transition-colors inline-flex items-center gap-1 cursor-pointer"
                              onClick={handleBackToLogin}
                            >
                              <span>Back to sign in</span>
                            </button>
                          </div>
                          <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-400 pt-1">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                            <span>Encrypted connection</span>
                          </div>
                        </div>
                      </form>
                    </>
                  )}
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
