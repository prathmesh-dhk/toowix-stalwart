import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import toowixLogo from '../assets/toowix-logo.svg';
import {
  AlertCircle,
  Eye,
  EyeOff,
  CheckCircle2,
} from 'lucide-react';

interface RegisterViewProps {
  onBackToLogin: () => void;
}

const SECURITY_QUESTIONS_POOL = [
  'What was the name of your first pet?',
  'In what city were you born?',
  'What was your high school mascot?',
  'What was the make and model of your first car?',
  'In what city did you get your first job?',
  'What was the name of the street you grew up on?',
  'What was your childhood nickname?',
  'What was the title of the first album you bought?',
];

export const RegisterView: React.FC<RegisterViewProps> = ({ onBackToLogin }) => {
  // Wizard steps: 1 = Email, 2 = OTP, 3 = Password, 4 = Security Questions, 5 = Success
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: Email
  const [email, setEmail] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);

  // Step 2: OTP
  const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Step 3: Password
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  // Step 4: Security Questions
  const [sq1Question, setSq1Question] = useState(SECURITY_QUESTIONS_POOL[0]);
  const [sq1Answer, setSq1Answer] = useState('');
  const [sq2Question, setSq2Question] = useState(SECURITY_QUESTIONS_POOL[1]);
  const [sq2Answer, setSq2Answer] = useState('');
  const [sq3Question, setSq3Question] = useState(SECURITY_QUESTIONS_POOL[2]);
  const [sq3Answer, setSq3Answer] = useState('');

  // Status
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  // Focus first OTP box on Step 2
  useEffect(() => {
    if (currentStep === 2) {
      setTimeout(() => {
        otpRefs.current[0]?.focus();
      }, 100);
    }
  }, [currentStep]);

  // Password strength calculation
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: 'Empty', color: 'text-slate-400', barColor: 'bg-slate-200', width: '0%' };
    let score = 0;
    if (pass.length >= 8) score++;
    if (pass.length >= 12) score++;
    if (/[A-Z]/.test(pass) && /[a-z]/.test(pass)) score++;
    if (/[0-9]/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;

    if (score <= 1) return { score: 1, label: 'Weak', color: 'text-rose-500', barColor: 'bg-rose-500', width: '25%' };
    if (score <= 3) return { score: 2, label: 'Fair', color: 'text-amber-500', barColor: 'bg-amber-500', width: '50%' };
    if (score === 4) return { score: 3, label: 'Good', color: 'text-indigo-600', barColor: 'bg-indigo-600', width: '75%' };
    return { score: 4, label: 'Strong', color: 'text-emerald-600', barColor: 'bg-emerald-500', width: '100%' };
  };

  const passwordStrength = getPasswordStrength(password);

  // STEP 1: Submit Email
  const handleStep1Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      setError('Please enter a valid administrator email address.');
      return;
    }

    setSendingOtp(true);
    try {
      await api.publicSendContactEmailOtp(cleanEmail);
      setCooldown(60);
      setOtpDigits(['', '', '', '', '', '']);
      setCurrentStep(2);
    } catch (err: any) {
      setError(err.message || 'Failed to send verification code. Please try again.');
    } finally {
      setSendingOtp(false);
    }
  };

  // STEP 2: OTP Handling
  const handleOtpChange = (index: number, val: string) => {
    const char = val.slice(-1);
    const newDigits = [...otpDigits];
    newDigits[index] = char;
    setOtpDigits(newDigits);

    if (char && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').trim().replace(/[^0-9]/g, '').slice(0, 6);
    if (!pasted) return;

    const newDigits = [...otpDigits];
    for (let i = 0; i < pasted.length && i < 6; i++) {
      newDigits[i] = pasted[i];
    }
    setOtpDigits(newDigits);

    const nextIndex = Math.min(pasted.length, 5);
    otpRefs.current[nextIndex]?.focus();
  };

  const handleResendOtp = async () => {
    if (cooldown > 0 || sendingOtp) return;
    setError(null);
    setSendingOtp(true);
    try {
      await api.publicSendContactEmailOtp(email.trim().toLowerCase());
      setCooldown(60);
      setOtpDigits(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    } catch (err: any) {
      setError(err.message || 'Failed to resend verification code.');
    } finally {
      setSendingOtp(false);
    }
  };

  const handleStep2Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const fullCode = otpDigits.join('');
    if (fullCode.length !== 6) {
      setError('Please enter the complete 6-digit verification code.');
      return;
    }

    setVerifyingOtp(true);
    try {
      const res = await api.publicVerifyContactEmailOtp(email.trim().toLowerCase(), fullCode);
      setOtpToken(res.verificationToken);
      setCurrentStep(3);
    } catch (err: any) {
      setError(err.message || 'Invalid or expired verification code.');
    } finally {
      setVerifyingOtp(false);
    }
  };

  // STEP 3: Password Submit
  const handleStep3Submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please verify both fields.');
      return;
    }
    setCurrentStep(4);
  };

  // STEP 4: Security Questions Submit
  const handleStep4Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!sq1Answer.trim()) {
      setError('Please provide an answer for Security Question 1.');
      return;
    }
    if (!sq2Answer.trim()) {
      setError('Please provide an answer for Security Question 2.');
      return;
    }
    if (!sq3Answer.trim()) {
      setError('Please provide an answer for Security Question 3.');
      return;
    }

    const uniqueQuestions = new Set([sq1Question, sq2Question, sq3Question]);
    if (uniqueQuestions.size !== 3) {
      setError('Please select 3 distinct, unique security questions.');
      return;
    }

    if (!otpToken) {
      setError('Email verification expired. Please start again.');
      setCurrentStep(1);
      return;
    }

    setLoading(true);
    try {
      await api.publicRegister({
        email: email.trim().toLowerCase(),
        emailVerificationToken: otpToken,
        password,
        securityQuestions: [
          { question: sq1Question, answer: sq1Answer.trim() },
          { question: sq2Question, answer: sq2Answer.trim() },
          { question: sq3Question, answer: sq3Answer.trim() },
        ],
      });
      setCurrentStep(5);
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please check your details and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="font-sans antialiased text-slate-800 bg-slate-50 min-h-screen relative overflow-x-hidden flex flex-col justify-between selection:bg-indigo-100 selection:text-indigo-900">
      {/* Ambient Background Decor (Identical to Sign In) */}
      <div aria-hidden="true" className="fixed inset-0 pointer-events-none ambient-bg z-0">
        <div className="absolute bottom-[22%] left-[-15%] w-[130%] h-[320px] fluid-ribbon opacity-80"></div>
        <div className="absolute bottom-[18%] -left-10 w-[110%] h-[180px] bg-gradient-to-r from-cyan-200/40 via-indigo-400/35 to-indigo-300/30 blur-3xl opacity-75"></div>
        <div className="absolute top-1/3 left-24 w-3.5 h-3.5 rounded-full bg-indigo-300/60 blur-[1px]"></div>
        <div className="absolute bottom-1/3 left-16 w-5 h-5 rounded-full bg-indigo-200/50 blur-[2px]"></div>
        <div className="absolute top-2/5 left-[42%] w-2.5 h-2.5 rounded-full bg-indigo-200/70"></div>
      </div>

      {/* Main Header (Identical to Sign In) */}
      <header className="relative z-10 w-full px-8 py-6 lg:px-14 flex items-center justify-between" data-purpose="top-navigation">
        <button
          type="button"
          onClick={onBackToLogin}
          className="flex items-center gap-2.5 group outline-none cursor-pointer bg-transparent border-0 p-0 text-left"
          title="Toowix Enterprise Cloud"
        >
          <img
            src={toowixLogo}
            alt="Toowix"
            className="w-8 h-8 object-contain group-hover:scale-105 transition-transform duration-200"
          />
          <span className="text-2xl font-bold tracking-tight text-slate-900 flex items-center">toowix</span>
        </button>
      </header>

      {/* Main Content (Identical 2-column split layout) */}
      <main className="page-content-scaled relative z-10 flex-grow flex items-center justify-center px-6 py-8">
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
          <section aria-label="Registration Panel" className="lg:col-span-6 flex justify-center lg:justify-end">
            <div
              className="frosted-panel rounded-3xl p-8 sm:p-10 w-full max-w-[460px] bg-white/45 backdrop-blur-xl border border-white/70 shadow-xl shadow-slate-900/5 transition-all duration-300"
              data-purpose="register-modal-card"
            >
              {/* Error Alert */}
              {error && (
                <div className="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* ==================================================== */}
              {/* STEP 1: Enter Email                                  */}
              {/* ==================================================== */}
              {currentStep === 1 && (
                <>
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Create your account</h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1">
                      Enter your email address to get started with your organization.
                    </p>
                  </div>

                  <form className="space-y-4" onSubmit={handleStep1Submit}>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600" htmlFor="regEmail">
                        Email
                      </label>
                      <div className="relative">
                        <input
                          className="w-full h-11 px-4 bg-slate-50/90 border border-slate-200/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
                          id="regEmail"
                          name="email"
                          placeholder="abc@mail.com"
                          required
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          autoFocus
                        />
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        className="btn btn-primary btn-lg w-full"
                        id="submitEmailBtn"
                        type="submit"
                        disabled={sendingOtp}
                      >
                        <span>{sendingOtp ? 'Sending code...' : 'Next'}</span>
                      </button>
                    </div>

                    <div className="text-center pt-3">
                      <p className="text-xs text-slate-500">
                        Already have an account?{' '}
                        <button
                          type="button"
                          onClick={onBackToLogin}
                          className="text-indigo-600 hover:text-indigo-700 font-medium hover:underline cursor-pointer"
                        >
                          Sign in
                        </button>
                      </p>
                    </div>
                  </form>
                </>
              )}

              {/* ==================================================== */}
              {/* STEP 2: Email OTP Verification                       */}
              {/* ==================================================== */}
              {currentStep === 2 && (
                <>
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Verify your email</h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1">
                      Enter the 6-digit code sent to <span className="font-semibold text-slate-800">{email}</span>.
                    </p>
                  </div>

                  <form className="space-y-4" onSubmit={handleStep2Submit}>
                    <div className="space-y-2">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-semibold text-slate-700">Verification code</label>
                        <button
                          type="button"
                          onClick={handleResendOtp}
                          disabled={sendingOtp || cooldown > 0}
                          className="text-[11px] text-indigo-600 font-medium hover:underline disabled:opacity-50 cursor-pointer"
                        >
                          {sendingOtp ? 'Sending...' : cooldown > 0 ? `Resend (${cooldown}s)` : 'Resend code'}
                        </button>
                      </div>

                      <div className="grid grid-cols-6 gap-2 sm:gap-2.5" onPaste={handleOtpPaste}>
                        {otpDigits.map((digit, idx) => (
                          <input
                            key={idx}
                            ref={(el) => (otpRefs.current[idx] = el)}
                            className="w-full h-12 text-center text-lg font-bold tabular-nums text-slate-900 bg-slate-50/90 border border-slate-200/80 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all"
                            inputMode="numeric"
                            maxLength={1}
                            type="text"
                            value={digit}
                            onChange={(e) => handleOtpChange(idx, e.target.value)}
                            onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        className="btn btn-primary btn-lg w-full"
                        type="submit"
                        disabled={verifyingOtp || otpDigits.join('').length !== 6}
                      >
                        <span>{verifyingOtp ? 'Verifying...' : 'Next'}</span>
                      </button>
                    </div>

                    <div className="text-center pt-2">
                      <button
                        type="button"
                        className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1 cursor-pointer"
                        onClick={() => {
                          setCurrentStep(1);
                          setError(null);
                        }}
                      >
                        ← Change email
                      </button>
                    </div>
                  </form>
                </>
              )}

              {/* ==================================================== */}
              {/* STEP 3: Set Password                                 */}
              {/* ==================================================== */}
              {currentStep === 3 && (
                <>
                  <div className="mb-6">
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Set your password</h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1">
                      Create a password for your administrator account.
                    </p>
                  </div>

                  <form className="space-y-4" onSubmit={handleStep3Submit}>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600" htmlFor="newPassword">
                        Password
                      </label>
                      <div className="relative">
                        <input
                          className="w-full h-11 px-4 bg-slate-50/90 border border-slate-200/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all pr-10"
                          id="newPassword"
                          name="password"
                          placeholder="••••••••••••"
                          required
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>

                      {password && (
                        <div className="pt-1 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400">Strength:</span>
                            <span className={`font-semibold ${passwordStrength.color}`}>
                              {passwordStrength.label}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all duration-300 ${passwordStrength.barColor}`}
                              style={{ width: passwordStrength.width }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600" htmlFor="confirmPassword">
                        Confirm password
                      </label>
                      <div className="relative">
                        <input
                          className="w-full h-11 px-4 bg-slate-50/90 border border-slate-200/80 rounded-xl text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500 transition-all pr-10"
                          id="confirmPassword"
                          name="confirmPassword"
                          placeholder="••••••••••••"
                          required
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                      {confirmPassword && confirmPassword !== password && (
                        <p className="text-[11px] text-rose-500 font-medium">Passwords do not match.</p>
                      )}
                    </div>

                    <div className="pt-2">
                      <button
                        className="btn btn-primary btn-lg w-full"
                        type="submit"
                        disabled={password.length < 8 || password !== confirmPassword}
                      >
                        <span>Next</span>
                      </button>
                    </div>

                    <div className="text-center pt-2">
                      <button
                        type="button"
                        className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1 cursor-pointer"
                        onClick={() => {
                          setCurrentStep(2);
                          setError(null);
                        }}
                      >
                        ← Back
                      </button>
                    </div>
                  </form>
                </>
              )}

              {/* ==================================================== */}
              {/* STEP 4: Security Questions                           */}
              {/* ==================================================== */}
              {currentStep === 4 && (
                <>
                  <div className="mb-5">
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Security questions</h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1">
                      Select 3 questions to assist with password recovery.
                    </p>
                  </div>

                  <form className="space-y-3.5" onSubmit={handleStep4Submit}>
                    {/* Question 1 */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Question 1</label>
                      <select
                        value={sq1Question}
                        onChange={(e) => setSq1Question(e.target.value)}
                        className="w-full h-10 px-3 bg-slate-50/90 border border-slate-200/80 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                      >
                        {SECURITY_QUESTIONS_POOL.map((q) => (
                          <option key={q} value={q} disabled={q === sq2Question || q === sq3Question}>
                            {q}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        required
                        value={sq1Answer}
                        onChange={(e) => setSq1Answer(e.target.value)}
                        placeholder="Answer 1"
                        className="w-full h-10 px-3 bg-slate-50/90 border border-slate-200/80 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                      />
                    </div>

                    {/* Question 2 */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Question 2</label>
                      <select
                        value={sq2Question}
                        onChange={(e) => setSq2Question(e.target.value)}
                        className="w-full h-10 px-3 bg-slate-50/90 border border-slate-200/80 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                      >
                        {SECURITY_QUESTIONS_POOL.map((q) => (
                          <option key={q} value={q} disabled={q === sq1Question || q === sq3Question}>
                            {q}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        required
                        value={sq2Answer}
                        onChange={(e) => setSq2Answer(e.target.value)}
                        placeholder="Answer 2"
                        className="w-full h-10 px-3 bg-slate-50/90 border border-slate-200/80 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                      />
                    </div>

                    {/* Question 3 */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-600">Question 3</label>
                      <select
                        value={sq3Question}
                        onChange={(e) => setSq3Question(e.target.value)}
                        className="w-full h-10 px-3 bg-slate-50/90 border border-slate-200/80 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                      >
                        {SECURITY_QUESTIONS_POOL.map((q) => (
                          <option key={q} value={q} disabled={q === sq1Question || q === sq2Question}>
                            {q}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        required
                        value={sq3Answer}
                        onChange={(e) => setSq3Answer(e.target.value)}
                        placeholder="Answer 3"
                        className="w-full h-10 px-3 bg-slate-50/90 border border-slate-200/80 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 focus:border-indigo-500"
                      />
                    </div>

                    <div className="pt-2">
                      <button
                        className="btn btn-primary btn-lg w-full"
                        type="submit"
                        disabled={loading || !sq1Answer.trim() || !sq2Answer.trim() || !sq3Answer.trim()}
                      >
                        <span>{loading ? 'Creating account...' : 'Complete registration'}</span>
                      </button>
                    </div>

                    <div className="text-center pt-2">
                      <button
                        type="button"
                        className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition-colors inline-flex items-center gap-1 cursor-pointer"
                        onClick={() => {
                          setCurrentStep(3);
                          setError(null);
                        }}
                      >
                        ← Back
                      </button>
                    </div>
                  </form>
                </>
              )}

              {/* ==================================================== */}
              {/* STEP 5: Success & Direct Login                       */}
              {/* ==================================================== */}
              {currentStep === 5 && (
                <div className="text-center py-2 space-y-4">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 mx-auto shadow-xs">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Registration successful!</h2>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1 leading-relaxed">
                      Your administrator account for <span className="font-semibold text-slate-800">{email}</span> has been created.
                    </p>
                  </div>

                  <div className="pt-3">
                    <button
                      className="btn btn-primary btn-lg w-full"
                      type="button"
                      onClick={onBackToLogin}
                    >
                      <span>Sign in to your organization</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* Main Footer (Identical to Sign In) */}
      <footer className="relative z-10 w-full py-4 text-center text-xs text-slate-400" data-purpose="copyright-footer">
        <p>© 2026 Toowix. All rights reserved.</p>
      </footer>
    </div>
  );
};
