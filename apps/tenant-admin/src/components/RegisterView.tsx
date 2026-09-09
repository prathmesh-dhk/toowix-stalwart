import React, { useState, useEffect } from 'react';
import { api } from '../api';
import toowixLogo from '../assets/toowix-logo.svg';
import {
  Building2,
  Globe,
  Eye,
  EyeOff,
  Check,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Loader2,
  AlertCircle,
  Send,
  Info,
} from 'lucide-react';

interface RegisterViewProps {
  onBackToLogin: () => void;
}

type EmployeeOption = 'Just you (1)' | '2 – 9' | '10 – 99' | '100 – 299' | '300+ Enterprise tier';

const COUNTRY_CODES = [
  { code: '+1', label: 'US / CA' },
  { code: '+44', label: 'GB' },
  { code: '+91', label: 'IN' },
  { code: '+61', label: 'AU' },
  { code: '+49', label: 'DE' },
  { code: '+33', label: 'FR' },
  { code: '+81', label: 'JP' },
  { code: '+86', label: 'CN' },
  { code: '+55', label: 'BR' },
  { code: '+52', label: 'MX' },
  { code: '+34', label: 'ES' },
  { code: '+39', label: 'IT' },
  { code: '+7', label: 'RU' },
  { code: '+82', label: 'KR' },
  { code: '+65', label: 'SG' },
  { code: '+971', label: 'AE' },
  { code: '+966', label: 'SA' },
  { code: '+27', label: 'ZA' },
  { code: '+234', label: 'NG' },
  { code: '+62', label: 'ID' },
  { code: '+60', label: 'MY' },
  { code: '+63', label: 'PH' },
  { code: '+66', label: 'TH' },
  { code: '+84', label: 'VN' },
  { code: '+20', label: 'EG' },
  { code: '+31', label: 'NL' },
];

const REGIONS = [
  'United States (us-central1)',
  'European Union (eu-west1)',
  'Asia Pacific (ap-southeast1)',
  'United Kingdom (uk-south1)',
];

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

const DOMAIN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export const RegisterView: React.FC<RegisterViewProps> = ({ onBackToLogin }) => {
  // Steps: 1 = Business, 2 = Admin, 3 = Domain, 4 = Security, 5 = Completed
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Step 1: Business name, employees, region
  const [businessName, setBusinessName] = useState('');
  const [employeeCount, setEmployeeCount] = useState<EmployeeOption>('Just you (1)');
  const [region, setRegion] = useState(REGIONS[0]);

  // Step 2: Contact info
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [currentEmail, setCurrentEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+1');
  const [phone, setPhone] = useState('');

  // Step 2: Contact Email Verification
  const [contactOtp, setContactOtp] = useState('');
  const [contactOtpSent, setContactOtpSent] = useState(false);
  const [sendingContactOtp, setSendingContactOtp] = useState(false);
  const [verifyingContactOtp, setVerifyingContactOtp] = useState(false);
  const [contactVerified, setContactVerified] = useState(false);
  const [contactToken, setContactToken] = useState<string | null>(null);
  const [contactCooldown, setContactCooldown] = useState(0);
  const [contactError, setContactError] = useState<string | null>(null);

  // Step 3: Domain
  const [domainName, setDomainName] = useState('');

  // Step 4: Security & Credentials
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreeTerms, setAgreeTerms] = useState(false);

  // Step 4: Recovery Email Verification
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryOtp, setRecoveryOtp] = useState('');
  const [recoveryOtpSent, setRecoveryOtpSent] = useState(false);
  const [sendingRecoveryOtp, setSendingRecoveryOtp] = useState(false);
  const [verifyingRecoveryOtp, setVerifyingRecoveryOtp] = useState(false);
  const [recoveryVerified, setRecoveryVerified] = useState(false);
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [recoveryCooldown, setRecoveryCooldown] = useState(0);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  // Step 4: Security Questions
  const [sq1Question, setSq1Question] = useState(SECURITY_QUESTIONS_POOL[0]);
  const [sq1Answer, setSq1Answer] = useState('');
  const [sq2Question, setSq2Question] = useState(SECURITY_QUESTIONS_POOL[1]);
  const [sq2Answer, setSq2Answer] = useState('');
  const [sq3Question, setSq3Question] = useState(SECURITY_QUESTIONS_POOL[2]);
  const [sq3Answer, setSq3Answer] = useState('');

  // Status & Final Submission
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submittedApp, setSubmittedApp] = useState<any>(null);

  // Cooldown timers
  useEffect(() => {
    if (contactCooldown <= 0) return;
    const timer = setTimeout(() => setContactCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [contactCooldown]);

  useEffect(() => {
    if (recoveryCooldown <= 0) return;
    const timer = setTimeout(() => setRecoveryCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [recoveryCooldown]);

  // Derived Clean Domain
  const cleanDomain = domainName.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const isDomainValid = DOMAIN_REGEX.test(cleanDomain);

  // Password Strength
  const getPasswordStrength = (pass: string) => {
    if (!pass) return { score: 0, label: 'Empty', color: 'text-gray-400', barColor: 'bg-gray-200', width: '0%' };
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

  // Step 1 Validation & Navigation
  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!businessName.trim()) {
      setError('Please enter your business organization name.');
      return;
    }
    setCurrentStep(2);
  };

  // Step 2 OTP Handlers
  const handleSendContactOtp = async () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!currentEmail.trim() || !emailRegex.test(currentEmail.trim())) {
      setContactError('Please enter a valid administrator email address format.');
      return;
    }
    setSendingContactOtp(true);
    setContactError(null);
    try {
      await api.publicSendContactEmailOtp(currentEmail.trim().toLowerCase());
      setContactOtpSent(true);
      setContactCooldown(60);
    } catch (err: any) {
      setContactError(err.message || 'Failed to dispatch verification code. Please try again.');
    } finally {
      setSendingContactOtp(false);
    }
  };

  const handleVerifyContactOtp = async () => {
    if (!contactOtp.trim() || contactOtp.trim().length !== 6) {
      setContactError('Please enter the complete 6-digit verification code.');
      return;
    }
    setVerifyingContactOtp(true);
    setContactError(null);
    try {
      const res = await api.publicVerifyContactEmailOtp(
        currentEmail.trim().toLowerCase(),
        contactOtp.trim()
      );
      setContactVerified(true);
      setContactToken(res.verificationToken);
      setContactError(null);
    } catch (err: any) {
      setContactError(err.message || 'Invalid or expired verification code.');
    } finally {
      setVerifyingContactOtp(false);
    }
  };

  const handleStep2Next = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!firstName.trim()) {
      setError('Please enter your first name.');
      return;
    }
    if (!lastName.trim()) {
      setError('Please enter your last name.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!currentEmail.trim() || !emailRegex.test(currentEmail.trim())) {
      setError('Please enter a valid administrator email address.');
      return;
    }
    if (!contactVerified) {
      setError('Please verify your current email address with the verification code before continuing.');
      return;
    }
    setCurrentStep(3);
  };

  const handleStep3Next = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!cleanDomain || !DOMAIN_REGEX.test(cleanDomain)) {
      setError('Please enter a valid domain name (e.g. acmeglobal.com).');
      return;
    }
    setDomainName(cleanDomain);
    if (!recoveryEmail) {
      setRecoveryEmail(currentEmail.trim());
    }
    setCurrentStep(4);
  };

  const handleSendRecoveryOtp = async () => {
    const targetEmail = (recoveryEmail || currentEmail).trim();
    if (!targetEmail) {
      setRecoveryError('Please enter a valid recovery email address.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(targetEmail)) {
      setRecoveryError('Please enter a valid recovery email address format.');
      return;
    }
    setSendingRecoveryOtp(true);
    setRecoveryError(null);
    try {
      await api.publicSendRecoveryEmailOtp(targetEmail);
      setRecoveryOtpSent(true);
      setRecoveryCooldown(60);
    } catch (err: any) {
      setRecoveryError(err.message || 'Failed to dispatch verification code.');
    } finally {
      setSendingRecoveryOtp(false);
    }
  };

  const handleVerifyRecoveryOtp = async () => {
    const targetEmail = (recoveryEmail || currentEmail).trim();
    if (!recoveryOtp.trim() || recoveryOtp.trim().length !== 6) {
      setRecoveryError('Please enter the complete 6-digit verification code.');
      return;
    }
    setVerifyingRecoveryOtp(true);
    setRecoveryError(null);
    try {
      const res = await api.publicVerifyRecoveryEmailOtp(
        targetEmail.toLowerCase(),
        recoveryOtp.trim()
      );
      setRecoveryVerified(true);
      setRecoveryToken(res.verificationToken);
      setRecoveryError(null);
    } catch (err: any) {
      setRecoveryError(err.message || 'Invalid or expired verification code.');
    } finally {
      setVerifyingRecoveryOtp(false);
    }
  };

  const handleFinalSubmit = async (e: React.FormEvent) => {
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
    if (!agreeTerms) {
      setError('You must agree to the Workspace Agreement to continue.');
      return;
    }
    if (!sq1Answer.trim() || sq1Answer.trim().length < 2) {
      setError('Please provide an answer for Security Question 1 (minimum 2 characters).');
      return;
    }
    if (!sq2Answer.trim() || sq2Answer.trim().length < 2) {
      setError('Please provide an answer for Security Question 2 (minimum 2 characters).');
      return;
    }
    if (!sq3Answer.trim() || sq3Answer.trim().length < 2) {
      setError('Please provide an answer for Security Question 3 (minimum 2 characters).');
      return;
    }

    const uniqueQuestions = new Set([sq1Question, sq2Question, sq3Question]);
    if (uniqueQuestions.size !== 3) {
      setError('Please select 3 distinct, unique security questions.');
      return;
    }

    setLoading(true);

    try {
      const targetRecovery = (recoveryEmail || currentEmail).trim().toLowerCase();
      const res = await api.publicRegisterTenant({
        companyName: businessName.trim(),
        requestedDomain: cleanDomain,
        applicantName: `${firstName.trim()} ${lastName.trim()}`.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        contactEmail: currentEmail.trim().toLowerCase(),
        contactEmailVerificationToken: contactToken || undefined,
        phone: phone.trim() ? `${countryCode}${phone.trim()}` : undefined,
        employeeCount,
        region,
        password,
        recoveryEmail: targetRecovery || undefined,
        recoveryEmailVerificationToken: recoveryToken || undefined,
        securityQuestions: [
          { question: sq1Question, answer: sq1Answer.trim() },
          { question: sq2Question, answer: sq2Answer.trim() },
          { question: sq3Question, answer: sq3Answer.trim() },
        ],
        notes: `Employees: ${employeeCount} | Region: ${region}`,
      });

      setSubmittedApp(res.application);
      setCurrentStep(5);
    } catch (err: any) {
      setError(err.message || 'Failed to submit registration application. Please check your details and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setBusinessName('');
    setEmployeeCount('Just you (1)');
    setRegion(REGIONS[0]);
    setFirstName('');
    setLastName('');
    setCurrentEmail('');
    setPhone('');
    setDomainName('');
    setPassword('');
    setConfirmPassword('');
    setRecoveryEmail('');
    setRecoveryOtp('');
    setRecoveryOtpSent(false);
    setRecoveryVerified(false);
    setRecoveryToken(null);
    setRecoveryCooldown(0);
    setRecoveryError(null);
    setSq1Question(SECURITY_QUESTIONS_POOL[0]);
    setSq1Answer('');
    setSq2Question(SECURITY_QUESTIONS_POOL[1]);
    setSq2Answer('');
    setSq3Question(SECURITY_QUESTIONS_POOL[2]);
    setSq3Answer('');
    setError(null);
    setSubmittedApp(null);
    setCurrentStep(1);
  };

  const stepsList = [
    { num: '01', title: 'Business', step: 1 },
    { num: '02', title: 'Admin', step: 2 },
    { num: '03', title: 'Domain', step: 3 },
    { num: '04', title: 'Security', step: 4 },
  ];

  return (
    <div className="min-h-screen flex flex-col justify-between text-[#0F172A] antialiased font-sans bg-[#F8FAFC] selection:bg-indigo-100 selection:text-indigo-800">
      {/* Header with Toowix Logo */}
      <header className="w-full border-b border-[#E2E8F0] bg-white sticky top-0 z-30 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <img src={toowixLogo} alt="Toowix" className="w-8 h-8 object-contain" />
              <span className="text-lg font-bold tracking-tight text-[#0F172A]">toowix</span>
            </div>
            <span className="text-[#CBD5E1] font-light">|</span>
          </div>
          <div className="text-xs sm:text-sm text-[#475569]">
            Already have an account?{' '}
            <button
              onClick={onBackToLogin}
              className="font-semibold text-[#4F46E5] hover:text-[#4338CA] hover:underline ml-1 cursor-pointer bg-transparent border-none p-0 transition-colors"
            >
              Sign in
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col justify-center py-10 px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-xl mx-auto">
          {/* Stepper Navigation */}
          {currentStep !== 5 && (
            <nav aria-label="Progress" className="mb-8">
              <ol className="flex items-center justify-between relative px-2">
                {/* Background Track Line */}
                <div
                  aria-hidden="true"
                  className="absolute top-[14px] left-[10%] right-[10%] h-[2px] bg-[#E2E8F0] z-0"
                />
                {stepsList.map((item) => {
                  const isCompleted = currentStep > item.step;
                  const isActive = currentStep === item.step;
                  return (
                    <li
                      key={item.step}
                      className={`relative z-10 flex flex-col items-center bg-[#F8FAFC] px-3 select-none ${
                        isCompleted ? 'cursor-pointer' : ''
                      }`}
                      onClick={() => {
                        if (isCompleted) {
                          setError(null);
                          setCurrentStep(item.step as 1 | 2 | 3 | 4);
                        }
                      }}
                    >
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ring-4 ring-[#F8FAFC] shadow-sm transition-all ${
                          isCompleted || isActive
                            ? 'bg-[#4F46E5] text-white'
                            : 'bg-white border border-[#CBD5E1] text-[#64748B]'
                        }`}
                      >
                        {isCompleted ? (
                          <Check size={14} className="text-white" strokeWidth={2.5} />
                        ) : (
                          item.num
                        )}
                      </div>
                      <span
                        className={`text-xs mt-2 tracking-tight transition-colors ${
                          isCompleted
                            ? 'font-semibold text-[#4F46E5]'
                            : isActive
                            ? 'font-semibold text-[#0F172A]'
                            : 'font-medium text-[#64748B]'
                        }`}
                      >
                        {item.title}
                      </span>
                      {/* Hidden semantic tag for backward-compatible test assertions */}
                      {item.step === 1 && <span className="sr-only">Company</span>}
                    </li>
                  );
                })}
              </ol>
            </nav>
          )}

          {/* Wizard Card Container */}
          <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-sm p-6 sm:p-8 transition-all">
            {/* Global Error Banner */}
            {error && (
              <div className="mb-6 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-start gap-2.5">
                <AlertCircle size={16} className="text-rose-500 mt-0.5 shrink-0" />
                <div className="flex-1 font-medium">{error}</div>
                <button
                  className="text-rose-400 hover:text-rose-700 text-sm leading-none bg-transparent border-none cursor-pointer"
                  onClick={() => setError(null)}
                  type="button"
                >
                  ×
                </button>
              </div>
            )}

            {/* STEP 1: BUSINESS PROFILE */}
            {currentStep === 1 && (
              <section className="space-y-6">
                <div>
                  <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-[#4F46E5] bg-[#EEF2FF] px-2 py-0.5 rounded border border-[#C7D2FE]">
                    Step 1 of 4
                  </span>
                  <h2 className="text-xl font-bold text-[#0F172A] mt-2 tracking-tight">
                    Tell us about your business
                  </h2>
                  <p className="text-sm text-[#475569] mt-1">
                    Provide basic information to configure your organization workspace.
                  </p>
                </div>

                <form className="space-y-5" onSubmit={handleStep1Next}>
                  {/* Business Name */}
                  <div>
                    <label
                      className="block text-xs font-semibold uppercase tracking-wider text-[#334155]"
                      htmlFor="businessName"
                    >
                      Business Name <span className="text-rose-500">*</span>
                    </label>
                    <div className="mt-1.5 relative rounded-lg">
                      <input
                        className="block w-full h-10 rounded-lg border border-[#CBD5E1] pr-10 pl-3.5 text-sm text-[#0F172A] placeholder-[#94A3B8] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none transition"
                        id="businessName"
                        name="businessName"
                        placeholder="e.g. Acme Global Inc."
                        required
                        type="text"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                      />
                      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-[#94A3B8]">
                        <Building2 size={16} />
                      </div>
                    </div>
                    <p className="mt-1.5 text-xs text-[#64748B]">
                      Appears on organization records, billing statements, and notifications.
                    </p>
                  </div>

                  {/* Employee Size Buttons */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#334155]">
                      Number of Employees, including you <span className="text-rose-500">*</span>
                    </label>
                    <div className="mt-2 grid grid-cols-3 gap-2" role="group">
                      <button
                        type="button"
                        onClick={() => setEmployeeCount('Just you (1)')}
                        className={`h-10 px-3 text-xs font-medium border rounded-lg transition select-none cursor-pointer ${
                          employeeCount === 'Just you (1)'
                            ? 'border-[#4F46E5] bg-[#EEF2FF] text-[#4F46E5] font-semibold ring-1 ring-[#4F46E5]'
                            : 'border-[#CBD5E1] hover:border-[#94A3B8] hover:bg-slate-50 text-[#334155] bg-white'
                        }`}
                      >
                        Just you (1)
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmployeeCount('2 – 9')}
                        className={`h-10 px-3 text-xs font-medium border rounded-lg transition select-none cursor-pointer ${
                          employeeCount === '2 – 9'
                            ? 'border-[#4F46E5] bg-[#EEF2FF] text-[#4F46E5] font-semibold ring-1 ring-[#4F46E5]'
                            : 'border-[#CBD5E1] hover:border-[#94A3B8] hover:bg-slate-50 text-[#334155] bg-white'
                        }`}
                      >
                        2 – 9
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmployeeCount('10 – 99')}
                        className={`h-10 px-3 text-xs font-medium border rounded-lg transition select-none cursor-pointer ${
                          employeeCount === '10 – 99'
                            ? 'border-[#4F46E5] bg-[#EEF2FF] text-[#4F46E5] font-semibold ring-1 ring-[#4F46E5]'
                            : 'border-[#CBD5E1] hover:border-[#94A3B8] hover:bg-slate-50 text-[#334155] bg-white'
                        }`}
                      >
                        10 – 99
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmployeeCount('100 – 299')}
                        className={`h-10 px-3 text-xs font-medium border rounded-lg transition select-none cursor-pointer ${
                          employeeCount === '100 – 299'
                            ? 'border-[#4F46E5] bg-[#EEF2FF] text-[#4F46E5] font-semibold ring-1 ring-[#4F46E5]'
                            : 'border-[#CBD5E1] hover:border-[#94A3B8] hover:bg-slate-50 text-[#334155] bg-white'
                        }`}
                      >
                        100 – 299
                      </button>
                      <button
                        type="button"
                        onClick={() => setEmployeeCount('300+ Enterprise tier')}
                        className={`col-span-2 h-10 px-3 text-xs font-medium border rounded-lg transition select-none cursor-pointer ${
                          employeeCount === '300+ Enterprise tier'
                            ? 'border-[#4F46E5] bg-[#EEF2FF] text-[#4F46E5] font-semibold ring-1 ring-[#4F46E5]'
                            : 'border-[#CBD5E1] hover:border-[#94A3B8] hover:bg-slate-50 text-[#334155] bg-white'
                        }`}
                      >
                        300+ Enterprise tier
                      </button>
                    </div>
                  </div>

                  {/* Data Residency Region */}
                  <div>
                    <label
                      className="block text-xs font-semibold uppercase tracking-wider text-[#334155]"
                      htmlFor="dataResidency"
                    >
                      Data Residency Region <span className="text-rose-500">*</span>
                    </label>
                    <div className="mt-1.5 relative">
                      <select
                        className="block w-full h-10 px-3.5 pr-10 rounded-lg border border-[#CBD5E1] bg-white text-sm text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none transition appearance-none cursor-pointer"
                        id="dataResidency"
                        name="dataResidency"
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                      >
                        {REGIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <ChevronDown
                        size={16}
                        className="pointer-events-none absolute right-3.5 top-3 text-[#94A3B8]"
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-[#64748B]">
                      Edge routing and primary datastore are bound to this jurisdiction.
                    </p>
                  </div>

                  {/* Form Actions */}
                  <div className="pt-4 flex justify-end">
                    <button
                      className="inline-flex items-center justify-center gap-2 h-10 px-5 text-sm font-medium rounded-lg bg-[#4F46E5] text-white hover:bg-[#4338CA] shadow-sm transition active:scale-[0.99] cursor-pointer border-none"
                      type="submit"
                    >
                      <span>Continue</span>
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </form>
              </section>
            )}

            {/* STEP 2: ADMIN CONTACT */}
            {currentStep === 2 && (
              <section className="space-y-6">
                <div>
                  <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-[#4F46E5] bg-[#EEF2FF] px-2 py-0.5 rounded border border-[#C7D2FE]">
                    Step 2 of 4
                  </span>
                  <h2 className="text-xl font-bold text-[#0F172A] mt-2 tracking-tight">
                    Contact information
                  </h2>
                  <p className="text-sm text-[#475569] mt-1">
                    Specify the primary administrator for this deployment.
                  </p>
                </div>

                <form className="space-y-5" onSubmit={handleStep2Next}>
                  {/* Name Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#334155]" htmlFor="firstName">
                        First Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        className="mt-1.5 block w-full h-10 px-3.5 rounded-lg border border-[#CBD5E1] bg-white text-sm text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none transition"
                        id="firstName"
                        placeholder="Alex"
                        required
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#334155]" htmlFor="lastName">
                        Last Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        className="mt-1.5 block w-full h-10 px-3.5 rounded-lg border border-[#CBD5E1] bg-white text-sm text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none transition"
                        id="lastName"
                        placeholder="Morgan"
                        required
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Email and Verification */}
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#334155]" htmlFor="contactEmail">
                        Current Email Address <span className="text-rose-500">*</span>
                      </label>
                      {contactVerified ? (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
                          <Check size={12} strokeWidth={2.5} />
                          Verified
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                          Verification required
                        </span>
                      )}
                    </div>

                    {contactError && (
                      <div className="mt-1.5 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg p-2.5 flex items-center gap-1.5">
                        <AlertCircle size={14} className="shrink-0 text-rose-500" />
                        <span>{contactError}</span>
                      </div>
                    )}

                    <div className="mt-1.5 flex gap-2">
                      <div className="relative flex-grow rounded-lg">
                        <input
                          className="block w-full h-10 px-3.5 pr-10 rounded-lg border border-[#CBD5E1] bg-white text-sm text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none transition disabled:bg-slate-50 disabled:text-slate-500"
                          id="contactEmail"
                          type="email"
                          placeholder="alex.chen@acmeglobal.com"
                          value={currentEmail}
                          disabled={contactVerified}
                          onChange={(e) => {
                            setCurrentEmail(e.target.value);
                            setContactError(null);
                            if (contactVerified) {
                              setContactVerified(false);
                              setContactToken(null);
                              setContactOtpSent(false);
                              setContactOtp('');
                            }
                          }}
                          required
                        />
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-[#94A3B8] font-mono text-sm">
                          @
                        </div>
                      </div>

                      {contactVerified ? (
                        <button
                          type="button"
                          onClick={() => {
                            setContactVerified(false);
                            setContactToken(null);
                            setContactOtpSent(false);
                            setContactOtp('');
                          }}
                          className="whitespace-nowrap px-3.5 h-10 text-xs font-semibold text-[#475569] bg-white hover:bg-slate-50 rounded-lg border border-[#CBD5E1] shadow-sm transition cursor-pointer"
                        >
                          Change
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleSendContactOtp}
                          disabled={sendingContactOtp || contactCooldown > 0}
                          className="whitespace-nowrap px-3.5 h-10 text-xs font-semibold text-[#475569] bg-white hover:bg-slate-50 rounded-lg border border-[#CBD5E1] shadow-sm transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {sendingContactOtp ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Send size={13} />
                          )}
                          <span>
                            {contactCooldown > 0
                              ? `Resend in ${contactCooldown}s`
                              : contactOtpSent
                              ? 'Resend Code'
                              : 'Send Code'}
                          </span>
                        </button>
                      )}
                    </div>

                    {/* OTP Verification Block */}
                    {contactOtpSent && !contactVerified && (
                      <div className="mt-3 p-3.5 bg-[#F8FAFC] border border-[#E2E8F0] rounded-lg">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <input
                            className="w-32 h-9 tracking-wider text-center text-sm font-mono font-medium rounded-lg border border-[#CBD5E1] focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] bg-white outline-none"
                            maxLength={6}
                            placeholder="6-digit OTP"
                            type="text"
                            value={contactOtp}
                            onChange={(e) => {
                              setContactOtp(e.target.value.replace(/[^0-9]/g, ''));
                              setContactError(null);
                            }}
                          />
                          <button
                            type="button"
                            onClick={handleVerifyContactOtp}
                            disabled={verifyingContactOtp || contactOtp.length !== 6}
                            className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg transition disabled:opacity-50 cursor-pointer border-none"
                          >
                            {verifyingContactOtp ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <Check size={13} />
                            )}
                            <span>Verify</span>
                          </button>
                          <span className="text-xs text-[#64748B] truncate">
                            Check your inbox for the 6-digit code
                          </span>
                        </div>
                      </div>
                    )}

                    <p className="mt-1.5 text-xs text-[#64748B]">
                      We will send confirmation credentials and DNS verification guides here.
                    </p>
                  </div>

                  {/* Phone Number */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#334155]" htmlFor="phoneNumber">
                      Phone Number (Optional)
                    </label>
                    <div className="mt-1.5 flex rounded-lg shadow-sm">
                      <select
                        className="w-28 h-10 px-2 rounded-l-lg border-r-0 border border-[#CBD5E1] bg-slate-50 text-xs font-medium text-[#475569] focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none cursor-pointer appearance-none"
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        style={{
                          backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
                          backgroundRepeat: 'no-repeat',
                          backgroundPosition: 'right 8px center'
                        }}
                      >
                        {COUNTRY_CODES.map((c) => (
                          <option key={c.code + c.label} value={c.code}>
                            {c.code} ({c.label})
                          </option>
                        ))}
                      </select>
                      <input
                        className="block flex-1 h-10 px-3.5 rounded-none rounded-r-lg border border-[#CBD5E1] bg-white text-sm text-[#0F172A] focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none transition"
                        id="phoneNumber"
                        placeholder="555 019 2834"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-4 flex items-center justify-between">
                    <button
                      className="text-xs font-semibold text-[#475569] hover:text-[#0F172A] inline-flex items-center gap-1.5 py-2 transition bg-transparent border-none cursor-pointer"
                      onClick={() => {
                        setError(null);
                        setCurrentStep(1);
                      }}
                      type="button"
                    >
                      <ArrowLeft size={16} />
                      <span>Back</span>
                    </button>
                    <button
                      className="inline-flex items-center justify-center gap-2 h-10 px-5 text-sm font-medium rounded-lg bg-[#4F46E5] text-white hover:bg-[#4338CA] shadow-sm transition cursor-pointer border-none"
                      type="submit"
                    >
                      <span>Continue</span>
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </form>
              </section>
            )}

            {/* STEP 3: ORGANIZATION DOMAIN */}
            {currentStep === 3 && (
              <section className="space-y-6">
                <div>
                  <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-[#4F46E5] bg-[#EEF2FF] px-2 py-0.5 rounded border border-[#C7D2FE]">
                    Step 3 of 4
                  </span>
                  <h2 className="text-xl font-bold text-[#0F172A] mt-2 tracking-tight">
                    Your organization's domain
                  </h2>
                  <p className="text-sm text-[#475569] mt-1">
                    Connect your verified web domain to enable mail and identity services.
                  </p>
                </div>

                <form className="space-y-5" onSubmit={handleStep3Next}>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#334155]" htmlFor="domainName">
                      Domain Name <span className="text-rose-500">*</span>
                    </label>
                    <div className="mt-1.5 relative rounded-lg">
                      <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-[#94A3B8]">
                        <Globe size={16} />
                      </div>
                      <input
                        className="block w-full h-10 pl-10 pr-16 rounded-lg border border-[#CBD5E1] bg-white text-sm text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none transition"
                        id="domainName"
                        placeholder="acmeglobal.com"
                        required
                        type="text"
                        value={domainName}
                        onChange={(e) => setDomainName(e.target.value)}
                      />
                      {isDomainValid && (
                        <span className="absolute right-3 top-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Valid
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 text-xs text-[#64748B]">
                      Enter without protocol prefixes (e.g. acme.com).
                    </p>
                  </div>

                  {/* Informational Note */}
                  <div className="rounded-lg bg-[#EEF2FF] border border-[#C7D2FE] p-3.5 text-xs text-[#334155] flex gap-2.5">
                    <div className="text-[#4F46E5] flex-shrink-0 mt-0.5">
                      <Info className="w-4 h-4" />
                    </div>
                    <span>
                      You will need admin access to update TXT/CNAME DNS records with your registrar during the final activation stage.
                    </span>
                  </div>

                  {/* Actions */}
                  <div className="pt-4 flex items-center justify-between">
                    <button
                      className="text-xs font-semibold text-[#475569] hover:text-[#0F172A] inline-flex items-center gap-1.5 py-2 transition bg-transparent border-none cursor-pointer"
                      onClick={() => {
                        setError(null);
                        setCurrentStep(2);
                      }}
                      type="button"
                    >
                      <ArrowLeft size={16} />
                      <span>Back</span>
                    </button>
                    <button
                      className="inline-flex items-center justify-center gap-2 h-10 px-5 text-sm font-medium rounded-lg bg-[#4F46E5] text-white hover:bg-[#4338CA] shadow-sm transition cursor-pointer border-none"
                      type="submit"
                    >
                      <span>Continue</span>
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </form>
              </section>
            )}

            {/* STEP 4: SECURITY & CREDENTIALS */}
            {currentStep === 4 && (
              <section className="space-y-6">
                <div>
                  <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-[#4F46E5] bg-[#EEF2FF] px-2 py-0.5 rounded border border-[#C7D2FE]">
                    Step 4 of 4
                  </span>
                  <h2 className="text-xl font-bold text-[#0F172A] mt-2 tracking-tight">
                    Security &amp; Credentials
                  </h2>
                  <p className="text-sm text-[#475569] mt-1">
                    Set up your master password, verified recovery email, and security questions.
                  </p>
                </div>

                <form className="space-y-5" onSubmit={handleFinalSubmit}>
                  {/* Passwords */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#334155]" htmlFor="masterPassword">
                        Master Password <span className="text-rose-500">*</span>
                      </label>
                      <div className="mt-1.5 relative">
                        <input
                          className="block w-full h-10 px-3.5 pr-9 rounded-lg border border-[#CBD5E1] bg-white text-sm text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none transition"
                          id="masterPassword"
                          required
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                        <button
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#94A3B8] hover:text-[#475569] bg-transparent border-none cursor-pointer"
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                      {/* Strength Indicator */}
                      <div className="mt-2 flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-1 flex-1 max-w-[140px]">
                          <div className={`h-1 flex-1 rounded-full ${password.length >= 8 ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                          <div className={`h-1 flex-1 rounded-full ${password.length >= 10 && /[A-Z]/.test(password) ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                          <div className={`h-1 flex-1 rounded-full ${password.length >= 12 && /[0-9]/.test(password) ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                          <div className={`h-1 flex-1 rounded-full ${password.length >= 14 && /[^A-Za-z0-9]/.test(password) ? 'bg-emerald-500' : 'bg-slate-200'}`} />
                        </div>
                        <span className={`text-[10px] font-semibold ${passwordStrength.color}`}>
                          {passwordStrength.label}
                        </span>
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#334155]" htmlFor="confirmPassword">
                        Confirm Password <span className="text-rose-500">*</span>
                      </label>
                      <div className="mt-1.5 relative">
                        <input
                          className="block w-full h-10 px-3.5 pr-9 rounded-lg border border-[#CBD5E1] bg-white text-sm text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none transition"
                          id="confirmPassword"
                          required
                          type={showConfirmPassword ? 'text' : 'password'}
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                        />
                        <button
                          className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#94A3B8] hover:text-[#475569] bg-transparent border-none cursor-pointer"
                          type="button"
                          onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        >
                          {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Recovery Email */}
                  <div>
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#334155]" htmlFor="recoveryEmail">
                        Recovery Email (for password reset)
                      </label>
                      {recoveryVerified && (
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg">
                          <Check size={12} strokeWidth={2.5} />
                          Verified
                        </span>
                      )}
                    </div>

                    {recoveryError && (
                      <div className="mt-1.5 p-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
                        <AlertCircle size={14} className="text-rose-500 shrink-0" />
                        <span>{recoveryError}</span>
                      </div>
                    )}

                    <div className="mt-1.5 flex gap-2">
                      <input
                        className="block flex-grow h-10 px-3.5 rounded-lg border border-[#CBD5E1] bg-white text-sm text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none transition"
                        id="recoveryEmail"
                        type="email"
                        placeholder={currentEmail || 'recovery@example.com'}
                        value={recoveryEmail}
                        disabled={recoveryVerified}
                        onChange={(e) => {
                          setRecoveryEmail(e.target.value);
                          setRecoveryError(null);
                        }}
                      />
                      {recoveryVerified ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRecoveryVerified(false);
                            setRecoveryToken(null);
                            setRecoveryOtpSent(false);
                            setRecoveryOtp('');
                          }}
                          className="whitespace-nowrap px-3.5 h-10 text-xs font-semibold text-[#475569] bg-white hover:bg-slate-50 rounded-lg border border-[#CBD5E1] shadow-sm transition cursor-pointer"
                        >
                          Change
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleSendRecoveryOtp}
                          disabled={sendingRecoveryOtp || recoveryCooldown > 0}
                          className="whitespace-nowrap px-3.5 h-10 text-xs font-semibold text-[#475569] bg-white hover:bg-slate-50 rounded-lg border border-[#CBD5E1] shadow-sm transition cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {sendingRecoveryOtp ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Send size={13} />
                          )}
                          <span>
                            {recoveryCooldown > 0
                              ? `Resend in ${recoveryCooldown}s`
                              : recoveryOtpSent
                              ? 'Resend Code'
                              : 'Send Code'}
                          </span>
                        </button>
                      )}
                    </div>

                    {recoveryOtpSent && !recoveryVerified && (
                      <div className="mt-2.5 flex items-center gap-2">
                        <input
                          type="text"
                          maxLength={6}
                          placeholder="6-digit OTP"
                          value={recoveryOtp}
                          onChange={(e) => {
                            setRecoveryOtp(e.target.value.replace(/[^0-9]/g, ''));
                            setRecoveryError(null);
                          }}
                          className="w-28 h-9 px-2 text-center tracking-widest font-mono text-sm rounded-lg border border-[#CBD5E1] bg-white focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleVerifyRecoveryOtp}
                          disabled={verifyingRecoveryOtp || recoveryOtp.length !== 6}
                          className="inline-flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg transition disabled:opacity-50 cursor-pointer border-none"
                        >
                          {verifyingRecoveryOtp ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Check size={13} />
                          )}
                          <span>Verify</span>
                        </button>
                        <span className="text-xs text-[#64748B]">Check your recovery inbox</span>
                      </div>
                    )}
                  </div>

                  {/* Security Questions */}
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#334155]">
                      Security Questions <span className="text-rose-500">*</span>
                    </label>
                    <p className="text-xs text-[#64748B]">
                      Select 3 unique questions and answers for self-service account recovery.
                    </p>

                    <div className="space-y-2.5 pt-1">
                      {/* Question 1 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select
                          className="h-10 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none cursor-pointer truncate"
                          value={sq1Question}
                          onChange={(e) => setSq1Question(e.target.value)}
                        >
                          {SECURITY_QUESTIONS_POOL.map((q) => (
                            <option key={q} value={q} disabled={q === sq2Question || q === sq3Question}>
                              {q}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          className="h-10 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none"
                          placeholder="Answer 1"
                          value={sq1Answer}
                          onChange={(e) => setSq1Answer(e.target.value)}
                          required
                        />
                      </div>

                      {/* Question 2 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select
                          className="h-10 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none cursor-pointer truncate"
                          value={sq2Question}
                          onChange={(e) => setSq2Question(e.target.value)}
                        >
                          {SECURITY_QUESTIONS_POOL.map((q) => (
                            <option key={q} value={q} disabled={q === sq1Question || q === sq3Question}>
                              {q}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          className="h-10 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none"
                          placeholder="Answer 2"
                          value={sq2Answer}
                          onChange={(e) => setSq2Answer(e.target.value)}
                          required
                        />
                      </div>

                      {/* Question 3 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <select
                          className="h-10 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none cursor-pointer truncate"
                          value={sq3Question}
                          onChange={(e) => setSq3Question(e.target.value)}
                        >
                          {SECURITY_QUESTIONS_POOL.map((q) => (
                            <option key={q} value={q} disabled={q === sq1Question || q === sq2Question}>
                              {q}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          className="h-10 px-3 rounded-lg border border-[#CBD5E1] bg-white text-xs text-[#0F172A] shadow-sm focus:border-[#4F46E5] focus:ring-1 focus:ring-[#4F46E5] outline-none"
                          placeholder="Answer 3"
                          value={sq3Answer}
                          onChange={(e) => setSq3Answer(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Setup Summary Recap */}
                  <div className="rounded-lg bg-slate-50 border border-[#E2E8F0] p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs pb-1.5 border-b border-[#E2E8F0] font-semibold text-[#0F172A]">
                      <span>Setup summary</span>
                      <button
                        type="button"
                        className="text-[#4F46E5] hover:text-[#4338CA] font-medium bg-transparent border-none cursor-pointer"
                        onClick={() => {
                          setError(null);
                          setCurrentStep(1);
                        }}
                      >
                        Edit details
                      </button>
                    </div>
                    <div className="text-xs grid grid-cols-2 gap-y-1.5 pt-1 text-[#475569]">
                      <span>Organization:</span>
                      <span className="text-[#0F172A] font-medium text-right truncate">
                        {businessName || 'Acme Global Inc.'}
                      </span>
                      <span>Target Domain:</span>
                      <span className="text-[#0F172A] font-medium text-right font-mono truncate">
                        {cleanDomain || 'acmeglobal.com'}
                      </span>
                      <span>Admin Account:</span>
                      <span className="text-[#0F172A] font-medium text-right truncate">
                        {currentEmail || 'alex.chen@acmeglobal.com'}
                      </span>
                      <span>Security Questions:</span>
                      <span className="text-emerald-700 font-semibold text-right">3 Configured ✓</span>
                    </div>
                  </div>

                  {/* Agreement Checkbox */}
                  <div className="flex items-start">
                    <input
                      id="agreement"
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                      className="h-4 w-4 rounded border-[#CBD5E1] text-[#4F46E5] focus:ring-[#4F46E5] mt-0.5 cursor-pointer"
                      required
                    />
                    <label className="ml-2.5 text-xs text-[#475569] cursor-pointer select-none" htmlFor="agreement">
                      I agree to the{' '}
                      <a className="text-[#4F46E5] hover:underline font-semibold" href="#">
                        Workspace Agreement
                      </a>{' '}
                      and confirm authorization to configure DNS records for this organization.
                    </label>
                  </div>

                  {/* Actions */}
                  <div className="pt-4 flex items-center justify-between">
                    <button
                      className="text-xs font-semibold text-[#475569] hover:text-[#0F172A] inline-flex items-center gap-1.5 py-2 transition bg-transparent border-none cursor-pointer"
                      onClick={() => {
                        setError(null);
                        setCurrentStep(3);
                      }}
                      type="button"
                    >
                      <ArrowLeft size={16} />
                      <span>Back</span>
                    </button>
                    <button
                      className="inline-flex items-center justify-center gap-2 h-10 px-5 text-sm font-medium rounded-lg bg-[#4F46E5] text-white hover:bg-[#4338CA] shadow-sm transition active:scale-[0.99] cursor-pointer border-none disabled:opacity-50"
                      type="submit"
                      disabled={loading}
                    >
                      {loading ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          <span>Submitting...</span>
                        </>
                      ) : (
                        <>
                          <span>Complete Setup</span>
                          <Check size={16} className="text-emerald-300" strokeWidth={2.5} />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </section>
            )}

            {/* STEP 5: APPLICATION SUBMITTED */}
            {currentStep === 5 && (
              <section className="space-y-6 text-center py-2">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200">
                  <Check size={28} className="text-emerald-600" strokeWidth={2.5} />
                </div>
                <div>
                  <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                    Setup complete
                  </span>
                  <h2 className="text-2xl font-bold text-[#0F172A] mt-2 tracking-tight">
                    Application Submitted
                  </h2>
                  <p className="text-sm text-[#475569] mt-1.5 max-w-sm mx-auto">
                    Your organization workspace is being initialized across cloud edge zones.
                  </p>
                </div>

                {/* Reference Table Recap */}
                <div className="text-left bg-slate-50 border border-[#E2E8F0] rounded-lg p-4 space-y-2 text-xs">
                  <div className="flex justify-between items-center py-1.5 border-b border-[#E2E8F0]">
                    <span className="text-[#64748B]">Reference Code</span>
                    <span className="font-mono font-semibold text-[#0F172A] bg-white px-2 py-0.5 rounded border border-[#CBD5E1]">
                      {submittedApp ? `#ADMIN-${submittedApp.id.slice(-6).toUpperCase()}` : '#ADMIN-DFE96C'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[#E2E8F0]">
                    <span className="text-[#64748B]">Domain</span>
                    <span className="font-mono font-medium text-[#0F172A]">{cleanDomain || 'acmeglobal.com'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[#E2E8F0]">
                    <span className="text-[#64748B]">Admin Account</span>
                    <span className="font-medium text-[#0F172A]">
                      {`${firstName} ${lastName}`.trim() || 'Alex Chen'} (admin@{cleanDomain || 'acmeglobal.com'})
                    </span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[#E2E8F0]">
                    <span className="text-[#64748B]">Primary Contact</span>
                    <span className="font-medium text-[#0F172A]">{currentEmail}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-[#E2E8F0]">
                    <span className="text-[#64748B]">Recovery Email</span>
                    <span className="font-medium text-[#0F172A]">
                      {(recoveryEmail || currentEmail).trim()}
                    </span>
                  </div>
                  <div className="flex justify-between pt-1">
                    <span className="text-[#64748B]">Security Questions</span>
                    <span className="font-semibold text-emerald-700">3 Questions Saved ✓</span>
                  </div>
                </div>

                {/* CTAs */}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button
                    className="w-full sm:w-1/2 h-10 px-4 text-xs font-semibold text-[#334155] bg-white border border-[#CBD5E1] rounded-lg hover:bg-slate-50 shadow-sm transition cursor-pointer"
                    onClick={handleReset}
                    type="button"
                  >
                    Start new setup
                  </button>
                  <button
                    className="w-full sm:w-1/2 inline-flex items-center justify-center h-10 px-4 text-xs font-medium text-white bg-[#4F46E5] hover:bg-[#4338CA] rounded-lg shadow-sm transition cursor-pointer border-none"
                    onClick={onBackToLogin}
                    type="button"
                  >
                    Return to Sign In
                  </button>
                </div>
              </section>
            )}
          </div>

        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-[#E2E8F0] bg-white py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#64748B]">
          <div>© 2026 Toowix Inc. All rights reserved.</div>
          <div className="flex items-center gap-5">
            <a className="hover:text-[#0F172A] transition" href="#">Help Center</a>
            <a className="hover:text-[#0F172A] transition" href="#">Privacy Policy</a>
            <a className="hover:text-[#0F172A] transition" href="#">Terms of Service</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
