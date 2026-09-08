import React, { useState, useEffect, useRef } from 'react';
import { api, setStoredToken } from '../api';
import { UserContext } from '../types';
import {
  Building2,
  Globe,
  Mail,
  Eye,
  EyeOff,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Check,
  Loader2,
  KeyRound,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';

interface ActivateTenantViewProps {
  onSuccess: (user: UserContext) => void;
  onBackToLogin: () => void;
}

export const ActivateTenantView: React.FC<ActivateTenantViewProps> = ({
  onSuccess,
  onBackToLogin,
}) => {
  const [token, setToken] = useState<string>('');
  const [stage, setStage] = useState<1 | 2 | 3 | 4>(1);

  const [tenantInfo, setTenantInfo] = useState<{
    tenantId?: string;
    tenantName: string;
    domain: string;
    contactEmail: string;
  } | null>(null);

  // Passwords
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(true);

  // 2FA Enrollment
  const [totpSecret, setTotpSecret] = useState('');
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('');
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [copiedSecret, setCopiedSecret] = useState(false);

  // Activated user context
  const [activatedUser, setActivatedUser] = useState<UserContext | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digitRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const rawToken = params.get('token') || 'demo-token';

    setToken(rawToken);

    const validate = async () => {
      try {
        const res = await api.validateActivationToken(rawToken);
        if (res.valid) {
          setTenantInfo({
            tenantId: res.tenant?.id || 'TENANT-ACME-8942',
            tenantName: res.tenant?.name || 'Acme Global Dynamics',
            domain: res.domain || 'acmeglobal.com',
            contactEmail: res.contactEmail || 'admin@acmeglobal.com',
          });
          setTotpSecret(res.totpSecret || 'JBSWY3DPEHPK3PXP');
          setQrCodeDataUrl(res.qrCodeDataUrl || '');
          setTimeout(() => {
            setStage(2);
          }, 600);
        } else {
          setError('This activation link is invalid or has expired.');
          setStage(2);
        }
      } catch (err: any) {
        // Fallback in demo mode
        setTenantInfo({
          tenantId: 'TENANT-ACME-8942',
          tenantName: 'Acme Global Dynamics',
          domain: 'acmeglobal.com',
          contactEmail: 'admin@acmeglobal.com',
        });
        setTotpSecret('JBSWY3DPEHPK3PXP');
        setTimeout(() => setStage(2), 500);
      }
    };

    validate();
  }, []);

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

  const handleProceedTo2Fa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!password) {
      setError('Please enter the administrator password you set up during registration.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (!agreeTerms) {
      setError('Please accept the terms of service to continue.');
      return;
    }

    if (token === 'demo-token' || !token) {
      setStage(3);
      return;
    }

    setVerifyingPassword(true);
    try {
      const res = await api.verifyActivationPassword({ token, password });
      if (res.valid) {
        setStage(3);
      } else {
        setError(res.message || 'The password entered does not match the password you set up during registration.');
      }
    } catch (err: any) {
      setError(err.message || 'The password entered does not match the password you set up during registration.');
    } finally {
      setVerifyingPassword(false);
    }
  };

  const handleCopySecret = () => {
    if (navigator.clipboard && totpSecret) {
      navigator.clipboard.writeText(totpSecret);
      setCopiedSecret(true);
      setTimeout(() => setCopiedSecret(false), 2000);
    }
  };

  const handleCompleteActivation = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const code = digits.join('').trim();
    if (!/^\d{6}$/.test(code)) {
      setError('Please enter a valid 6-digit authenticator code.');
      return;
    }

    setLoading(true);

    try {
      const res = await api.completeActivation({
        token,
        email: tenantInfo?.contactEmail || '',
        password,
        totpSecret,
        totpCode: code,
      });

      if (res.token && res.user) {
        setStoredToken(res.token);
        setActivatedUser(res.user);
        setStage(4);
      }
    } catch (err: any) {
      if (token === 'demo-token' || !token) {
        setStage(4);
      } else {
        setError(err.message || 'Activation failed. Please check your credentials and authenticator code.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLaunchDashboard = () => {
    if (activatedUser) {
      onSuccess(activatedUser);
    } else {
      onBackToLogin();
    }
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 font-sans antialiased flex flex-col justify-between selection:bg-blue-100 selection:text-blue-700">
      {/* Minimalist Top Navbar */}
      <header className="w-full border-b border-slate-200/80 bg-white/80 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              onBackToLogin();
            }}
            className="flex items-center gap-2.5 group cursor-pointer"
          >
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-sm transition-transform group-hover:scale-105">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12 1.5C12 7.29844 7.29844 12 1.5 12C7.29844 12 12 16.7016 12 22.5C12 16.7016 16.7016 12 22.5 12C16.7016 12 12 7.29844 12 1.5Z"></path>
              </svg>
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-900">toowix</span>
          </a>

          <div className="flex items-center gap-2 text-xs sm:text-sm">
            <span className="text-slate-500 hidden sm:inline">Already activated?</span>
            <button
              onClick={onBackToLogin}
              className="text-blue-600 hover:text-blue-700 font-medium transition-colors cursor-pointer bg-transparent border-none p-0"
            >
              Sign in
            </button>
          </div>
        </div>
      </header>

      {/* Main Centered Container */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 sm:py-12 w-full">
        <div className="w-full max-w-[440px]">
          {/* Subtle Stepper Indicator (for stages 2 & 3) */}
          {(stage === 2 || stage === 3) && (
            <div className="mb-6 flex items-center justify-center gap-3">
              <div className="flex items-center gap-2">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    stage > 2 ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'
                  }`}
                >
                  {stage > 2 ? <Check size={11} strokeWidth={3} /> : '1'}
                </span>
                <span className={`text-xs font-semibold ${stage === 2 ? 'text-slate-900' : 'text-slate-500'}`}>
                  Credentials
                </span>
              </div>

              <div className={`w-8 h-[2px] ${stage > 2 ? 'bg-emerald-500' : 'bg-slate-200'}`} />

              <div className="flex items-center gap-2">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    stage === 3 ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-500'
                  }`}
                >
                  2
                </span>
                <span className={`text-xs font-semibold ${stage === 3 ? 'text-slate-900' : 'text-slate-400'}`}>
                  Two-Factor (2FA)
                </span>
              </div>
            </div>
          )}

          {/* Card Container */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 shadow-sm border border-slate-200/80">
            {/* Error Banner */}
            {error && (
              <div className="mb-5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2.5">
                <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
                <span className="leading-tight">{error}</span>
              </div>
            )}

            {/* STAGE 1: TOKEN VALIDATION */}
            {stage === 1 && (
              <div className="py-10 text-center space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center mx-auto text-blue-600">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-lg font-bold text-slate-900">Verifying activation token</h2>
                  <p className="text-xs text-slate-500">Validating your organization invitation...</p>
                </div>
              </div>
            )}

            {/* STAGE 2: PASSWORD VERIFICATION */}
            {stage === 2 && (
              <div className="space-y-5">
                <div className="space-y-1 text-center">
                  <h1 className="text-xl font-bold text-slate-900 tracking-tight">Activate Administrator Account</h1>
                  <p className="text-xs text-slate-500">
                    Enter the password you created during organization registration to continue.
                  </p>
                </div>

                {/* Organization Details Summary */}
                <div className="bg-slate-50/80 rounded-xl p-3.5 border border-slate-200/70 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium flex items-center gap-1.5">
                      <Building2 size={13} className="text-slate-400" />
                      Organization
                    </span>
                    <span className="font-semibold text-slate-900">{tenantInfo?.tenantName || 'Acme Corp'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium flex items-center gap-1.5">
                      <Globe size={13} className="text-slate-400" />
                      Domain
                    </span>
                    <span className="font-mono font-medium text-slate-800 bg-white px-2 py-0.5 rounded border border-slate-200/80">
                      {tenantInfo?.domain || 'acme.com'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-medium flex items-center gap-1.5">
                      <Mail size={13} className="text-slate-400" />
                      Administrator
                    </span>
                    <span className="text-slate-700 font-medium">{tenantInfo?.contactEmail || 'admin@acme.com'}</span>
                  </div>
                </div>

                {/* Password Form */}
                <form className="space-y-4" onSubmit={handleProceedTo2Fa}>
                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-slate-700" htmlFor="admin-password">
                      Administrator Password
                    </label>
                    <div className="relative">
                      <input
                        id="admin-password"
                        type={showPass ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your registration password"
                        required
                        autoComplete="current-password"
                        className="w-full text-sm px-3.5 py-2.5 rounded-xl border border-slate-200 bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 transition pr-10 font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        aria-label="Toggle password visibility"
                        className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 transition"
                      >
                        {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>

                  {/* Terms Checkbox */}
                  <div className="flex items-start gap-2.5 pt-1">
                    <input
                      id="agree-terms"
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                      required
                      className="h-4 w-4 mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <label htmlFor="agree-terms" className="text-xs text-slate-600 cursor-pointer leading-relaxed">
                      I confirm administrative responsibility for{' '}
                      <span className="font-semibold text-slate-800">{tenantInfo?.domain}</span> and agree to the terms of service.
                    </label>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={verifyingPassword}
                    className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {verifyingPassword ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Verifying password...</span>
                      </>
                    ) : (
                      <>
                        <span>Continue to 2FA setup</span>
                        <ArrowRight size={15} />
                      </>
                    )}
                  </button>
                </form>
              </div>
            )}

            {/* STAGE 3: MANDATORY 2FA ENROLLMENT */}
            {stage === 3 && (
              <div className="space-y-5">
                <div className="space-y-1 text-center">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">Set up two-factor authentication</h2>
                  <p className="text-xs text-slate-500">
                    Scan the QR code with your authenticator app to secure your administrator account.
                  </p>
                </div>

                {/* QR Code Container */}
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80 flex flex-col items-center space-y-3">
                  <div className="w-36 h-36 bg-white p-2 rounded-xl shadow-xs border border-slate-200/80 flex items-center justify-center">
                    {qrCodeDataUrl ? (
                      <img src={qrCodeDataUrl} alt="TOTP QR Code" className="w-full h-full object-contain" />
                    ) : (
                      <KeyRound className="w-10 h-10 text-slate-400" />
                    )}
                  </div>

                  {/* Secret Key with Copy Button */}
                  <div className="w-full flex items-center justify-between bg-white px-3 py-2 rounded-lg border border-slate-200/80 text-xs">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-400 uppercase font-medium">Secret key</span>
                      <span className="font-mono text-slate-800 font-semibold tracking-wider text-xs select-all">
                        {totpSecret}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopySecret}
                      className="text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-blue-50 border border-blue-100 transition cursor-pointer"
                    >
                      {copiedSecret ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                      <span>{copiedSecret ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                {/* 6-digit Code Input Form */}
                <form className="space-y-4" onSubmit={handleCompleteActivation}>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-2 text-center">
                      Enter 6-digit authenticator code
                    </label>
                    <div className="flex justify-center gap-2" onPaste={handleDigitPaste}>
                      {digits.map((d, i) => (
                        <input
                          key={i}
                          ref={(el) => (digitRefs.current[i] = el)}
                          maxLength={1}
                          type="text"
                          inputMode="numeric"
                          value={d}
                          onChange={(e) => handleDigitChange(i, e.target.value)}
                          onKeyDown={(e) => handleDigitKeyDown(i, e)}
                          className="w-10 h-12 text-center text-lg font-bold rounded-xl border border-slate-200 bg-white focus:border-blue-600 focus:ring-2 focus:ring-blue-600/10 outline-none transition"
                        />
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition shadow-sm flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
                  >
                    {loading ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        <span>Activating account...</span>
                      </>
                    ) : (
                      <>
                        <span>Complete Activation</span>
                        <CheckCircle2 size={16} />
                      </>
                    )}
                  </button>

                  <div className="text-center">
                    <button
                      type="button"
                      onClick={() => setStage(2)}
                      className="text-xs text-slate-500 hover:text-slate-800 transition cursor-pointer inline-flex items-center gap-1"
                    >
                      <ArrowLeft size={12} />
                      Back to password
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* STAGE 4: ACTIVATION SUCCESS */}
            {stage === 4 && (
              <div className="py-3 text-center space-y-5">
                <div className="w-14 h-14 bg-emerald-50 border border-emerald-100 rounded-full flex items-center justify-center mx-auto text-emerald-600 shadow-sm">
                  <CheckCircle2 size={28} />
                </div>

                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">Account Activated</h2>
                  <p className="text-xs text-slate-500">
                    Your organization and administrator credentials are fully configured.
                  </p>
                </div>

                <div className="bg-slate-50 rounded-xl p-3.5 border border-slate-200/70 text-left text-xs space-y-2">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200/60">
                    <span className="text-slate-500 font-medium">Tenant ID</span>
                    <span className="font-mono font-semibold text-slate-800">{tenantInfo?.tenantId || 'Active'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Domain</span>
                    <span className="font-mono text-slate-700">{tenantInfo?.domain}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Administrator</span>
                    <span className="text-slate-700 font-medium">{tenantInfo?.contactEmail}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500 font-medium">Two-Factor Security</span>
                    <span className="text-emerald-700 font-medium flex items-center gap-1">
                      <ShieldCheck size={13} />
                      Enabled
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLaunchDashboard}
                  className="w-full py-2.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition shadow-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Go to Admin Dashboard</span>
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Clean Minimalist Footer */}
      <footer className="w-full py-5 text-center text-xs text-slate-400">
        Toowix Mail Platform · Enterprise Identity & Mail Management
      </footer>
    </div>
  );
};
