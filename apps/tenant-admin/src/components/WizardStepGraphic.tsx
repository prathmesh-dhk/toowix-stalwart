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
    <div className="relative w-[440px] h-[340px] flex items-center justify-center select-none pointer-events-none">
      {/* Background Ambient Glow */}
      <div className="absolute inset-0 bg-gradient-to-tr from-indigo-100/25 via-purple-50/20 to-pink-50/15 rounded-3xl filter blur-2xl -z-10 opacity-60" />

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
          STEP 2: PLAN — "Seat Capacity & Mailboxes"
          ========================================================================= */}
      {step === 'plan' && (
        <div className="relative w-full h-full flex items-center justify-center">
          {/* Circuit lines */}
          <svg
            className="absolute inset-0 w-full h-full overflow-visible"
            viewBox="0 0 440 340"
            fill="none"
          >
            <circle cx="48" cy="62" r="5" fill="#8B5CF6" />
            <circle cx="48" cy="62" r="9" stroke="#8B5CF6" strokeOpacity="0.25" strokeWidth="2" />
            <path
              d="M 54 62 H 98 C 112 62 120 70 120 84 V 110"
              stroke="#DDD6FE"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M 68 195 V 225 C 68 239 76 247 90 247 H 144"
              stroke="#DDD6FE"
              strokeWidth="1.75"
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
            <path
              d="M 216 247 H 260 C 274 247 282 239 282 225 V 195"
              stroke="#DDD6FE"
              strokeWidth="1.75"
              strokeDasharray="4 4"
              strokeLinecap="round"
            />
            <circle cx="380" cy="180" r="4.5" fill="#DDD6FE" />
          </svg>

          {/* Floating Lower Node: Mailbox Badge */}
          <div className="absolute bottom-[72px] left-[150px] z-10">
            <div className="w-11 h-11 rounded-2xl bg-white border border-purple-100 shadow-md shadow-purple-500/10 flex items-center justify-center text-purple-600">
              <Mail className="w-5 h-5 text-purple-600" />
            </div>
          </div>

          {/* Floating Right Pill Details */}
          <div className="absolute bottom-[74px] right-10 flex flex-col gap-2 opacity-80">
            <div className="h-2.5 w-24 rounded-full bg-purple-100/90" />
            <div className="h-2 w-16 rounded-full bg-purple-50/80" />
          </div>

          {/* Main Plan Tier Card */}
          <div className="relative w-[340px] sm:w-[350px] rounded-3xl bg-white/95 border border-purple-100/90 shadow-xl shadow-purple-900/5 p-5 pr-7 flex items-center gap-4 transition-all duration-300">
            {/* Top-Right Badge: Users Badge */}
            <div className="absolute -top-3.5 -right-3.5 z-20">
              <div className="w-10 h-10 rounded-2xl bg-purple-600 shadow-lg shadow-purple-600/35 flex items-center justify-center text-white transform rotate-3">
                <Users className="w-5 h-5 stroke-[2.2]" />
              </div>
            </div>

            {/* Left Icon: Mailbox Circle */}
            <div className="w-12 h-12 rounded-full border-2 border-purple-500/30 flex items-center justify-center text-purple-600 shrink-0">
              <Mail className="w-7 h-7 stroke-[1.8]" />
            </div>

            {/* Card Content */}
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-slate-900 tracking-tight truncate">
                  {selectedPlan
                    ? selectedPlan.billingMode === 'metered'
                      ? selectedPlan.name
                      : `${selectedPlan.seatCount} Seat Capacity`
                    : '10 Seat Capacity'}
                </span>
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                <div className="h-2.5 w-36 bg-purple-100/90 rounded-full overflow-hidden flex items-center">
                  <div className="h-full w-3/4 bg-purple-500 rounded-full" />
                </div>
                <span className="text-[11px] font-semibold text-purple-700 mt-0.5">
                  {selectedPlan?.badge || selectedPlan?.name || 'Standard Tier'} · Dedicated mailboxes
                </span>
              </div>
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
    </div>
  );
};
