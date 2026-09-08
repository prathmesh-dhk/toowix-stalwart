import React, { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { Button } from './ui/Button';
import { Alert } from './ui/Alert';
import {
  Mail,
  ShieldCheck,
  CheckCircle2,
  Eye,
  EyeOff,
  HelpCircle,
  Smartphone,
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

  // Stage 3 submit
  const handleStage3Submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPassword || newPassword.length < 8) {
      setError('Password must be at least 8 characters long.');
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
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between py-10 px-4 sm:px-6 lg:px-8 font-sans antialiased text-slate-800">
      {/* Brand Header */}
      <div className="w-full max-w-md mx-auto flex items-center justify-between mb-8">
        <div className="flex items-center gap-2.5">
          <img src={toowixLogo} alt="Toowix" className="w-8 h-8 object-contain" />
          <span className="text-lg font-bold tracking-tight text-slate-900">toowix</span>
        </div>
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-white border border-slate-200 text-slate-600 shadow-xs">
          <ShieldCheck size={13} className="text-indigo-600" />
          Password Reset
        </span>
      </div>

      {/* Main Wizard Card */}
      <div className="w-full max-w-[480px] mx-auto bg-white rounded-xl border border-slate-200 shadow-xs p-8">
        {error && (
          <div className="mb-5">
            <Alert type="error" message={error} onClose={() => setError(null)} />
          </div>
        )}

        {/* STAGE 1: Identify Account */}
        {stage === 1 && (
          <div>
            <div className="mb-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-1">Step 1 of 3</div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Reset your password</h1>
              <p className="text-xs text-slate-500 mt-1">Enter your administrator email to verify your identity.</p>
            </div>

            <form onSubmit={handleStage1Submit} className="space-y-4">
              <div>
                <label className="field-label" htmlFor="resetEmail">
                  Administrator email
                </label>
                <input
                  id="resetEmail"
                  type="email"
                  required
                  placeholder="admin@toowix.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-input"
                />
              </div>

              <div className="pt-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  fullWidth
                  loading={loading}
                >
                  Continue
                </Button>
              </div>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={onBackToLogin}
                  className="text-xs text-slate-500 hover:text-indigo-600 font-medium"
                >
                  ← Back to sign in
                </button>
              </div>
            </form>
          </div>
        )}

        {/* STAGE 2: Verification Mode */}
        {stage === 2 && (
          <div>
            <div className="mb-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-1">Step 2 of 3</div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Verify your identity</h1>
              <p className="text-xs text-slate-500 mt-1">Choose an authentication method to prove account ownership.</p>
            </div>

            {/* Method Selectors */}
            <div className="space-y-2 mb-5">
              {hasTotp && (
                <div
                  onClick={() => {
                    setRecoveryMode('totp');
                    setDigits(['', '', '', '', '', '']);
                    setError(null);
                  }}
                  className={`p-3 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-all ${recoveryMode === 'totp' ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Smartphone size={16} className="text-indigo-600" />
                    <div>
                      <div className="font-semibold text-slate-900">Authenticator App (TOTP)</div>
                      <div className="text-slate-500 text-[11px]">Use 6-digit code from your app</div>
                    </div>
                  </div>
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center bg-white ${recoveryMode === 'totp' ? 'border-indigo-600' : 'border-slate-300'
                    }`}>
                    {recoveryMode === 'totp' && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                  </div>
                </div>
              )}

              {hasRecoveryEmail && (
                <div
                  onClick={() => {
                    setRecoveryMode('recovery_otp');
                    setDigits(['', '', '', '', '', '']);
                    setError(null);
                  }}
                  className={`p-3 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-all ${recoveryMode === 'recovery_otp' ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Mail size={16} className="text-indigo-600" />
                    <div>
                      <div className="font-semibold text-slate-900">Secondary Recovery Email</div>
                      <div className="text-slate-500 text-[11px]">{maskedRecoveryEmail || 'Configured recovery address'}</div>
                    </div>
                  </div>
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center bg-white ${recoveryMode === 'recovery_otp' ? 'border-indigo-600' : 'border-slate-300'
                    }`}>
                    {recoveryMode === 'recovery_otp' && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                  </div>
                </div>
              )}

              <div
                onClick={() => {
                  setRecoveryMode('current_otp');
                  setDigits(['', '', '', '', '', '']);
                  setError(null);
                }}
                className={`p-3 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-all ${recoveryMode === 'current_otp' ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'
                  }`}
              >
                <div className="flex items-center gap-2.5">
                  <Mail size={16} className="text-indigo-600" />
                  <div>
                    <div className="font-semibold text-slate-900">Primary Account Email</div>
                    <div className="text-slate-500 text-[11px]">{maskedCurrentEmail || maskEmailPreview(email)}</div>
                  </div>
                </div>
                <div className={`w-4 h-4 rounded-full border flex items-center justify-center bg-white ${recoveryMode === 'current_otp' ? 'border-indigo-600' : 'border-slate-300'
                  }`}>
                  {recoveryMode === 'current_otp' && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                </div>
              </div>

              {hasSecurityQuestions && questions.length > 0 && (
                <div
                  onClick={() => {
                    setRecoveryMode('questions');
                    setError(null);
                  }}
                  className={`p-3 rounded-lg border text-xs cursor-pointer flex items-center justify-between transition-all ${recoveryMode === 'questions' ? 'border-indigo-600 bg-indigo-50/50' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                >
                  <div className="flex items-center gap-2.5">
                    <HelpCircle size={16} className="text-indigo-600" />
                    <div>
                      <div className="font-semibold text-slate-900">Security Questions</div>
                      <div className="text-slate-500 text-[11px]">Answer security challenge questions</div>
                    </div>
                  </div>
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center bg-white ${recoveryMode === 'questions' ? 'border-indigo-600' : 'border-slate-300'
                    }`}>
                    {recoveryMode === 'questions' && <span className="w-2 h-2 rounded-full bg-indigo-600"></span>}
                  </div>
                </div>
              )}
            </div>

            {/* Input Form based on mode */}
            <form onSubmit={handleStage2Submit} className="space-y-4">
              {(recoveryMode === 'current_otp' || recoveryMode === 'recovery_otp') && (
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="field-label mb-0">6-digit email code</label>
                    <button
                      type="button"
                      onClick={() => handleSendOtp(recoveryMode === 'current_otp' ? 'current' : 'recovery')}
                      disabled={sendingOtp || otpCooldown > 0}
                      className="text-[11px] text-indigo-600 hover:text-indigo-700 font-medium disabled:opacity-50"
                    >
                      {sendingOtp ? 'Sending...' : otpCooldown > 0 ? `Resend (${otpCooldown}s)` : 'Send code'}
                    </button>
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
              )}

              {recoveryMode === 'totp' && (
                <div>
                  <label className="field-label">6-digit authenticator code</label>
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
              )}

              {recoveryMode === 'questions' && (
                <div className="space-y-3">
                  {questions.map((q, idx) => (
                    <div key={idx}>
                      <label className="field-label">{q}</label>
                      <input
                        type="text"
                        required
                        className="form-input"
                        placeholder="Your answer"
                        value={answers[q] || ''}
                        onChange={(e) => setAnswers({ ...answers, [q]: e.target.value })}
                      />
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2 flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => setStage(1)}
                >
                  Back
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  fullWidth
                  loading={loading}
                >
                  Verify identity
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* STAGE 3: New Password */}
        {stage === 3 && (
          <div>
            <div className="mb-6">
              <div className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-1">Step 3 of 3</div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Create new password</h1>
              <p className="text-xs text-slate-500 mt-1">Set a secure password for your administrator account.</p>
            </div>

            <form onSubmit={handleStage3Submit} className="space-y-4">
              <div>
                <label className="field-label" htmlFor="newPassword">New password</label>
                <div className="relative">
                  <input
                    id="newPassword"
                    type={showNewPass ? 'text' : 'password'}
                    required
                    minLength={8}
                    placeholder="••••••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="form-input pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPass(!showNewPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showNewPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="confirmPassword">Confirm new password</label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPass ? 'text' : 'password'}
                    required
                    minLength={8}
                    placeholder="••••••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="form-input pr-10 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPass(!showConfirmPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showConfirmPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
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
                  Update password
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* STAGE 4: Success */}
        {stage === 4 && (
          <div className="text-center py-4">
            <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4 border border-emerald-200">
              <CheckCircle2 size={24} />
            </div>
            <h2 className="text-xl font-bold text-slate-900 tracking-tight mb-2">Password reset complete</h2>
            <p className="text-xs text-slate-500 mb-6">
              Your password has been successfully updated. You can now sign in with your new credentials.
            </p>
            <Button
              type="button"
              variant="primary"
              size="md"
              fullWidth
              onClick={onBackToLogin}
            >
              Sign in to console
            </Button>
          </div>
        )}
      </div>

      <footer className="w-full max-w-md mx-auto text-center mt-8 text-xs text-slate-400">
        <p>© 2026 Toowix Platform. All rights reserved.</p>
      </footer>
    </div>
  );
};
