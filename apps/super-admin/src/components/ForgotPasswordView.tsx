import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import {
  Mail,
  ShieldAlert,
  Smartphone,
  HelpCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  AlertCircle,
} from 'lucide-react';
import toowixLogo from '../assets/toowix-logo.svg';

interface ForgotPasswordViewProps {
  onBackToLogin: () => void;
  portalName?: string;
  themeColor?: string;
  initialEmail?: string;
}

export type RecoveryMode = 'current_otp' | 'recovery_otp' | 'totp' | 'questions';

export function maskEmailPreview(email: string): string {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  if (!domain) return '';
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  if (local.length <= 4) return `${local.slice(0, 1)}***${local.slice(-1)}@${domain}`;
  if (local.length <= 6) return `${local.slice(0, 2)}***${local.slice(-1)}@${domain}`;
  return `${local.slice(0, 2)}***${local.slice(-2)}@${domain}`;
}

export const ForgotPasswordView: React.FC<ForgotPasswordViewProps> = ({
  onBackToLogin,
  initialEmail,
}) => {
  // Wizard Stages: 1 = Identify, 2 = Verify, 3 = New Password, 4 = Success
  const [stage, setStage] = useState<1 | 2 | 3 | 4>(1);

  // Stage 1: Email
  const storedEmail = localStorage.getItem('toowix_superadmin_remember_email') || '';
  const [email, setEmail] = useState(initialEmail || storedEmail);

  useEffect(() => {
    if (!email) {
      api.getDefaultForgotPasswordAccount('admin')
        .then((res) => {
          if (res.email) setEmail(res.email);
        })
        .catch(() => { });
    }
  }, []);

  // Stage 2: Recovery details
  const [maskedCurrentEmail, setMaskedCurrentEmail] = useState('');
  const [hasRecoveryEmail, setHasRecoveryEmail] = useState(false);
  const [maskedRecoveryEmail, setMaskedRecoveryEmail] = useState('');
  const [hasTotp, setHasTotp] = useState(false);
  const [hasSecurityQuestions, setHasSecurityQuestions] = useState(false);
  const [questions, setQuestions] = useState<string[]>([]);

  const [recoveryMode, setRecoveryMode] = useState<RecoveryMode>('current_otp');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [sendingOtp, setSendingOtp] = useState(false);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [resetToken, setResetToken] = useState('');

  // Stage 3: Passwords
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);

  // Status & Error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (otpCooldown > 0) {
      const timer = setTimeout(() => setOtpCooldown(otpCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [otpCooldown]);

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

  // Stage 1 submit
  const handleStage1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your administrator account email address.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.initiateForgotPassword(cleanEmail);
      setMaskedCurrentEmail(res.maskedCurrentEmail || maskEmailPreview(res.email || cleanEmail));
      setHasRecoveryEmail(!!res.hasRecoveryEmail);
      setMaskedRecoveryEmail(res.maskedRecoveryEmail || '');
      setHasTotp(!!res.hasTotp);
      setHasSecurityQuestions(!!(res.securityQuestions && res.securityQuestions.length === 3));
      setQuestions(res.securityQuestions || []);

      if (res.hasTotp) {
        setRecoveryMode('totp');
      } else if (res.hasRecoveryEmail) {
        setRecoveryMode('recovery_otp');
      } else {
        setRecoveryMode('current_otp');
      }

      setStage(2);
    } catch (err: any) {
      setError(err.message || 'Unable to find an account with that email address.');
    } finally {
      setLoading(false);
    }
  };

  // Send OTP
  const handleSendOtp = async (target: 'current' | 'recovery') => {
    if (otpCooldown > 0 || sendingOtp) return;
    setSendingOtp(true);
    setError(null);
    try {
      await api.sendForgotPasswordOtp(email.trim(), target);
      setOtpCooldown(60);
    } catch (err: any) {
      setError(err.message || 'Failed to dispatch verification code.');
    } finally {
      setSendingOtp(false);
    }
  };

  // Stage 2 submit
  const handleStage2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let res;
      if (recoveryMode === 'current_otp' || recoveryMode === 'recovery_otp') {
        const code = digits.join('').trim();
        if (code.length !== 6) {
          throw new Error('Please enter the full 6-digit verification code.');
        }
        res = await api.verifyForgotPasswordOtp(email.trim(), code);
      } else if (recoveryMode === 'totp') {
        const code = digits.join('').trim();
        if (code.length !== 6) {
          throw new Error('Please enter the full 6-digit authenticator code.');
        }
        res = await api.verifyForgotPasswordTotp(email.trim(), code);
      } else if (recoveryMode === 'questions') {
        const answersList = questions.map((q) => ({
          question: q,
          answer: answers[q]?.trim() || '',
        }));
        if (answersList.some((a) => !a.answer)) {
          throw new Error('Please answer all security questions.');
        }
        res = await api.verifyForgotPasswordQuestions(email.trim(), answersList);
      }

      if (res?.resetToken) {
        setResetToken(res.resetToken);
        setStage(3);
      } else {
        throw new Error('Verification completed but no reset token was returned.');
      }
    } catch (err: any) {
      setError(err.message || 'Identity verification failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  // Password policy checks
  const hasMinLength = newPassword.length >= 8;
  const hasComplexity =
    /[A-Z]/.test(newPassword) &&
    /[a-z]/.test(newPassword) &&
    /[0-9]/.test(newPassword) &&
    /[^A-Za-z0-9]/.test(newPassword);
  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;

  // Stage 3 submit
  const handleStage3Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasMinLength) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (!hasComplexity) {
      setError('Password must include uppercase, lowercase, numbers, and symbols.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.resetPassword(email.trim(), resetToken, newPassword);
      setStage(4);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password. Your reset session may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="font-sans antialiased text-slate-800 bg-slate-50 min-h-screen relative overflow-x-hidden flex flex-col justify-between selection:bg-indigo-100 selection:text-indigo-900">
      {/* Ambient Background Decor */}
      <div aria-hidden="true" className="fixed inset-0 pointer-events-none ambient-bg z-0">
        <div className="absolute bottom-[22%] left-[-15%] w-[130%] h-[320px] fluid-ribbon opacity-80 pointer-events-none"></div>
        <div className="absolute bottom-[18%] -left-10 w-[110%] h-[180px] bg-gradient-to-r from-cyan-200/40 via-indigo-400/35 to-indigo-300/30 blur-3xl opacity-75 pointer-events-none"></div>
        <div className="absolute top-1/3 left-24 w-3.5 h-3.5 rounded-full bg-indigo-300/60 blur-[1px]"></div>
        <div className="absolute bottom-1/3 left-16 w-5 h-5 rounded-full bg-sky-200/50 blur-[2px]"></div>
        <div className="absolute top-2/5 left-[42%] w-2.5 h-2.5 rounded-full bg-indigo-200/70"></div>
      </div>

      {/* Main Header */}
      <header className="relative z-10 w-full px-8 py-6 lg:px-14 flex items-center justify-between" data-purpose="top-navigation">
        <a
          className="flex items-center gap-2.5 group outline-none cursor-pointer"
          href="/"
          title="Toowix Platform Cloud"
          onClick={(e) => {
            e.preventDefault();
            onBackToLogin();
          }}
        >
          <img src={toowixLogo} alt="Toowix" className="w-8 h-8 object-contain group-hover:scale-105 transition-transform duration-200" />
          <span className="text-2xl font-bold tracking-tight text-slate-900 flex items-center">toowix</span>
        </a>

      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-grow flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          {/* Left Hero Showcase */}
          <section aria-label="Brand Identity" className="lg:col-span-6 flex flex-col justify-center items-center lg:items-start pl-0 lg:pl-8">
            <div className="flex items-center gap-4 sm:gap-6 select-none" data-purpose="brand-logo-lockup">
              <img
                src={toowixLogo}
                alt="Toowix"
                className="w-16 h-16 sm:w-20 sm:h-20 lg:w-24 lg:h-24 object-contain"
              />
              <span className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-slate-900 flex items-center">
                toowix
              </span>
            </div>
          </section>

          {/* Right Auth Card */}
          <section aria-label="Password Reset Panel" className="lg:col-span-6 flex justify-center lg:justify-end">
            <div className="frosted-panel rounded-3xl p-8 sm:p-10 w-full max-w-[460px] bg-white/45 backdrop-blur-xl border border-white/70 shadow-xl shadow-slate-900/5 transition-all duration-300 relative overflow-hidden" data-purpose="recovery-modal-card">
              {/* Error Alert */}
              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <AlertCircle size={16} className="text-red-500 shrink-0" />
                    <span className="truncate">{error}</span>
                  </div>
                  <button
                    onClick={() => setError(null)}
                    type="button"
                    className="text-red-400 hover:text-red-600 text-sm leading-none shrink-0"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* ==================================================== */}
              {/* STAGE 1: Identify Account                            */}
              {/* ==================================================== */}
              {stage === 1 && (
                <>
                  <div className="mb-6">
                    <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 block">Step 1 of 3</span>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight mt-1">Reset your password</h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1">Enter your administrator email to verify your identity.</p>
                  </div>

                  <form className="space-y-4" onSubmit={handleStage1Submit}>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600" htmlFor="resetEmail">
                        Administrator email
                      </label>
                      <div className="relative">
                        <input
                          className="w-full h-11 px-4 pr-10 bg-slate-50/90 border border-slate-200/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
                          id="resetEmail"
                          name="email"
                          placeholder="admin@toowix.com"
                          required
                          type="email"
                          value={email}
                          onChange={(e) => {
                            setEmail(e.target.value);
                            setError(null);
                          }}
                        />
                        <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
                          <Mail size={16} />
                        </span>
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        className="btn btn-primary btn-lg w-full"
                        type="submit"
                        disabled={loading}
                      >
                        <span>{loading ? 'Verifying...' : 'Continue'}</span>
                      </button>
                    </div>

                    <div className="text-center pt-3">
                      <button
                        type="button"
                        onClick={onBackToLogin}
                        className="text-xs text-slate-500 hover:text-indigo-600 font-medium inline-flex items-center gap-1 transition-colors cursor-pointer border-none bg-transparent"
                      >
                        ← Back to sign in
                      </button>
                    </div>
                  </form>
                </>
              )}

              {/* ==================================================== */}
              {/* STAGE 2: Multi-Factor Verification Challenge         */}
              {/* ==================================================== */}
              {stage === 2 && (
                <>
                  <div className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200/80 rounded-xl mb-4 text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <span className="text-slate-400">Account:</span>
                      <span className="font-medium text-slate-900 truncate">
                        {maskedCurrentEmail || maskEmailPreview(email)}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStage(1);
                        setError(null);
                      }}
                      className="text-indigo-600 hover:underline font-medium text-[11px] shrink-0 cursor-pointer border-none bg-transparent"
                    >
                      Change
                    </button>
                  </div>

                  <div className="mb-4">
                    <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 block">Step 2 of 3</span>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight mt-0.5">Modes of recovery</h2>
                    <p className="text-slate-500 text-xs mt-1">Select how you would like to verify your identity:</p>
                  </div>

                  {/* Mode Selector Grid */}
                  <div className="grid grid-cols-2 gap-2 mb-5">
                    {/* Mode 1: Current Email */}
                    <button
                      type="button"
                      onClick={() => {
                        setRecoveryMode('current_otp');
                        setDigits(['', '', '', '', '', '']);
                        setError(null);
                      }}
                      className={`p-3 text-left rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${recoveryMode === 'current_otp'
                          ? 'bg-indigo-50/80 border-indigo-600 ring-2 ring-indigo-600/20 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${recoveryMode === 'current_otp' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          <Mail size={14} />
                        </div>
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Ready</span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900">Current Email</div>
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">{maskedCurrentEmail || maskEmailPreview(email)}</div>
                      </div>
                    </button>

                    {/* Mode 2: Recovery Email */}
                    <button
                      type="button"
                      disabled={!hasRecoveryEmail}
                      onClick={() => {
                        setRecoveryMode('recovery_otp');
                        setDigits(['', '', '', '', '', '']);
                        setError(null);
                      }}
                      className={`p-3 text-left rounded-xl border transition-all flex flex-col justify-between ${!hasRecoveryEmail
                          ? 'opacity-40 bg-slate-50 border-slate-200 cursor-not-allowed'
                          : recoveryMode === 'recovery_otp'
                            ? 'bg-indigo-50/80 border-indigo-600 ring-2 ring-indigo-600/20 shadow-sm cursor-pointer'
                            : 'bg-white border-slate-200 hover:border-slate-300 cursor-pointer'
                        }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${recoveryMode === 'recovery_otp' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          <ShieldAlert size={14} />
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasRecoveryEmail ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 bg-slate-100'}`}>
                          {hasRecoveryEmail ? 'Ready' : 'None'}
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900">Recovery Email</div>
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                          {hasRecoveryEmail ? maskedRecoveryEmail : 'Not configured'}
                        </div>
                      </div>
                    </button>

                    {/* Mode 3: Authenticator App */}
                    <button
                      type="button"
                      disabled={!hasTotp}
                      onClick={() => {
                        setRecoveryMode('totp');
                        setDigits(['', '', '', '', '', '']);
                        setError(null);
                      }}
                      className={`p-3 text-left rounded-xl border transition-all flex flex-col justify-between ${!hasTotp
                          ? 'opacity-40 bg-slate-50 border-slate-200 cursor-not-allowed'
                          : recoveryMode === 'totp'
                            ? 'bg-indigo-50/80 border-indigo-600 ring-2 ring-indigo-600/20 shadow-sm cursor-pointer'
                            : 'bg-white border-slate-200 hover:border-slate-300 cursor-pointer'
                        }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${recoveryMode === 'totp' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          <Smartphone size={14} />
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasTotp ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 bg-slate-100'}`}>
                          {hasTotp ? 'Active' : 'None'}
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900">Authenticator</div>
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                          {hasTotp ? 'TOTP 6-digit code' : 'Not configured'}
                        </div>
                      </div>
                    </button>

                    {/* Mode 4: Security Questions */}
                    <button
                      type="button"
                      disabled={!hasSecurityQuestions}
                      onClick={() => {
                        setRecoveryMode('questions');
                        setError(null);
                      }}
                      className={`p-3 text-left rounded-xl border transition-all flex flex-col justify-between ${!hasSecurityQuestions
                          ? 'opacity-40 bg-slate-50 border-slate-200 cursor-not-allowed'
                          : recoveryMode === 'questions'
                            ? 'bg-indigo-50/80 border-indigo-600 ring-2 ring-indigo-600/20 shadow-sm cursor-pointer'
                            : 'bg-white border-slate-200 hover:border-slate-300 cursor-pointer'
                        }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${recoveryMode === 'questions' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          <HelpCircle size={14} />
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${hasSecurityQuestions ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 bg-slate-100'}`}>
                          {hasSecurityQuestions ? 'Active' : 'None'}
                        </span>
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900">Security Questions</div>
                        <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                          {hasSecurityQuestions ? '3 Saved Questions' : 'Not configured'}
                        </div>
                      </div>
                    </button>
                  </div>

                  {/* Dynamic Form based on recoveryMode */}
                  <form className="space-y-4" onSubmit={handleStage2Submit}>
                    {/* OTP Form */}
                    {(recoveryMode === 'current_otp' || recoveryMode === 'recovery_otp' || recoveryMode === 'totp') && (
                      <div className="space-y-2">
                        <div className="flex justify-between items-center">
                          <label className="text-xs font-semibold text-slate-700">
                            {recoveryMode === 'totp' ? 'Authenticator code' : '6-digit verification code'}
                          </label>
                          {(recoveryMode === 'current_otp' || recoveryMode === 'recovery_otp') && (
                            <button
                              type="button"
                              onClick={() => handleSendOtp(recoveryMode === 'current_otp' ? 'current' : 'recovery')}
                              disabled={sendingOtp || otpCooldown > 0}
                              className="text-[11px] text-indigo-600 font-medium hover:underline disabled:opacity-50"
                            >
                              {sendingOtp ? 'Sending...' : otpCooldown > 0 ? `Resend (${otpCooldown}s)` : 'Send code'}
                            </button>
                          )}
                        </div>

                        {/* 6-digit pin inputs */}
                        <div className="grid grid-cols-6 gap-2 sm:gap-2.5" onPaste={handleDigitPaste}>
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
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-600"></span>
                            <span>
                              {recoveryMode === 'totp'
                                ? 'Enter the 6-digit code from your authenticator app.'
                                : recoveryMode === 'recovery_otp'
                                  ? `Code sent to recovery email (${maskedRecoveryEmail}).`
                                  : `Code sent to primary account (${maskedCurrentEmail || email}).`}
                            </span>
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Security Questions Form */}
                    {recoveryMode === 'questions' && (
                      <div className="space-y-3">
                        {questions.map((q, idx) => (
                          <div key={idx} className="space-y-1">
                            <label className="text-xs font-medium text-slate-700 block">
                              {idx + 1}. {q}
                            </label>
                            <input
                              type="text"
                              required
                              value={answers[q] || ''}
                              onChange={(e) =>
                                setAnswers({ ...answers, [q]: e.target.value })
                              }
                              placeholder="Your answer"
                              className="w-full h-10 px-3.5 text-xs bg-slate-50/90 border border-slate-200/80 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                            />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="pt-2">
                      <button
                        className="btn btn-primary btn-lg w-full"
                        type="submit"
                        disabled={loading}
                      >
                        <span>{loading ? 'Verifying...' : 'Verify and continue'}</span>
                      </button>
                    </div>

                    <div className="text-center pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setStage(1);
                          setError(null);
                        }}
                        className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1"
                      >
                        ← Back to email entry
                      </button>
                    </div>
                  </form>
                </>
              )}

              {/* ==================================================== */}
              {/* STAGE 3: Set New Password                            */}
              {/* ==================================================== */}
              {stage === 3 && (
                <>
                  <div className="mb-6">
                    <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 block">Step 3 of 3</span>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight mt-1">Set new password</h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1">Create a strong password for your administrator account.</p>
                  </div>

                  <form className="space-y-4" onSubmit={handleStage3Submit}>
                    {/* New Password */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600" htmlFor="newPassword">
                        New password
                      </label>
                      <div className="relative">
                        <input
                          id="newPassword"
                          type={showNewPass ? 'text' : 'password'}
                          required
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="••••••••••••"
                          className="w-full h-11 px-4 pr-11 bg-slate-50/90 border border-slate-200/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          aria-label="Toggle password visibility"
                          onClick={() => setShowNewPass(!showNewPass)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                        >
                          {showNewPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>

                    {/* Policy checklist */}
                    <div className="p-3 bg-slate-50/90 border border-slate-200/80 rounded-xl space-y-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[10px] font-bold ${hasMinLength ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                          ✓
                        </span>
                        <span className={hasMinLength ? 'text-slate-800 font-medium' : 'text-slate-500'}>
                          At least 8 characters
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[10px] font-bold ${hasComplexity ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                          ✓
                        </span>
                        <span className={hasComplexity ? 'text-slate-800 font-medium' : 'text-slate-500'}>
                          Uppercase, lowercase, numbers & symbols
                        </span>
                      </div>
                    </div>

                    {/* Confirm Password */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600" htmlFor="confirmPassword">
                        Confirm new password
                      </label>
                      <div className="relative">
                        <input
                          id="confirmPassword"
                          type={showConfirmPass ? 'text' : 'password'}
                          required
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="••••••••••••"
                          className="w-full h-11 px-4 pr-11 bg-slate-50/90 border border-slate-200/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                        />
                        <button
                          type="button"
                          aria-label="Toggle confirm password visibility"
                          onClick={() => setShowConfirmPass(!showConfirmPass)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                        >
                          {showConfirmPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {confirmPassword && (
                        <p className={`text-xs flex items-center gap-1 pt-0.5 ${passwordsMatch ? 'text-emerald-600' : 'text-rose-500'}`}>
                          <span>{passwordsMatch ? '✓ Passwords match' : '✗ Passwords do not match'}</span>
                        </p>
                      )}
                    </div>

                    <div className="pt-2">
                      <button
                        className="btn btn-primary btn-lg w-full"
                        type="submit"
                        disabled={loading || !hasMinLength || !hasComplexity || !passwordsMatch}
                      >
                        <span>{loading ? 'Updating...' : 'Update password and sign in'}</span>
                      </button>
                    </div>
                  </form>
                </>
              )}

              {/* ==================================================== */}
              {/* STAGE 4: Success Confirmation                        */}
              {/* ==================================================== */}
              {stage === 4 && (
                <div className="text-center py-4">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center mx-auto mb-4 shadow-sm">
                    <CheckCircle2 size={28} />
                  </div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Password reset successfully</h2>
                  <p className="text-xs sm:text-sm text-slate-500 mt-2 mb-6 leading-relaxed">
                    Your administrator credentials have been securely updated. You can now use your new password to sign in.
                  </p>
                  <button
                    onClick={onBackToLogin}
                    className="btn btn-primary btn-lg w-full"
                    type="button"
                  >
                    <span>Proceed to sign in</span>
                  </button>
                </div>
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
