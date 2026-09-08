import React, { useState, useEffect } from 'react';
import { api } from '../api';
import {
  Building2,
  Globe,
  Eye,
  EyeOff,
  Check,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  LayoutDashboard,
  AtSign,
  Loader2,
  AlertCircle,
  Send,
} from 'lucide-react';

interface RegisterViewProps {
  onBackToLogin: () => void;
}

type EmployeeOption = 'Just you (1)' | '2 – 9' | '10 – 99' | '100 – 299' | '300+ Enterprise tier';

const EMPLOYEE_OPTIONS: EmployeeOption[] = [
  'Just you (1)',
  '2 – 9',
  '10 – 99',
  '100 – 299',
  '300+ Enterprise tier',
];

const COUNTRY_CODES = [
  { code: '+1', label: 'US / CA', flag: '🇺🇸' },
  { code: '+44', label: 'GB', flag: '🇬🇧' },
  { code: '+91', label: 'IN', flag: '🇮🇳' },
  { code: '+61', label: 'AU', flag: '🇦🇺' },
  { code: '+49', label: 'DE', flag: '🇩🇪' },
  { code: '+33', label: 'FR', flag: '🇫🇷' },
  { code: '+81', label: 'JP', flag: '🇯🇵' },
  { code: '+86', label: 'CN', flag: '🇨🇳' },
  { code: '+55', label: 'BR', flag: '🇧🇷' },
  { code: '+52', label: 'MX', flag: '🇲🇽' },
  { code: '+34', label: 'ES', flag: '🇪🇸' },
  { code: '+39', label: 'IT', flag: '🇮🇹' },
  { code: '+7', label: 'RU', flag: '🇷🇺' },
  { code: '+82', label: 'KR', flag: '🇰🇷' },
  { code: '+65', label: 'SG', flag: '🇸🇬' },
  { code: '+971', label: 'AE', flag: '🇦🇪' },
  { code: '+966', label: 'SA', flag: '🇸🇦' },
  { code: '+27', label: 'ZA', flag: '🇿🇦' },
  { code: '+234', label: 'NG', flag: '🇳🇬' },
  { code: '+62', label: 'ID', flag: '🇮🇩' },
  { code: '+60', label: 'MY', flag: '🇲🇾' },
  { code: '+63', label: 'PH', flag: '🇵🇭' },
  { code: '+66', label: 'TH', flag: '🇹🇭' },
  { code: '+84', label: 'VN', flag: '🇻🇳' },
  { code: '+20', label: 'EG', flag: '🇪🇬' },
  { code: '+31', label: 'NL', flag: '🇳🇱' },
  { code: '+46', label: 'SE', flag: '🇸🇪' },
  { code: '+47', label: 'NO', flag: '🇳🇴' },
  { code: '+45', label: 'DK', flag: '🇩🇰' },
  { code: '+41', label: 'CH', flag: '🇨🇭' },
  { code: '+32', label: 'BE', flag: '🇧🇪' },
  { code: '+48', label: 'PL', flag: '🇵🇱' },
  { code: '+90', label: 'TR', flag: '🇹🇷' },
  { code: '+92', label: 'PK', flag: '🇵🇰' },
  { code: '+880', label: 'BD', flag: '🇧🇩' },
  { code: '+94', label: 'LK', flag: '🇱🇰' },
  { code: '+64', label: 'NZ', flag: '🇳🇿' },
  { code: '+54', label: 'AR', flag: '🇦🇷' },
  { code: '+56', label: 'CL', flag: '🇨🇱' },
  { code: '+57', label: 'CO', flag: '🇨🇴' },
  { code: '+51', label: 'PE', flag: '🇵🇪' },
];

const REGIONS = [
  'United States (us-central1)',
  'United Kingdom (europe-west2)',
  'Germany (europe-west3)',
  'Canada (northamerica-northeast1)',
  'Japan (asia-northeast1)',
  'Singapore (asia-southeast1)',
  'Australia (australia-southeast1)',
  'India (asia-south1)',
];

export const SECURITY_QUESTIONS_POOL = [
  'What was the name of your first pet?',
  'In what city was your first job?',
  'What was your childhood nickname?',
  'What was the model of your first car?',
  "What is your oldest sibling's middle name?",
  'What primary school did you attend?',
  'What was the street you lived on in third grade?',
  'What was the make and model of your first phone?',
  'In what city or town did your parents meet?',
  'What was the name of your favorite teacher in high school?',
];

const DOMAIN_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export const RegisterView: React.FC<RegisterViewProps> = ({ onBackToLogin }) => {
  // Steps: 1 = Company, 2 = Admin, 3 = Domain, 4 = Security, 5 = Completed
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

  // Step 4: Mandatory Security Questions
  const [sq1Question, setSq1Question] = useState(SECURITY_QUESTIONS_POOL[0]);
  const [sq1Answer, setSq1Answer] = useState('');
  const [sq2Question, setSq2Question] = useState(SECURITY_QUESTIONS_POOL[1]);
  const [sq2Answer, setSq2Answer] = useState('');
  const [sq3Question, setSq3Question] = useState(SECURITY_QUESTIONS_POOL[2]);
  const [sq3Answer, setSq3Answer] = useState('');

  // Status & error handling
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [submittedApp, setSubmittedApp] = useState<{
    id: string;
    companyName: string;
    requestedDomain: string;
    createdAt: string;
    status: string;
  } | null>(null);

  // Clean domain and organization preview
  const cleanDomain = domainName.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const isDomainValid = DOMAIN_REGEX.test(cleanDomain);

  // Countdown timer for Recovery OTP resend
  useEffect(() => {
    if (recoveryCooldown > 0) {
      const timer = setTimeout(() => setRecoveryCooldown(recoveryCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [recoveryCooldown]);

  // Countdown timer for Contact OTP resend
  useEffect(() => {
    if (contactCooldown > 0) {
      const timer = setTimeout(() => setContactCooldown(contactCooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [contactCooldown]);

  // Password strength helper
  const getPasswordStrength = (pass: string) => {
    if (pass.length >= 10 && /[A-Z]/.test(pass) && /[!@#$%^&*(),.?":{}|<>]/.test(pass)) {
      return { label: 'Strong', color: 'text-emerald-600', barColor: 'bg-emerald-500', width: '100%' };
    } else if (pass.length >= 6) {
      return { label: 'Moderate', color: 'text-amber-600', barColor: 'bg-amber-500', width: '66%' };
    } else {
      return { label: 'Weak', color: 'text-rose-600', barColor: 'bg-rose-500', width: '33%' };
    }
  };

  const passwordStrength = getPasswordStrength(password);

  // Step navigation guards
  const handleStep1Next = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!businessName.trim()) {
      setError('Please enter your organization business name.');
      return;
    }
    setCurrentStep(2);
  };

  const handleSendContactOtp = async () => {
    const targetEmail = currentEmail.trim();
    if (!targetEmail) {
      setContactError('Please enter a valid email address.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(targetEmail)) {
      setContactError('Please enter a valid email address format.');
      return;
    }
    setSendingContactOtp(true);
    setContactError(null);
    try {
      await api.publicSendContactEmailOtp(targetEmail);
      setContactOtpSent(true);
      setContactCooldown(60);
    } catch (err: any) {
      setContactError(err.message || 'Failed to dispatch verification code.');
    } finally {
      setSendingContactOtp(false);
    }
  };

  const handleVerifyContactOtp = async () => {
    const targetEmail = currentEmail.trim();
    if (!contactOtp.trim() || contactOtp.trim().length !== 6) {
      setContactError('Please enter the 6-digit verification code.');
      return;
    }
    setVerifyingContactOtp(true);
    setContactError(null);
    try {
      const res = await api.publicVerifyContactEmailOtp(targetEmail, contactOtp.trim());
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
      setRecoveryError('Please enter the 6-digit verification code.');
      return;
    }
    setVerifyingRecoveryOtp(true);
    setRecoveryError(null);
    try {
      const res = await api.publicVerifyRecoveryEmailOtp(targetEmail, recoveryOtp.trim());
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

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
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
    { num: '01', title: 'Company', step: 1 },
    { num: '02', title: 'Admin', step: 2 },
    { num: '03', title: 'Domain', step: 3 },
    { num: '04', title: 'Security', step: 4 },
  ];

  return (
    <div className="bg-[#fafafa] text-[#334155] min-h-screen flex flex-col justify-between selection:bg-blue-100 selection:text-blue-700 font-sans">
      {/* Minimalist Header */}
      <header className="w-full border-b border-[#eaedf1] bg-white/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#0f172a] text-white flex items-center justify-center font-semibold text-sm select-none shadow-sm">
              <LayoutDashboard size={18} />
            </div>
            <span className="text-sm font-semibold tracking-tight text-[#0f172a]">Workspace Setup</span>
          </div>
          <div className="flex items-center gap-1 text-xs sm:text-sm">
            <span className="text-[#64748b] hidden sm:inline">Already have an account?</span>
            <button
              onClick={onBackToLogin}
              className="text-blue-600 hover:text-blue-700 font-medium ml-1 transition-colors cursor-pointer bg-transparent border-none p-0"
            >
              Sign in
            </button>
          </div>
        </div>
      </header>

      {/* Main Centered Container */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10 sm:py-14 w-full">
        <div className="w-full max-w-[620px]">
          {/* Elegant Minimal Progress Stepper Tracker */}
          {currentStep !== 5 && (
            <nav aria-label="Progress" className="mb-8">
              <ol className="flex items-center justify-between text-xs font-medium tracking-tight">
                {stepsList.map((item, idx) => {
                  const isCompleted = currentStep > item.step;
                  const isActive = currentStep === item.step;
                  return (
                    <React.Fragment key={item.step}>
                      <li
                        className={`flex items-center gap-2 select-none ${isCompleted ? 'cursor-pointer' : ''}`}
                        onClick={() => {
                          if (isCompleted) {
                            setError(null);
                            setCurrentStep(item.step as 1 | 2 | 3 | 4);
                          }
                        }}
                      >
                        <span
                          className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold transition-all ${isCompleted
                              ? 'bg-emerald-600 text-white'
                              : isActive
                                ? 'bg-[#0f172a] text-white'
                                : 'bg-gray-100 text-[#64748b]'
                            }`}
                        >
                          {isCompleted ? <Check size={13} strokeWidth={3} /> : item.num}
                        </span>
                        <span
                          className={`transition-colors ${isCompleted
                              ? 'text-emerald-700 font-semibold'
                              : isActive
                                ? 'text-[#0f172a] font-semibold'
                                : 'text-[#64748b]'
                            }`}
                        >
                          {item.title}
                        </span>
                      </li>
                      {idx < stepsList.length - 1 && (
                        <span className="h-px flex-1 mx-3 bg-[#eaedf1]"></span>
                      )}
                    </React.Fragment>
                  );
                })}
              </ol>
            </nav>
          )}

          {/* Main Clean Card */}
          <div className="bg-white border border-[#eaedf1] rounded-2xl shadow-[0_4px_24px_-4px_rgba(15,23,42,0.04)] p-8 sm:p-10 transition-all">
            {/* Global Error Banner */}
            {error && (
              <div className="mb-6 p-3.5 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-start gap-2.5">
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

            {/* STEP 1: Company & Scale */}
            {currentStep === 1 && (
              <form onSubmit={handleStep1Next} className="flex flex-col">
                <div className="mb-8">
                  <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">Step 1 of 4</span>
                  <h1 className="text-2xl font-bold tracking-tight text-[#0f172a] mt-1.5">
                    Tell us about your business
                  </h1>
                  <p className="text-sm text-[#64748b] mt-1">
                    Provide basic information to configure your organization workspace.
                  </p>
                </div>

                <div className="space-y-6">
                  {/* Business Name Field */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a] mb-2" htmlFor="businessName">
                      Business name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        className="w-full h-11 px-3.5 pr-10 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-sm focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none transition placeholder:text-gray-400"
                        id="businessName"
                        placeholder="e.g. Acme Global Inc."
                        type="text"
                        value={businessName}
                        onChange={(e) => setBusinessName(e.target.value)}
                        required
                      />
                      <Building2 size={18} className="absolute right-3.5 top-3 text-gray-400 pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-[#64748b] mt-1.5">
                      Appears on organization records, billing statements, and notifications.
                    </p>
                  </div>

                  {/* Employee Size Chips */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a] mb-2.5">
                      Number of employees, including you <span className="text-red-500">*</span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {EMPLOYEE_OPTIONS.map((opt) => {
                        const isSelected = employeeCount === opt;
                        return (
                          <label
                            key={opt}
                            className={`relative flex items-center justify-center p-3 rounded-lg text-xs cursor-pointer transition select-none ${isSelected
                                ? 'border-2 border-[#0f172a] bg-slate-50 font-semibold text-[#0f172a]'
                                : 'border border-[#eaedf1] bg-white hover:border-gray-300 font-medium text-[#334155]'
                              }`}
                          >
                            <input
                              type="radio"
                              name="employees"
                              className="sr-only"
                              value={opt}
                              checked={isSelected}
                              onChange={() => setEmployeeCount(opt)}
                            />
                            <span>{opt}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  {/* Data Residency Region */}
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a] mb-2" htmlFor="regionSelect">
                      Data residency region <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <select
                        className="w-full h-11 px-3.5 pr-10 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-sm focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none transition appearance-none cursor-pointer"
                        id="regionSelect"
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                      >
                        {REGIONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={18} className="absolute right-3.5 top-3 text-gray-400 pointer-events-none" />
                    </div>
                    <p className="text-[11px] text-[#64748b] mt-1.5">
                      Edge routing and primary datastore are bound to this jurisdiction.
                    </p>
                  </div>
                </div>

                {/* Bottom Action Bar */}
                <div className="mt-8 pt-6 border-t border-[#eaedf1] flex items-center justify-end">
                  <button
                    className="h-10 px-5 bg-[#0f172a] hover:bg-black text-white text-sm font-medium rounded-lg shadow-sm transition-all flex items-center gap-2 cursor-pointer border-none"
                    type="submit"
                  >
                    <span>Continue</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            )}

            {/* STEP 2: Contact Information */}
            {currentStep === 2 && (
              <form onSubmit={handleStep2Next} className="flex flex-col">
                <div className="mb-8">
                  <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">Step 2 of 4</span>
                  <h2 className="text-2xl font-bold tracking-tight text-[#0f172a] mt-1.5">
                    Contact information
                  </h2>
                  <p className="text-sm text-[#64748b] mt-1">
                    Specify the primary administrator for this deployment.
                  </p>
                </div>

                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a] mb-2" htmlFor="firstName">
                        First name <span className="text-red-500">*</span>
                      </label>
                      <input
                        className="w-full h-11 px-3.5 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-sm focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none transition"
                        id="firstName"
                        placeholder="Alex"
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a] mb-2" htmlFor="lastName">
                        Last name <span className="text-red-500">*</span>
                      </label>
                      <input
                        className="w-full h-11 px-3.5 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-sm focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none transition"
                        id="lastName"
                        placeholder="Morgan"
                        type="text"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a]" htmlFor="contactEmail">
                        Current email address <span className="text-red-500">*</span>
                      </label>
                      {contactVerified ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                          <CheckCircle2 size={12} />
                          Verified
                        </span>
                      ) : (
                        <span className="text-[11px] text-[#64748b]">Verification required</span>
                      )}
                    </div>

                    {contactError && (
                      <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg p-2.5 flex items-center gap-1.5">
                        <AlertCircle size={14} className="shrink-0" />
                        <span>{contactError}</span>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <input
                          className="w-full h-11 px-3.5 pr-10 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-sm focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none transition disabled:bg-gray-50 disabled:text-gray-500"
                          id="contactEmail"
                          placeholder="alex@gmail.com"
                          type="email"
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
                        <AtSign size={18} className="absolute right-3.5 top-3 text-gray-400 pointer-events-none" />
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
                          className="h-11 px-4 text-xs font-medium text-[#64748b] hover:text-[#0f172a] border border-[#eaedf1] rounded-lg bg-white transition cursor-pointer shrink-0"
                        >
                          Change
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleSendContactOtp}
                          disabled={sendingContactOtp || contactCooldown > 0}
                          className="h-11 px-4 bg-[#0f172a] hover:bg-black text-white text-xs font-medium rounded-lg transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer border-none shrink-0"
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
                                : 'Send OTP'}
                          </span>
                        </button>
                      )}
                    </div>

                    {contactOtpSent && !contactVerified && (
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="text"
                          maxLength={6}
                          placeholder="6-digit OTP"
                          value={contactOtp}
                          onChange={(e) => {
                            setContactOtp(e.target.value.replace(/[^0-9]/g, ''));
                            setContactError(null);
                          }}
                          className="w-28 h-9 px-2 text-center tracking-widest font-mono text-sm rounded-lg border border-[#eaedf1] bg-white focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleVerifyContactOtp}
                          disabled={verifyingContactOtp || contactOtp.length !== 6}
                          className="h-9 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer border-none"
                        >
                          {verifyingContactOtp ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Check size={13} />
                          )}
                          <span>Verify</span>
                        </button>
                        <span className="text-[11px] text-[#64748b]">Check your inbox for the 6-digit code</span>
                      </div>
                    )}

                    <p className="text-[11px] text-[#64748b] mt-1">
                      We will send confirmation credentials and DNS verification guides here.
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a] mb-2" htmlFor="businessPhone">
                      Phone number (Optional)
                    </label>
                    <div className="flex gap-2">
                      <select
                        className="h-11 pl-2 pr-6 rounded-lg border border-[#eaedf1] bg-white text-sm text-[#0f172a] focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none transition cursor-pointer shrink-0 appearance-none"
                        value={countryCode}
                        onChange={(e) => setCountryCode(e.target.value)}
                        style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")", backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
                        id="countryCode"
                        aria-label="Country code"
                      >
                        {COUNTRY_CODES.map((c) => (
                          <option key={c.code + c.label} value={c.code}>
                            {c.flag} {c.code} {c.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className="flex-1 h-11 px-3.5 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-sm focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none transition"
                        id="businessPhone"
                        placeholder="e.g. 555 019 2834"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-[#eaedf1] flex items-center justify-between">
                  <button
                    className="h-10 px-4 text-xs font-medium text-[#64748b] hover:text-[#0f172a] transition-colors flex items-center gap-1.5 cursor-pointer bg-transparent border-none"
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
                    className="h-10 px-5 bg-[#0f172a] hover:bg-black text-white text-sm font-medium rounded-lg shadow-sm transition-all flex items-center gap-2 cursor-pointer border-none"
                    type="submit"
                  >
                    <span>Continue</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            )}

            {/* STEP 3: Domain */}
            {currentStep === 3 && (
              <form onSubmit={handleStep3Next} className="flex flex-col">
                <div className="mb-8">
                  <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">Step 3 of 4</span>
                  <h2 className="text-2xl font-bold tracking-tight text-[#0f172a] mt-1.5">
                    Your organization's domain
                  </h2>
                  <p className="text-sm text-[#64748b] mt-1">
                    Connect your verified web domain to enable mail and identity services.
                  </p>
                </div>

                <div className="space-y-6">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a] mb-2" htmlFor="domainInput">
                      Domain name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Globe size={18} className="absolute left-3 top-3 text-gray-400 pointer-events-none" />
                      <input
                        className="w-full h-11 px-3.5 pl-9 pr-16 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-sm focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none transition"
                        id="domainInput"
                        placeholder="acmeglobal.com"
                        type="text"
                        value={domainName}
                        onChange={(e) => setDomainName(e.target.value)}
                        required
                      />
                      {isDomainValid && (
                        <span className="absolute right-3 top-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Valid
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[#64748b] mt-1.5">
                      Enter without protocol prefixes (e.g. acme.com).
                    </p>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-[#eaedf1] flex items-center justify-between">
                  <button
                    className="h-10 px-4 text-xs font-medium text-[#64748b] hover:text-[#0f172a] transition-colors flex items-center gap-1.5 cursor-pointer bg-transparent border-none"
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
                    className="h-10 px-5 bg-[#0f172a] hover:bg-black text-white text-sm font-medium rounded-lg shadow-sm transition-all flex items-center gap-2 cursor-pointer border-none"
                    type="submit"
                  >
                    <span>Continue</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            )}

            {/* STEP 4: Password, Recovery Email & Security Questions */}
            {currentStep === 4 && (
              <form onSubmit={handleFinalSubmit} className="flex flex-col">
                <div className="mb-6">
                  <span className="text-xs font-semibold uppercase tracking-wider text-blue-600">Step 4 of 4</span>
                  <h2 className="text-2xl font-bold tracking-tight text-[#0f172a] mt-1.5">
                    Security &amp; Credentials
                  </h2>
                  <p className="text-sm text-[#64748b] mt-1">
                    Set up your master password, verified recovery email, and security questions.
                  </p>
                </div>

                <div className="space-y-5">
                  {/* Master Password Fields */}
                  <div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a] mb-1.5" htmlFor="adminPassword">
                          Master password <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                          <input
                            className="w-full h-10 px-3.5 pr-9 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-sm focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none transition"
                            id="adminPassword"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                          />
                          <button
                            type="button"
                            className="absolute right-3 top-2.5 text-gray-400 hover:text-[#0f172a] bg-transparent border-none cursor-pointer p-0"
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a] mb-1.5" htmlFor="confirmPassword">
                          Confirm password <span className="text-red-500">*</span>
                        </label>
                        <div className="relative">
                          <input
                            className="w-full h-10 px-3.5 pr-9 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-sm focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none transition"
                            id="confirmPassword"
                            type={showConfirmPassword ? 'text' : 'password'}
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            required
                          />
                          <button
                            type="button"
                            className="absolute right-3 top-2.5 text-gray-400 hover:text-[#0f172a] bg-transparent border-none cursor-pointer p-0"
                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                          >
                            {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Password strength */}
                    <div className="mt-2 flex items-center justify-between text-[11px]">
                      <div className="flex items-center gap-2 flex-1 max-w-[180px]">
                        <div className="w-full h-1 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${passwordStrength.barColor} transition-all duration-300`}
                            style={{ width: passwordStrength.width }}
                          ></div>
                        </div>
                      </div>
                      <span className={`font-medium ${passwordStrength.color}`}>
                        {passwordStrength.label} password
                      </span>
                    </div>
                  </div>

                  {/* Recovery Email */}
                  <div className="pt-4 border-t border-[#eaedf1] space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a]" htmlFor="recoveryEmailInput">
                        Recovery email <span className="text-[#64748b] font-normal lowercase">(for password reset)</span>
                      </label>
                      {recoveryVerified && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                          <Check size={12} strokeWidth={2.5} /> Verified
                        </span>
                      )}
                    </div>

                    {recoveryError && (
                      <div className="p-2 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-lg flex items-center gap-2">
                        <AlertCircle size={14} className="text-rose-500 shrink-0" />
                        <span>{recoveryError}</span>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <input
                        className="flex-1 h-10 px-3.5 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-sm focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none transition"
                        id="recoveryEmailInput"
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
                          className="h-10 px-4 text-xs font-medium text-[#64748b] hover:text-[#0f172a] border border-[#eaedf1] rounded-lg bg-white transition cursor-pointer"
                        >
                          Change
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleSendRecoveryOtp}
                          disabled={sendingRecoveryOtp || recoveryCooldown > 0}
                          className="h-10 px-4 bg-[#0f172a] hover:bg-black text-white text-xs font-medium rounded-lg transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer border-none shrink-0"
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
                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="text"
                          maxLength={6}
                          placeholder="6-digit OTP"
                          value={recoveryOtp}
                          onChange={(e) => {
                            setRecoveryOtp(e.target.value.replace(/[^0-9]/g, ''));
                            setRecoveryError(null);
                          }}
                          className="w-28 h-9 px-2 text-center tracking-widest font-mono text-sm rounded-lg border border-[#eaedf1] bg-white focus:border-[#0f172a] focus:ring-1 focus:ring-[#0f172a] outline-none"
                        />
                        <button
                          type="button"
                          onClick={handleVerifyRecoveryOtp}
                          disabled={verifyingRecoveryOtp || recoveryOtp.length !== 6}
                          className="h-9 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium rounded-lg transition disabled:opacity-50 flex items-center gap-1.5 cursor-pointer border-none"
                        >
                          {verifyingRecoveryOtp ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : (
                            <Check size={13} />
                          )}
                          <span>Verify</span>
                        </button>
                        <span className="text-[11px] text-[#64748b]">Check your inbox for the 6-digit code</span>
                      </div>
                    )}
                  </div>

                  {/* Security Questions */}
                  <div className="pt-4 border-t border-[#eaedf1] space-y-2.5">
                    <div>
                      <label className="block text-xs font-semibold uppercase tracking-wider text-[#0f172a]">
                        Security questions <span className="text-red-500">*</span>
                      </label>
                      <p className="text-[11px] text-[#64748b] mt-0.5">
                        Select 3 unique questions and answers for self-service account recovery.
                      </p>
                    </div>

                    <div className="space-y-2">
                      {/* Question 1 */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <div className="sm:col-span-7">
                          <select
                            className="w-full h-9.5 px-3 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-xs focus:border-[#0f172a] outline-none cursor-pointer truncate"
                            value={sq1Question}
                            onChange={(e) => setSq1Question(e.target.value)}
                          >
                            {SECURITY_QUESTIONS_POOL.map((q) => (
                              <option
                                key={q}
                                value={q}
                                disabled={q === sq2Question || q === sq3Question}
                              >
                                {q}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-5">
                          <input
                            type="text"
                            className="w-full h-9.5 px-3 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-xs focus:border-[#0f172a] outline-none"
                            placeholder="Secret answer 1"
                            value={sq1Answer}
                            onChange={(e) => setSq1Answer(e.target.value)}
                            required
                          />
                        </div>
                      </div>

                      {/* Question 2 */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <div className="sm:col-span-7">
                          <select
                            className="w-full h-9.5 px-3 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-xs focus:border-[#0f172a] outline-none cursor-pointer truncate"
                            value={sq2Question}
                            onChange={(e) => setSq2Question(e.target.value)}
                          >
                            {SECURITY_QUESTIONS_POOL.map((q) => (
                              <option
                                key={q}
                                value={q}
                                disabled={q === sq1Question || q === sq3Question}
                              >
                                {q}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-5">
                          <input
                            type="text"
                            className="w-full h-9.5 px-3 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-xs focus:border-[#0f172a] outline-none"
                            placeholder="Secret answer 2"
                            value={sq2Answer}
                            onChange={(e) => setSq2Answer(e.target.value)}
                            required
                          />
                        </div>
                      </div>

                      {/* Question 3 */}
                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                        <div className="sm:col-span-7">
                          <select
                            className="w-full h-9.5 px-3 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-xs focus:border-[#0f172a] outline-none cursor-pointer truncate"
                            value={sq3Question}
                            onChange={(e) => setSq3Question(e.target.value)}
                          >
                            {SECURITY_QUESTIONS_POOL.map((q) => (
                              <option
                                key={q}
                                value={q}
                                disabled={q === sq1Question || q === sq2Question}
                              >
                                {q}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="sm:col-span-5">
                          <input
                            type="text"
                            className="w-full h-9.5 px-3 rounded-lg border border-[#eaedf1] bg-white text-[#0f172a] text-xs focus:border-[#0f172a] outline-none"
                            placeholder="Secret answer 3"
                            value={sq3Answer}
                            onChange={(e) => setSq3Answer(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Configuration Summary Box */}
                  <div className="pt-4 border-t border-[#eaedf1]">
                    <div className="p-3.5 rounded-xl border border-[#eaedf1] bg-[#fafafa] space-y-2 text-xs">
                      <div className="flex justify-between items-center pb-2 border-b border-[#eaedf1]">
                        <span className="font-semibold text-[#0f172a]">Setup summary</span>
                        <button
                          type="button"
                          className="text-blue-600 hover:underline text-[11px] font-medium bg-transparent border-none cursor-pointer p-0"
                          onClick={() => {
                            setError(null);
                            setCurrentStep(1);
                          }}
                        >
                          Edit details
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-y-1.5 text-[#64748b]">
                        <div>Organization:</div>
                        <div className="font-medium text-[#0f172a] text-right truncate">
                          {businessName || 'Acme Global Inc.'}
                        </div>
                        <div>Target Domain:</div>
                        <div className="font-medium text-blue-600 text-right truncate">
                          admin@{cleanDomain || 'acmeglobal.com'}
                        </div>
                        <div>Recovery Email:</div>
                        <div className="font-medium text-[#0f172a] text-right truncate flex items-center justify-end gap-1">
                          <span>{(recoveryEmail || currentEmail).trim()}</span>
                          {recoveryVerified && <span className="text-emerald-600 font-bold">✓</span>}
                        </div>
                        <div>Security Questions:</div>
                        <div className="font-medium text-emerald-600 text-right">
                          3 Configured ✓
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Agreement Checkbox */}
                  <div className="space-y-2 pt-1">
                    <label className="flex items-start gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={agreeTerms}
                        onChange={(e) => setAgreeTerms(e.target.checked)}
                        className="mt-0.5 rounded border-gray-300 text-[#0f172a] focus:ring-[#0f172a]"
                        required
                      />
                      <span className="text-xs text-[#64748b] leading-relaxed">
                        I agree to the <a className="text-blue-600 hover:underline" href="#">Workspace Agreement</a> and confirm authorization to configure DNS records.
                      </span>
                    </label>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-[#eaedf1] flex items-center justify-between">
                  <button
                    className="h-10 px-4 text-xs font-medium text-[#64748b] hover:text-[#0f172a] transition-colors flex items-center gap-1.5 cursor-pointer bg-transparent border-none"
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
                    className="h-10 px-6 bg-[#0f172a] hover:bg-black text-white text-sm font-medium rounded-lg shadow-sm transition-all flex items-center gap-2 cursor-pointer border-none"
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
                        <Check size={16} />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}

            {/* STEP 5: Completed State */}
            {currentStep === 5 && (
              <div className="flex flex-col items-center text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
                  <Check size={26} strokeWidth={2.5} />
                </div>
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Complete</span>
                <h2 className="text-2xl font-bold tracking-tight text-[#0f172a] mt-1">Application Submitted</h2>
                <p className="text-sm text-[#64748b] mt-1 max-w-sm">
                  Your organization workspace is being initialized across cloud edge zones.
                </p>

                <div className="w-full mt-6 p-4 rounded-xl border border-[#eaedf1] bg-[#fafafa] text-left space-y-2 text-xs">
                  <div className="flex justify-between items-center pb-2 border-b border-[#eaedf1]">
                    <span className="text-[#64748b] font-medium">Reference Code</span>
                    <span className="font-mono text-[#0f172a] font-semibold">
                      {submittedApp ? `#ADMIN-${submittedApp.id.slice(-6).toUpperCase()}` : '#ADMIN-89241-US'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-[#64748b]">Domain:</span>
                    <span className="font-semibold text-[#0f172a]">{cleanDomain || 'acmeglobal.com'}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#64748b]">Admin Account:</span>
                    <span className="font-medium text-[#0f172a]">
                      {`${firstName} ${lastName}`.trim() || 'Alex Morgan'} (admin@{cleanDomain || 'acmeglobal.com'})
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#64748b]">Primary Contact:</span>
                    <span className="font-medium text-[#0f172a]">{currentEmail}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#64748b]">Recovery Email:</span>
                    <span className="font-medium text-[#0f172a] flex items-center gap-1">
                      <span>{(recoveryEmail || currentEmail).trim()}</span>
                      {recoveryVerified && <span className="text-emerald-600 font-semibold">(Verified)</span>}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[#64748b]">Security Questions:</span>
                    <span className="font-semibold text-emerald-600">3 Questions Saved ✓</span>
                  </div>
                </div>

                <div className="mt-8 flex flex-col sm:flex-row gap-3 w-full">
                  <button
                    className="flex-1 h-10 px-4 rounded-lg border border-[#eaedf1] text-xs font-medium text-[#334155] hover:bg-gray-50 transition cursor-pointer bg-white"
                    onClick={handleReset}
                    type="button"
                  >
                    Start new setup
                  </button>
                  <button
                    className="flex-1 h-10 px-4 rounded-lg bg-[#0f172a] hover:bg-black text-white text-xs font-medium transition flex items-center justify-center cursor-pointer border-none"
                    onClick={onBackToLogin}
                    type="button"
                  >
                    Return to Sign In
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Trust signals / minimal certifications */}
          <div className="mt-6 flex items-center justify-center gap-6 text-xs text-[#64748b]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> SOC2 Type II
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> ISO 27001
            </span>
            <span>•</span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> GDPR Ready
            </span>
          </div>
        </div>
      </main>

      {/* Minimal Footer */}
      <footer className="w-full border-t border-[#eaedf1] py-4 bg-white">
        <div className="max-w-4xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#64748b]">
          <div>© 2026 Toowix. All rights reserved.</div>
          <div className="flex items-center gap-4">
            <a className="hover:text-[#0f172a] transition-colors" href="#">Help Center</a>
            <a className="hover:text-[#0f172a] transition-colors" href="#">Privacy Policy</a>
            <a className="hover:text-[#0f172a] transition-colors" href="#">Terms of Service</a>
          </div>
        </div>
      </footer>
    </div>
  );
};
