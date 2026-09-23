import React from 'react';
import {
  Globe,
  Link2,
  ShieldCheck,
  Sparkles,
  Users,
  Mail,
  Search,
  Lock,
  Check,
  HardDrive,
  CreditCard,
} from 'lucide-react';
import { GoDaddyIcon, HostingerIcon, CloudflareIcon } from './ProviderIcons';
import { Plan } from '../types';

interface WizardStepGraphicProps {
  step: string;
  domainName?: string;
  selectedPlan?: Plan | null;
  provider?: 'godaddy' | 'hostinger' | 'cloudflare' | null;
}

export const WizardStepGraphic: React.FC<WizardStepGraphicProps> = ({
  step,
  domainName,
  selectedPlan,
  provider,
}) => {
  const displayDomain = domainName?.trim() ? domainName.trim().toLowerCase() : 'yourdomain.com';

  return (
    <div className={`relative ${step === 'plan' ? 'w-[390px]' : 'w-[480px] h-[360px]'} flex items-start justify-center select-none pointer-events-none`}>
      {/* Background Ambient Glow */}
      <div className="absolute inset-0 bg-gradient-to-tr from-indigo-100/30 via-purple-100/20 to-pink-50/15 rounded-3xl filter blur-2xl -z-10 opacity-70" />

      {/* =========================================================================
          STEP 0: CHOICE — "Domain & Server Infrastructure"
          ========================================================================= */}
      {step === 'choice' && (
        <div className="relative w-full h-full flex items-center justify-center">
          {/* SVG Canvas for Orbits, Cloud, and Server Stack */}
          <svg
            className="absolute inset-0 w-full h-full overflow-visible"
            viewBox="0 0 480 360"
            fill="none"
          >
            {/* Defs for gradients */}
            <defs>
              <linearGradient id="choiceCloudGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#EDE9FE" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#DDD6FE" stopOpacity="0.55" />
              </linearGradient>
              <linearGradient id="serverCapGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#E0E7FF" />
                <stop offset="100%" stopColor="#C7D2FE" />
              </linearGradient>
              <linearGradient id="serverBodyGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#C7D2FE" />
                <stop offset="50%" stopColor="#A5B4FC" />
                <stop offset="100%" stopColor="#818CF8" />
              </linearGradient>
            </defs>

            {/* Background Soft Cloud */}
            <path
              d="M 330 95 C 320 75 342 55 365 58 C 378 40 410 42 422 60 C 440 60 452 76 448 94 C 460 108 450 128 430 128 L 338 128 C 318 128 312 110 330 95 Z"
              fill="url(#choiceCloudGrad)"
            />

            {/* Sweeping Orbital Lines (Tilted in 3D) */}
            {/* Outer Orbit loop */}
            <path
              d="M 60 205 C 50 280 200 330 375 295 C 445 280 475 235 465 190 C 455 145 385 115 280 130"
              stroke="#C7D2FE"
              strokeWidth="2"
              strokeLinecap="round"
              fill="none"
            />
            {/* Inner Sweeping Loop */}
            <path
              d="M 40 180 C 35 125 145 85 285 95 C 420 105 460 165 445 225 C 425 290 245 315 120 270"
              stroke="#E0E7FF"
              strokeWidth="1.75"
              strokeLinecap="round"
              fill="none"
            />

            {/* Orbit Node Dots */}
            {/* Far Left Node with subtle ring */}
            <circle cx="58" cy="195" r="5" fill="#6366F1" />
            <circle cx="58" cy="195" r="9" stroke="#6366F1" strokeOpacity="0.25" strokeWidth="2" />

            {/* Bottom Node */}
            <circle cx="230" cy="312" r="5" fill="#6366F1" />
            <circle cx="230" cy="312" r="9" stroke="#6366F1" strokeOpacity="0.25" strokeWidth="2" />

            {/* Right Node */}
            <circle cx="455" cy="190" r="4.5" fill="#6366F1" />

            {/* =======================================================
                SERVER DISCS / STACK (Right Side, Behind Window)
                ======================================================= */}
            <g transform="translate(340, 145)">
              {/* Cylinder 1 (Top) */}
              <ellipse cx="60" cy="20" rx="42" ry="16" fill="url(#serverCapGrad)" />
              <path
                d="M 18 20 V 46 C 18 55 37 62 60 62 C 83 62 102 55 102 46 V 20 Z"
                fill="url(#serverBodyGrad)"
              />
              <rect x="36" y="34" width="38" height="4.5" rx="2.25" fill="#4338CA" />
              <circle cx="82" cy="36" r="2.2" fill="#6366F1" />

              {/* Cylinder 2 (Middle) */}
              <ellipse cx="60" cy="56" rx="42" ry="16" fill="url(#serverCapGrad)" />
              <path
                d="M 18 56 V 82 C 18 91 37 98 60 98 C 83 98 102 91 102 82 V 56 Z"
                fill="url(#serverBodyGrad)"
              />
              <rect x="36" y="70" width="38" height="4.5" rx="2.25" fill="#4338CA" />
              <circle cx="82" cy="72" r="2.2" fill="#6366F1" />

              {/* Cylinder 3 (Bottom) */}
              <ellipse cx="60" cy="92" rx="42" ry="16" fill="url(#serverCapGrad)" />
              <path
                d="M 18 92 V 118 C 18 127 37 134 60 134 C 83 134 102 127 102 118 V 92 Z"
                fill="url(#serverBodyGrad)"
              />
              <rect x="36" y="106" width="38" height="4.5" rx="2.25" fill="#4338CA" />
              <circle cx="82" cy="108" r="2.2" fill="#6366F1" />
            </g>
          </svg>

          {/* =======================================================
              BROWSER WINDOW CARD (Foreground, Angled / Tilted)
              ======================================================= */}
          <div className="absolute left-6 top-14 w-[280px] h-[200px] rounded-2xl bg-white border border-indigo-100/90 shadow-2xl shadow-indigo-900/15 flex flex-col overflow-hidden transform -rotate-2 hover:rotate-0 transition-transform duration-300">
            {/* Window Header */}
            <div className="h-7 bg-indigo-50/80 border-b border-indigo-100/70 px-3.5 flex items-center gap-1.5 shrink-0">
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-300/90" />
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-200" />
              <div className="w-2.5 h-2.5 rounded-full bg-indigo-200" />
            </div>

            {/* Window Content */}
            <div className="flex-1 flex flex-col items-center justify-between p-4 pt-3">
              {/* Globe Icon */}
              <div className="flex-1 flex items-center justify-center">
                <Globe className="w-16 h-16 text-indigo-500/95 stroke-[1.6]" />
              </div>

              {/* Domain Input Search Pill */}
              <div className="w-full bg-slate-100/90 rounded-full py-1.5 px-3.5 flex items-center justify-between border border-slate-200/80 shadow-xs">
                <span className="text-[11px] font-semibold text-slate-700 tracking-tight font-mono truncate max-w-[180px]">
                  yourdomain.com
                </span>
                <div className="w-4 h-4 rounded-full bg-indigo-600 text-white flex items-center justify-center shrink-0 ml-1">
                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          STEP 1: DOMAIN — "Domain Identity & Web Address"
          ========================================================================= */}
      {step === 'domain' && (
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Circuit lines */}
          <svg
            className="absolute inset-0 w-full h-full overflow-visible"
            viewBox="0 0 440 340"
            fill="none"
          >
            {/* Top-Left Sky/Indigo Node */}
            <circle cx="48" cy="62" r="5" fill="#6366F1" />
            <circle cx="48" cy="62" r="9" stroke="#6366F1" strokeOpacity="0.25" strokeWidth="2" />
            <path
              d="M 54 62 H 98 C 112 62 120 70 120 84 V 110"
              stroke="#C7D2FE"
              strokeWidth="2"
              strokeLinecap="round"
            />

            {/* Lower Dashed Loop */}
            <path
              d="M 68 195 V 225 C 68 239 76 247 90 247 H 144"
              stroke="#C7D2FE"
              strokeWidth="1.75"
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
            <path
              d="M 216 247 H 260 C 274 247 282 239 282 225 V 195"
              stroke="#C7D2FE"
              strokeWidth="1.75"
              strokeDasharray="4 4"
              strokeLinecap="round"
            />

            {/* Floating Right Decorator Dot */}
            <circle cx="380" cy="180" r="4.5" fill="#E0E7FF" />
          </svg>

          {/* Floating Lower Node: Search Badge */}
          <div className="absolute bottom-[72px] left-[150px] z-10">
            <div className="w-11 h-11 rounded-2xl bg-white border border-indigo-100 shadow-md shadow-indigo-500/10 flex items-center justify-center text-indigo-600">
              <Search className="w-5 h-5 text-indigo-600" />
            </div>
          </div>

          {/* Floating Lavender Accent Pills */}
          <div className="absolute bottom-[74px] right-10 flex flex-col gap-2 opacity-80">
            <div className="h-2.5 w-20 rounded-full bg-indigo-100/90" />
            <div className="h-2 w-14 rounded-full bg-indigo-50/80" />
          </div>

          {/* Main Domain Search Card */}
          <div className="relative w-[340px] sm:w-[350px] rounded-3xl bg-white/95 border border-indigo-100/90 shadow-xl shadow-indigo-900/5 p-5 pr-7 flex items-center gap-4 transition-all duration-300">
            {/* Top-Right Badge: Sparkles Badge */}
            <div className="absolute -top-3.5 -right-3.5 z-20">
              <div className="w-10 h-10 rounded-2xl bg-indigo-600 shadow-lg shadow-indigo-600/35 flex items-center justify-center text-white transform rotate-3">
                <Sparkles className="w-5 h-5 stroke-[2.2]" />
              </div>
            </div>

            {/* Left Icon: Globe */}
            <div className="w-12 h-12 rounded-full border-2 border-indigo-500/30 flex items-center justify-center text-indigo-600 shrink-0">
              <Globe className="w-7 h-7 stroke-[1.8]" />
            </div>

            {/* Card Content */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <span
                  className="text-lg font-bold text-indigo-950 tracking-tight truncate max-w-[200px]"
                  title={displayDomain}
                >
                  {displayDomain}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                  {domainName?.trim() ? 'Ready for DNS' : 'Enter your domain'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          STEP 2: PLAN — "Plan Specifications Card" (Matches Stitch UI)
          ========================================================================= */}
      {step === 'plan' && (
        <div className="w-full max-w-[390px] bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm flex flex-col gap-4 text-left transition-all duration-300">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Plan Specifications
              </span>
              <div className="flex items-center gap-2 mt-1">
                <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                  {selectedPlan?.name || 'Pro'}
                </h3>
                {selectedPlan?.badge && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100">
                    {selectedPlan.badge}
                  </span>
                )}
              </div>
            </div>
            <div className="text-right">
              <span className="text-xl font-bold text-slate-900 tabular-nums">
                {selectedPlan?.monthlyPriceInPaise
                  ? `₹${(selectedPlan.monthlyPriceInPaise / 100).toLocaleString('en-IN')}`
                  : '₹99'}
              </span>
              <span className="text-[11px] text-slate-400 block font-normal -mt-0.5">/user/mo</span>
            </div>
          </div>

          {/* Target Custom Domain Card */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100">
                <Globe className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-bold text-slate-800 truncate block">
                  {displayDomain}
                </span>
                <span className="text-[10px] text-slate-400 block truncate">
                  Target custom domain
                </span>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-[10px] font-medium shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Ready for provisioning
            </span>
          </div>

          {/* Specifications List */}
          <div className="space-y-3.5 text-xs text-slate-600 pt-1">
            {/* Storage & Mailbox */}
            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-md bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 mt-0.5">
                <HardDrive className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="font-semibold text-slate-800 block text-xs">Storage &amp; Mailbox</span>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  {selectedPlan?.storageQuotaGb ? `${selectedPlan.storageQuotaGb} GB` : '20 GB'} Mailbox SSD Storage per user, IMAP/POP3/SMTP &amp; webmail.
                </p>
              </div>
            </div>

            {/* Productivity Suite */}
            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                <Sparkles className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="font-semibold text-slate-800 block text-xs">Productivity Suite</span>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  {selectedPlan?.apps && selectedPlan.apps.includes('meet')
                    ? 'Toowix Meet, Toowix Sign (e-signatures).'
                    : 'Dedicated Custom Domain Webmail.'}
                </p>
              </div>
            </div>

            {/* Deliverability & Security */}
            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-md bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 mt-0.5">
                <ShieldCheck className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="font-semibold text-slate-800 block text-xs">Deliverability &amp; Security</span>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Automated SPF, DKIM &amp; DMARC DNS generation, TLS 1.3 encryption.
                </p>
              </div>
            </div>

            {/* Capacity & Quota */}
            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-md bg-purple-50 text-purple-600 flex items-center justify-center shrink-0 mt-0.5">
                <Users className="w-3.5 h-3.5" />
              </div>
              <div>
                <span className="font-semibold text-slate-800 block text-xs">Mailbox Capacity</span>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
                  Pay as you go · {selectedPlan?.seatCount && selectedPlan.seatCount < 9999 ? `Up to ${selectedPlan.seatCount} mailboxes` : 'Unlimited mailboxes'} on this domain.
                </p>
              </div>
            </div>
          </div>

          {/* Footer summary */}
          <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 font-medium">Monthly Rate</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {selectedPlan?.monthlyPriceInPaise
                  ? `₹${(selectedPlan.monthlyPriceInPaise / 100).toLocaleString('en-IN')} / user`
                  : '₹99 / user'}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-indigo-700 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
              <span>60-day free trial · Instant Cloud Activation</span>
            </div>
            <div className="mt-0.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-medium">
                DKIM, SPF &amp; DMARC Automated
              </span>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          STEP 3: METHOD / PROVIDERS — "DNS Provider Connection" (Exact Reference)
          ========================================================================= */}
      {(step === 'method' || step === 'godaddy' || step === 'hostinger' || step === 'cloudflare') && (
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Circuit Lines: Exact Match to Reference Screenshot media_1789973113998.png */}
          <svg
            className="absolute inset-0 w-full h-full overflow-visible"
            viewBox="0 0 440 340"
            fill="none"
          >
            {/* Top-Left Pink Node to Main Card */}
            <circle cx="48" cy="62" r="5" fill="#FD63BC" />
            <circle cx="48" cy="62" r="9" stroke="#FD63BC" strokeOpacity="0.25" strokeWidth="2" />
            <path
              d="M 54 62 H 98 C 112 62 120 70 120 84 V 110"
              stroke="#C7D2FE"
              strokeWidth="2"
              strokeLinecap="round"
            />

            {/* Lower Dashed Loop Connector to Link Node */}
            <path
              d="M 68 195 V 225 C 68 239 76 247 90 247 H 144"
              stroke="#C7D2FE"
              strokeWidth="1.75"
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
            <path
              d="M 216 247 H 260 C 274 247 282 239 282 225 V 195"
              stroke="#C7D2FE"
              strokeWidth="1.75"
              strokeDasharray="4 4"
              strokeLinecap="round"
            />

            {/* Floating Right Decorator Dot */}
            <circle cx="380" cy="180" r="4.5" fill="#E0E7FF" />
          </svg>

          {/* Floating Link Badge on the Lower Circuit */}
          <div className="absolute bottom-[72px] left-[150px] z-10">
            <div className="w-11 h-11 rounded-2xl bg-white border border-indigo-100 shadow-md shadow-indigo-500/10 flex items-center justify-center text-indigo-600 transition-transform duration-300">
              {provider === 'godaddy' ? (
                <GoDaddyIcon className="w-5 h-5 text-emerald-600" />
              ) : provider === 'hostinger' ? (
                <HostingerIcon className="w-5 h-5 text-indigo-600" />
              ) : provider === 'cloudflare' ? (
                <CloudflareIcon className="w-5 h-5 text-amber-500" />
              ) : (
                <Link2 className="w-5 h-5 -rotate-45" />
              )}
            </div>
          </div>

          {/* Floating Lavender Pill Bars on Bottom Right */}
          <div className="absolute bottom-[74px] right-10 flex flex-col gap-2 opacity-80">
            <div className="h-2.5 w-20 rounded-full bg-indigo-100/90" />
            <div className="h-2 w-14 rounded-full bg-indigo-50/80" />
          </div>

          {/* Main Floating Domain Card */}
          <div className="relative w-[340px] sm:w-[350px] rounded-3xl bg-white/95 border border-indigo-100/90 shadow-xl shadow-indigo-900/5 p-5 pr-7 flex items-center gap-4 transition-all duration-300">
            {/* Shield with Checkmark Badge on Top-Right Corner */}
            <div className="absolute -top-3.5 -right-3.5 z-20">
              <svg className="w-10 h-10 drop-shadow-md" viewBox="0 0 40 44" fill="none">
                <path
                  d="M20 2 C20 2 35 6 35 17 C35 28 20 39 20 39 C20 39 5 28 5 17 C5 6 20 2 20 2 Z"
                  fill="#6366F1"
                />
                <path
                  d="M13 19.5 L18 24.5 L27 15"
                  stroke="white"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Globe Icon in Circle Badge */}
            <div className="w-12 h-12 rounded-full border-2 border-indigo-500/30 flex items-center justify-center text-indigo-600 shrink-0">
              <Globe className="w-7 h-7 stroke-[1.8]" />
            </div>

            {/* Card Body: Domain Name and Skeleton Line */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <span
                  className="text-lg font-bold text-indigo-950 tracking-tight truncate max-w-[200px]"
                  title={displayDomain}
                >
                  {displayDomain}
                </span>
              </div>

              {/* Skeleton Pill / Status Line */}
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="h-2.5 w-36 bg-indigo-100/90 rounded-full flex items-center overflow-hidden">
                  <div className="h-full w-2/3 bg-indigo-200/80 rounded-full" />
                </div>
                <div className="h-2 w-20 bg-indigo-50 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          STEP 4: STATUS — "Verified Security & Active DNS Records"
          ========================================================================= */}
      {step === 'status' && (
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Circuit Lines with Emerald Accents */}
          <svg
            className="absolute inset-0 w-full h-full overflow-visible"
            viewBox="0 0 440 340"
            fill="none"
          >
            <circle cx="48" cy="62" r="5" fill="#10B981" />
            <circle cx="48" cy="62" r="9" stroke="#10B981" strokeOpacity="0.25" strokeWidth="2" />
            <path
              d="M 54 62 H 98 C 112 62 120 70 120 84 V 110"
              stroke="#A7F3D0"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M 68 195 V 225 C 68 239 76 247 90 247 H 144"
              stroke="#A7F3D0"
              strokeWidth="1.75"
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
            <path
              d="M 216 247 H 260 C 274 247 282 239 282 225 V 195"
              stroke="#A7F3D0"
              strokeWidth="1.75"
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
            <circle cx="380" cy="180" r="4.5" fill="#A7F3D0" />
          </svg>

          {/* Floating Lower Node: Lock/Protection Badge */}
          <div className="absolute bottom-[72px] left-[150px] z-10">
            <div className="w-11 h-11 rounded-2xl bg-white border border-emerald-100 shadow-md shadow-emerald-500/10 flex items-center justify-center text-emerald-600">
              <Lock className="w-5 h-5 text-emerald-600" />
            </div>
          </div>

          {/* Floating Emerald Pill Bars on Bottom Right */}
          <div className="absolute bottom-[74px] right-10 flex flex-col gap-2 opacity-80">
            <div className="h-2.5 w-24 rounded-full bg-emerald-100/80" />
            <div className="h-2 w-16 rounded-full bg-emerald-50/80" />
          </div>

          {/* Main Verified Security Card */}
          <div className="relative w-[340px] sm:w-[350px] rounded-3xl bg-white/95 border border-emerald-100 shadow-xl shadow-emerald-900/5 p-5 pr-7 flex items-center gap-4 transition-all duration-300">
            {/* Top-Right Badge: Emerald Shield with Check */}
            <div className="absolute -top-3.5 -right-3.5 z-20">
              <svg className="w-10 h-10 drop-shadow-md" viewBox="0 0 40 44" fill="none">
                <path
                  d="M20 2 C20 2 35 6 35 17 C35 28 20 39 20 39 C20 39 5 28 5 17 C5 6 20 2 20 2 Z"
                  fill="#10B981"
                />
                <path
                  d="M13 19.5 L18 24.5 L27 15"
                  stroke="white"
                  strokeWidth="2.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>

            {/* Left Icon: Emerald Security Shield */}
            <div className="w-12 h-12 rounded-full border-2 border-emerald-500/30 flex items-center justify-center text-emerald-600 shrink-0">
              <ShieldCheck className="w-7 h-7 stroke-[1.8]" />
            </div>

            {/* Card Content: DNS Active Pillars */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <span
                  className="text-lg font-bold text-slate-900 tracking-tight truncate max-w-[200px]"
                  title={displayDomain}
                >
                  {displayDomain}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-1 flex-wrap">
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  MX ✓
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  SPF ✓
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  DKIM ✓
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                  DMARC ✓
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          STEP: PAYMENT — "Payment Method & 60-Day Trial"
          ========================================================================= */}
      {step === 'payment' && (
        <div className="relative w-full h-full flex items-center justify-center">
          <div className="w-[380px] rounded-2xl bg-white border border-slate-200 shadow-xl p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                  <CreditCard className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-900">Secure Payment</h4>
                  <span className="text-[11px] text-slate-500">256-bit SSL encrypted</span>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                60 Days Free
              </span>
            </div>

            <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-xl flex flex-col gap-1.5 text-xs text-slate-600">
              <div className="flex justify-between font-medium">
                <span>Trial Period:</span>
                <span className="text-slate-900">60 Days</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Due Today:</span>
                <span className="text-emerald-700 font-bold">₹0.00</span>
              </div>
              <div className="flex justify-between font-medium">
                <span>Billing Cycle:</span>
                <span className="text-slate-900">Monthly after trial</span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-400">
              <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>Cancel or change plans anytime before trial ends.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
