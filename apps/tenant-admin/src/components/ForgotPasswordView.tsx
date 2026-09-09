import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import {
  Mail,
  ShieldAlert,
  Smartphone,
  HelpCircle,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
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
  // Wizard Stages: 1 = Identify Account, 2 = Verify Identity (4 modes), 3 = New Password, 4 = Success
  const [stage, setStage] = useState<1 | 2 | 3 | 4>(1);

  // Stage 1: Email & Identification
  const storedEmail = localStorage.getItem('toowix_tenant_remember_email') || '';
  const [email, setEmail] = useState(initialEmail || storedEmail);

  // Auto-fetch a default account hint on mount if no email is known
  useEffect(() => {
    if (!email) {
      api.getDefaultForgotPasswordAccount('tenant')
        .then((res) => {
          if (res.email) setEmail(res.email);
        })
        .catch(() => { /* ignore, user can type manually */ });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stage 2: Account Recovery Metadata
  const [maskedCurrentEmail, setMaskedCurrentEmail] = useState('');
  const [hasRecoveryEmail, setHasRecoveryEmail] = useState(false);
  const [maskedRecoveryEmail, setMaskedRecoveryEmail] = useState('');
  const [hasTotp, setHasTotp] = useState(false);
  const [hasSecurityQuestions, setHasSecurityQuestions] = useState(false);
  const [questions, setQuestions] = useState<string[]>([]);

  // Selected recovery mode: 1. current_otp, 2. recovery_otp, 3. totp, 4. questions
  const [recoveryMode, setRecoveryMode] = useState<RecoveryMode>('current_otp');

  // OTP State (shared for current email, recovery email, and totp)
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [otpCooldown, setOtpCooldown] = useState(0);
  const [otpSentTarget, setOtpSentTarget] = useState<'current' | 'recovery' | null>(null);
  const [sendingOtp, setSendingOtp] = useState(false);

  // Security Questions State
  const [answers, setAnswers] = useState<Record<string, string>>({});

  // Reset Token from Stage 2
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

  // OTP cooldown countdown
  useEffect(() => {
    if (otpCooldown > 0) {
      const timer = setTimeout(() => setOtpCooldown(otpCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [otpCooldown]);

  // Handle 6-digit code inputs
  const handleDigitChange = (index: number, val: string) => {
    const char = val.slice(-1).replace(/[^0-9]/g, '');
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

  // Reset digit inputs when switching modes
  const handleSwitchMode = (mode: RecoveryMode) => {
    setRecoveryMode(mode);
    setError(null);
    setDigits(['', '', '', '', '', '']);
  };

  // =========================================================================
  // STAGE 1: Check Account & Fetch Available Modes
  // =========================================================================
  const handleStage1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError('Please enter your administrator account email address.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.initiateForgotPassword(email.trim());
      const currentMasked = res.maskedCurrentEmail || maskEmailPreview(res.email || email);
      setMaskedCurrentEmail(currentMasked);
      setHasRecoveryEmail(!!res.hasRecoveryEmail);
      setMaskedRecoveryEmail(res.maskedRecoveryEmail || '');
      setHasTotp(!!res.hasTotp);
      setHasSecurityQuestions(!!(res.securityQuestions && res.securityQuestions.length === 3));
      setQuestions(res.securityQuestions || []);

      // Default to 1. OTP on current email
      setRecoveryMode('current_otp');
      setDigits(['', '', '', '', '', '']);
      setStage(2);
    } catch (err: any) {
      setError(err.message || 'No active administrator account was found for this email address.');
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // STAGE 2: Send OTP (Current or Recovery Email)
  // =========================================================================
  const handleSendOtp = async (target: 'current' | 'recovery') => {
    if (otpCooldown > 0 || sendingOtp) return;
    setError(null);
    setSendingOtp(true);
    try {
      await api.sendForgotPasswordOtp(email.trim(), target);
      setOtpCooldown(60);
      setOtpSentTarget(target);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to dispatch verification code.');
    } finally {
      setSendingOtp(false);
    }
  };

  // =========================================================================
  // STAGE 2: Verify OTP (Current or Recovery Email)
  // =========================================================================
  const handleVerifyEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join('').trim();
    if (!code || code.length !== 6) {
      setError('Please enter the 6-digit verification code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.verifyForgotPasswordOtp(email.trim(), code);
      setResetToken(res.resetToken);
      setStage(3);
    } catch (err: any) {
      setError(err.message || 'Invalid or expired verification code.');
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // STAGE 2: Verify Authenticator App TOTP
  // =========================================================================
  const handleVerifyTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = digits.join('').trim();
    if (!code || code.length !== 6) {
      setError('Please enter the 6-digit code from your authenticator app.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.verifyForgotPasswordTotp(email.trim(), code);
      setResetToken(res.resetToken);
      setStage(3);
    } catch (err: any) {
      setError(err.message || 'Invalid authenticator code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // =========================================================================
  // STAGE 2: Verify Security Questions
  // =========================================================================
  const handleVerifyQuestions = async (e: React.FormEvent) => {
    e.preventDefault();
    const answersList = questions.map((q) => ({
      question: q,
      answer: answers[q]?.trim() || '',
    }));

    if (answersList.some((a) => !a.answer)) {
      setError('Please answer all 3 security questions.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.verifyForgotPasswordQuestions(email.trim(), answersList);
      setResetToken(res.resetToken);
      setStage(3);
    } catch (err: any) {
      setError(err.message || 'One or more security answers are incorrect.');
    } finally {
      setLoading(false);
    }
  };

  // Password Policy Checks
  const hasMinLength = newPassword.length >= 8;
  const hasComplexity =
    /[A-Z]/.test(newPassword) &&
    /[a-z]/.test(newPassword) &&
    /[0-9]/.test(newPassword) &&
    /[^A-Za-z0-9]/.test(newPassword);
  const passwordsMatch = newPassword && confirmPassword && newPassword === confirmPassword;

  // =========================================================================
  // STAGE 3: Submit New Password
  // =========================================================================
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasMinLength) {
      setError('Password must be at least 8 characters.');
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
      {/* Background fluid meshes */}
      <div aria-hidden="true" className="fixed inset-0 pointer-events-none ambient-bg z-0">
        <div className="absolute bottom-[22%] left-[-15%] w-[130%] h-[320px] fluid-ribbon opacity-80 pointer-events-none"></div>
        <div className="absolute bottom-[18%] -left-10 w-[110%] h-[180px] bg-gradient-to-r from-cyan-200/40 via-indigo-400/35 to-indigo-300/30 blur-3xl opacity-75 pointer-events-none"></div>
        <div className="subtle-dot absolute top-[36%] left-[13%] opacity-70 pointer-events-none"></div>
        <div className="subtle-dot absolute top-[32%] left-[6.5%] w-3 h-3 opacity-60 pointer-events-none"></div>
        <div className="subtle-dot absolute top-[80%] left-[10.5%] w-4 h-4 opacity-50 pointer-events-none"></div>
        <div className="subtle-dot absolute top-[18%] left-[45%] w-2.5 h-2.5 opacity-40 pointer-events-none"></div>
      </div>

      {/* Top Header */}
      <header className="relative z-10 w-full px-8 py-6 lg:px-14 flex items-center justify-between" data-purpose="main-header">
        <a
          aria-label="Toowix Homepage"
          className="flex items-center gap-2.5 group transition-transform active:scale-95 cursor-pointer"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            onBackToLogin();
          }}
        >
          <img src={toowixLogo} alt="Toowix" className="w-8 h-8 object-contain" />
          <span className="text-xl font-bold tracking-tight text-slate-900 futuristic-title">toowix</span>
        </a>

      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-grow flex items-center justify-center px-6 py-8">
        <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
        {/* Left Hero: Brand Identity */}
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

        {/* Right Area: Password Reset Wizard Card */}
        <section aria-label="Password Reset Panel" className="lg:col-span-6 flex justify-center lg:justify-end">
          <div className="frosted-panel rounded-3xl p-8 sm:p-10 w-full max-w-[460px] bg-white/45 backdrop-blur-xl border border-white/70 shadow-xl shadow-slate-900/5 transition-all duration-300 relative overflow-hidden" data-purpose="recovery-wizard-card">
            {/* Error Alert Container */}
            {error && (
              <div className="mb-6 p-3.5 bg-rose-50/90 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start gap-2.5" id="alert-banner">
                <AlertCircle size={16} className="text-rose-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <span className="font-semibold">Error: </span>
                  {error}
                </div>
                <button className="text-rose-400 hover:text-rose-700 text-sm leading-none cursor-pointer border-none bg-transparent" onClick={() => setError(null)} type="button">×</button>
              </div>
            )}

            {/* ==================================================== */}
            {/* STAGE 1: Account Identification with Sensored Email  */}
            {/* ==================================================== */}
            {stage === 1 && (
              <section className="step-content" id="stage-1">
                <div className="mb-6">
                  <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 block">Step 1 of 3</span>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight mt-1">Reset your password</h2>
                  <p className="text-slate-500 text-xs mt-1.5 leading-relaxed">
                    Verify your account email to proceed with identity recovery.
                  </p>
                </div>

                <form className="space-y-4" onSubmit={handleStage1Submit}>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-slate-600" htmlFor="primary-email">
                      Administrator email
                    </label>
                    <div className="relative">
                      <input
                        className="w-full h-11 px-4 pr-10 bg-slate-50/90 border border-slate-200/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
                        id="primary-email"
                        name="email"
                        placeholder="admin@company.com"
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
              </section>
            )}

            {/* ==================================================== */}
            {/* STAGE 2: 4 Modes of Recovery                         */}
            {/* ==================================================== */}
            {stage === 2 && (
              <section className="step-content" id="stage-2">
                {/* Account identifier badge */}
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

                {/* 4 Interactive Modes Selection Grid */}
                <div className="grid grid-cols-2 gap-2 mb-5">
                  {/* Mode 1: OTP on current email */}
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('current_otp')}
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
                      <div className="text-xs font-bold text-slate-900">1. Current Email</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">{maskedCurrentEmail || maskEmailPreview(email)}</div>
                    </div>
                  </button>

                  {/* Mode 2: OTP on recovery email */}
                  <button
                    type="button"
                    disabled={!hasRecoveryEmail}
                    onClick={() => handleSwitchMode('recovery_otp')}
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
                      <div className="text-xs font-bold text-slate-900">2. Recovery Email</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                        {hasRecoveryEmail ? maskedRecoveryEmail : 'Not configured'}
                      </div>
                    </div>
                  </button>

                  {/* Mode 3: Authenticator app OTP */}
                  <button
                    type="button"
                    disabled={!hasTotp}
                    onClick={() => handleSwitchMode('totp')}
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
                        {hasTotp ? '2FA' : 'Disabled'}
                      </span>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">3. Authenticator OTP</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                        {hasTotp ? 'Google / Authy' : 'Not enabled'}
                      </div>
                    </div>
                  </button>

                  {/* Mode 4: Recovery questions */}
                  <button
                    type="button"
                    disabled={!hasSecurityQuestions}
                    onClick={() => handleSwitchMode('questions')}
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
                        {hasSecurityQuestions ? '3 Setup' : 'None'}
                      </span>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-900">4. Questions</div>
                      <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                        {hasSecurityQuestions ? '3 Questions' : 'Not configured'}
                      </div>
                    </div>
                  </button>
                </div>

                {/* ==================================================== */}
                {/* ACTIVE VERIFICATION PANEL FOR SELECTED MODE          */}
                {/* ==================================================== */}

                {/* MODE 1: OTP on Current Email */}
                {recoveryMode === 'current_otp' && (
                  <form className="space-y-4" onSubmit={handleVerifyEmailOtp}>
                    <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center justify-between text-xs text-slate-700">
                      <div className="flex items-center gap-2 truncate">
                        <Mail size={15} className="text-indigo-600 shrink-0" />
                        <span className="truncate">
                          Destination: <strong className="text-slate-900 font-semibold">{maskedCurrentEmail || maskEmailPreview(email)}</strong>
                        </span>
                      </div>
                      <button
                        className="text-indigo-600 hover:underline font-semibold text-[11px] disabled:opacity-50 shrink-0 cursor-pointer border-none bg-transparent"
                        onClick={() => handleSendOtp('current')}
                        disabled={otpCooldown > 0 || sendingOtp}
                        type="button"
                      >
                        {sendingOtp ? 'Sending...' : otpCooldown > 0 && otpSentTarget === 'current' ? `Resend (${otpCooldown}s)` : 'Send Code'}
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-2 text-center">
                        Enter 6-digit verification code
                      </label>
                      <div className="grid grid-cols-6 gap-2" onPaste={handleDigitPaste}>
                        {digits.map((d, i) => (
                          <input
                            key={i}
                            ref={(el) => (digitRefs.current[i] = el)}
                            className="h-11 text-center font-bold text-lg rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 outline-none tabular-nums"
                            maxLength={1}
                            type="text"
                            value={d}
                            onChange={(e) => handleDigitChange(i, e.target.value)}
                            onKeyDown={(e) => handleDigitKeyDown(i, e)}
                          />
                        ))}
                      </div>
                    </div>

                    {otpCooldown > 0 && otpSentTarget === 'current' && (
                      <div className="text-center text-xs text-slate-400">
                        Code sent. Resend in <span className="font-semibold text-slate-700 tabular-nums">00:{otpCooldown < 10 ? `0${otpCooldown}` : otpCooldown}</span>
                      </div>
                    )}

                    <button
                      className="w-full py-3.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer border-none"
                      type="submit"
                      disabled={loading || digits.join('').length !== 6}
                    >
                      {loading ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <>
                          <span>Verify Current Email Code</span>
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  </form>
                )}

                {/* MODE 2: OTP on Recovery Email */}
                {recoveryMode === 'recovery_otp' && (
                  <form className="space-y-4" onSubmit={handleVerifyEmailOtp}>
                    <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center justify-between text-xs text-slate-700">
                      <div className="flex items-center gap-2 truncate">
                        <ShieldAlert size={15} className="text-indigo-600 shrink-0" />
                        <span className="truncate">
                          Destination: <strong className="text-slate-900 font-semibold">{maskedRecoveryEmail}</strong>
                        </span>
                      </div>
                      <button
                        className="text-indigo-600 hover:underline font-semibold text-[11px] disabled:opacity-50 shrink-0 cursor-pointer border-none bg-transparent"
                        onClick={() => handleSendOtp('recovery')}
                        disabled={otpCooldown > 0 || sendingOtp}
                        type="button"
                      >
                        {sendingOtp ? 'Sending...' : otpCooldown > 0 && otpSentTarget === 'recovery' ? `Resend (${otpCooldown}s)` : 'Send Code'}
                      </button>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-2 text-center">
                        Enter 6-digit verification code
                      </label>
                      <div className="grid grid-cols-6 gap-2" onPaste={handleDigitPaste}>
                        {digits.map((d, i) => (
                          <input
                            key={i}
                            ref={(el) => (digitRefs.current[i] = el)}
                            className="h-11 text-center font-bold text-lg rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 outline-none tabular-nums"
                            maxLength={1}
                            type="text"
                            value={d}
                            onChange={(e) => handleDigitChange(i, e.target.value)}
                            onKeyDown={(e) => handleDigitKeyDown(i, e)}
                          />
                        ))}
                      </div>
                    </div>

                    {otpCooldown > 0 && otpSentTarget === 'recovery' && (
                      <div className="text-center text-xs text-slate-400">
                        Code sent. Resend in <span className="font-semibold text-slate-700 tabular-nums">00:{otpCooldown < 10 ? `0${otpCooldown}` : otpCooldown}</span>
                      </div>
                    )}

                    <button
                      className="w-full py-3.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer border-none"
                      type="submit"
                      disabled={loading || digits.join('').length !== 6}
                    >
                      {loading ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <>
                          <span>Verify Recovery Email Code</span>
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  </form>
                )}

                {/* MODE 3: Authenticator App OTP */}
                {recoveryMode === 'totp' && (
                  <form className="space-y-4" onSubmit={handleVerifyTotp}>
                    <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl flex items-center gap-2.5 text-xs text-slate-700">
                      <Smartphone size={16} className="text-indigo-600 shrink-0" />
                      <span>Open your authenticator app (Google Authenticator, Authy, etc.) and enter the current 6-digit code.</span>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-2 text-center">
                        6-digit authenticator code
                      </label>
                      <div className="grid grid-cols-6 gap-2" onPaste={handleDigitPaste}>
                        {digits.map((d, i) => (
                          <input
                            key={i}
                            ref={(el) => (digitRefs.current[i] = el)}
                            className="h-11 text-center font-bold text-lg rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 outline-none tabular-nums"
                            maxLength={1}
                            type="text"
                            value={d}
                            onChange={(e) => handleDigitChange(i, e.target.value)}
                            onKeyDown={(e) => handleDigitKeyDown(i, e)}
                          />
                        ))}
                      </div>
                    </div>

                    <button
                      className="w-full py-3.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer border-none"
                      type="submit"
                      disabled={loading || digits.join('').length !== 6}
                    >
                      {loading ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <>
                          <span>Verify Authenticator Code</span>
                          <ArrowRight size={16} />
                        </>
                      )}
                    </button>
                  </form>
                )}

                {/* MODE 4: Recovery Questions */}
                {recoveryMode === 'questions' && (
                  <form className="space-y-3.5" onSubmit={handleVerifyQuestions}>
                    {questions.length === 0 ? (
                      <div className="text-xs text-slate-500 py-3 text-center">
                        No security questions are configured for this account. Please select an alternate recovery mode above.
                      </div>
                    ) : (
                      questions.map((q, idx) => (
                        <div key={idx}>
                          <label className="block text-[11px] font-medium text-slate-600 mb-1">
                            {idx + 1}. {q}
                          </label>
                          <input
                            className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600 outline-none"
                            placeholder="Your answer"
                            type="text"
                            value={answers[q] || ''}
                            onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
                            required
                          />
                        </div>
                      ))
                    )}

                    {questions.length > 0 && (
                      <button
                        className="w-full py-3.5 px-5 mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer border-none"
                        type="submit"
                        disabled={loading}
                      >
                        {loading ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <>
                            <span>Verify Security Answers</span>
                            <ArrowRight size={16} />
                          </>
                        )}
                      </button>
                    )}
                  </form>
                )}

                <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                  <button
                    className="text-slate-500 hover:text-slate-800 font-medium inline-flex items-center gap-1 cursor-pointer border-none bg-transparent"
                    onClick={() => {
                      setStage(1);
                      setError(null);
                    }}
                    type="button"
                  >
                    <ArrowLeft size={14} />
                    <span>Use a different email</span>
                  </button>
                </div>
              </section>
            )}

            {/* ==================================================== */}
            {/* STAGE 3: Set New Password                            */}
            {/* ==================================================== */}
            {stage === 3 && (
              <section className="step-content" id="stage-3">
                <div className="mb-5">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 block">Identity Confirmed ✓</span>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight mt-0.5">Create new password</h2>
                  <p className="text-slate-500 text-xs mt-1">Set a strong new password for your administrator account.</p>
                </div>

                <form className="space-y-4" onSubmit={handleResetPassword}>
                  {/* New Password */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="new-pass">
                      New password
                    </label>
                    <div className="relative">
                      <input
                        className="w-full pl-3.5 pr-10 py-3 text-sm bg-slate-50/70 border border-slate-200 rounded-xl focus:bg-white focus:border-indigo-600 focus:ring-2 focus:ring-indigo-600/20 text-slate-800 transition outline-none"
                        id="new-pass"
                        required
                        type={showNewPass ? 'text' : 'password'}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                      />
                      <button
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer border-none bg-transparent"
                        onClick={() => setShowNewPass(!showNewPass)}
                        type="button"
                      >
                        {showNewPass ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password */}
                  <div>
                    <label className="block text-xs font-medium text-slate-700 mb-1.5" htmlFor="confirm-pass">
                      Confirm password
                    </label>
                    <div className="relative">
                      <input
                        className={`w-full pl-3.5 pr-10 py-3 text-sm bg-slate-50/70 border rounded-xl focus:bg-white focus:ring-2 text-slate-800 transition outline-none ${passwordsMatch
                            ? 'border-emerald-500 focus:ring-emerald-500/20'
                            : 'border-slate-200 focus:border-indigo-600 focus:ring-indigo-600/20'
                          }`}
                        id="confirm-pass"
                        required
                        type={showConfirmPass ? 'text' : 'password'}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                      <button
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer border-none bg-transparent"
                        onClick={() => setShowConfirmPass(!showConfirmPass)}
                        type="button"
                      >
                        {showConfirmPass ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {passwordsMatch && (
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 mt-1 font-medium">
                        <CheckCircle2 size={13} />
                        <span>Passwords match</span>
                      </div>
                    )}
                  </div>

                  {/* Password Policy Checklist */}
                  <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-100 text-[11px] text-slate-600 space-y-1">
                    <div className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                      <span>✓</span> Minimum 8 characters ({newPassword.length} used)
                    </div>
                    <div className={`flex items-center gap-1.5 ${hasComplexity ? 'text-emerald-600 font-medium' : 'text-slate-400'}`}>
                      <span>✓</span> Includes uppercase, lowercase, numbers & symbols
                    </div>
                  </div>

                  <button
                    className="w-full py-3.5 px-5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white font-semibold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer border-none"
                    type="submit"
                    disabled={loading}
                  >
                    {loading ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <>
                        <span>Save new password</span>
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </form>

                <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
                  <button
                    className="text-slate-500 hover:text-slate-800 font-medium inline-flex items-center gap-1 cursor-pointer border-none bg-transparent"
                    onClick={() => {
                      setStage(2);
                      setError(null);
                    }}
                    type="button"
                  >
                    <ArrowLeft size={14} />
                    <span>Back to verification</span>
                  </button>
                </div>
              </section>
            )}

            {/* ==================================================== */}
            {/* STAGE 4: Confirmation / Success                      */}
            {/* ==================================================== */}
            {stage === 4 && (
              <section className="step-content text-center" id="stage-4">
                <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 size={32} />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Password reset complete</h2>
                <p className="text-slate-500 text-xs mt-2 leading-relaxed">
                  Your password has been successfully updated. You can now sign in with your new credentials.
                </p>

                <div className="my-6 p-3.5 bg-slate-50 border border-slate-100 rounded-xl text-left text-xs space-y-1.5 text-slate-600">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Account:</span>
                    <span className="font-medium text-slate-800">{maskedCurrentEmail || maskEmailPreview(email)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Status:</span>
                    <span className="text-emerald-600 font-medium">Password Updated</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Security:</span>
                    <span className="text-emerald-600 font-medium">Existing sessions invalidated</span>
                  </div>
                </div>

                <button
                  className="w-full py-3.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all flex items-center justify-center gap-2 group cursor-pointer border-none"
                  onClick={onBackToLogin}
                  type="button"
                >
                  <span>Sign in</span>
                  <ArrowRight size={16} className="transition-transform group-hover:translate-x-0.5" />
                </button>
              </section>
            )}
          </div>
        </section>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full px-8 py-5 text-center text-xs text-slate-400" data-purpose="copyright">
        Toowix Mail Platform. All rights reserved.
      </footer>
    </div>
  );
};
