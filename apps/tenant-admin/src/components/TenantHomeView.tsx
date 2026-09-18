import React, { useState, useEffect } from 'react';
import { api } from '../api';
import { TenantSummary, DomainItem, AuditItem, UserContext, TenantBillingSummary as TenantBillingSummaryType } from '../types';
import toowixLogo from '../assets/toowix-logo.svg';
import { dnsStatusPill } from './DomainSwitcher';
import { DomainSetupModal } from './DomainSetupModal';
import { SecurityView } from './SecurityView';
import { ActiveDevicesView } from './ActiveDevicesView';
import { TenantBillingSummary } from './TenantBillingSummary';
import { ApiKeysView } from './ApiKeysView';
import {
  Loader2,
  LogOut,
  Building2,
  Globe,
  Plus,
  Shield,
  ShieldCheck,
  FileText,
  Laptop,
  CreditCard,
  ArrowRight,
  X,
  Mail,
  LayoutDashboard,
  Search,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Key,
  type LucideIcon,
} from 'lucide-react';

interface TenantHomeViewProps {
  user?: UserContext | null;
  onLogout?: () => void;
  onNavigateToDomain: (domainId: string) => void;
}

type HomeTab = 'overview' | 'domains' | 'apikeys' | 'billing' | 'security' | 'audit' | 'devices';

function formatAuditAction(action: string, metadata?: any) {
  switch (action) {
    case 'MAILBOX_CREATED':
      return `${metadata?.address || 'Mailbox'} created`;
    case 'MAILBOX_PASSWORD_RESET':
      return `Password reset for ${metadata?.address || 'mailbox'}`;
    case 'MAILBOX_DELETED':
      return `Mailbox ${metadata?.address || ''} deleted`;
    case 'AUTH_LOGIN_SUCCESS':
      return 'Admin login authenticated';
    case '2FA_VERIFIED':
      return 'Two-Factor verification completed';
    case 'SETTINGS_UPDATED':
      return 'Security settings updated';
    default:
      return action.replace(/_/g, ' ').toLowerCase();
  }
}

/**
 * Tenant-wide landing page, reached on login and via "TOOWIX ADMIN" from
 * within a Domain Dashboard. Shows every domain (click one to open its
 * Domain Dashboard) plus account-level info that applies across all
 * domains: combined billing, 2FA/security, audit trail, active sessions.
 */
export const TenantHomeView: React.FC<TenantHomeViewProps> = ({ user, onLogout, onNavigateToDomain }) => {
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [billingSummary, setBillingSummary] = useState<TenantBillingSummaryType | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<HomeTab>('overview');
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [domainSearch, setDomainSearch] = useState('');
  const [overviewLimit, setOverviewLimit] = useState(5);

  const [dismissed2FaBanner, setDismissed2FaBanner] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('toowix_dismissed_2fa_banner') === 'true';
    } catch {
      return false;
    }
  });
  const [is2FaEnabled, setIs2FaEnabled] = useState<boolean>(Boolean(user?.twoFactorEnabled));

  const load = async () => {
    try {
      const [tenantRes, domainsRes, auditRes, billingRes] = await Promise.all([
        api.getTenantMe(),
        api.listTenantDomains().catch(() => ({ domains: [] })),
        api.getAuditLogs({ limit: 50 }).catch(() => ({ logs: [] })),
        api.getTenantBillingSummary().catch(() => null),
      ]);
      setTenant(tenantRes.tenant);
      setDomains(domainsRes.domains || []);
      setAuditLogs(auditRes.logs || []);
      setBillingSummary(billingRes);
    } catch (err) {
      console.error('Failed to load tenant data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (user?.twoFactorEnabled !== undefined) {
      setIs2FaEnabled(Boolean(user.twoFactorEnabled));
    }
    api
      .getSecuritySettings()
      .then((sec) => {
        if (typeof sec?.twoFactorEnabled === 'boolean') setIs2FaEnabled(sec.twoFactorEnabled);
      })
      .catch(() => {});
  }, [user?.twoFactorEnabled]);

  const handleDismiss2FaBanner = () => {
    setDismissed2FaBanner(true);
    try {
      sessionStorage.setItem('toowix_dismissed_2fa_banner', 'true');
    } catch {
      // ignore
    }
  };

  const handleDomainAdded = async (newDomain: DomainItem) => {
    await load();
    onNavigateToDomain(newDomain.id);
  };

  const adminEmail = user?.email || 'admin@toowix.com';
  const adminInitials = adminEmail.slice(0, 2).toUpperCase();

  const TABS: Array<{ key: HomeTab; label: string; icon: LucideIcon }> = [
    { key: 'overview', label: 'Overview', icon: LayoutDashboard },
    { key: 'domains', label: 'Domains', icon: Globe },
    { key: 'apikeys', label: 'API Keys', icon: Key },
    { key: 'billing', label: 'Billing', icon: CreditCard },
    { key: 'security', label: 'Security', icon: Shield },
    { key: 'audit', label: 'Audit Log', icon: FileText },
    { key: 'devices', label: 'Active Devices', icon: Laptop },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          <span className="text-xs font-medium">Loading workspace...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans text-slate-900 antialiased selection:bg-indigo-100 selection:text-indigo-900">
      <header className="fixed top-0 inset-x-0 z-40 bg-white border-b border-slate-200 h-16">
        <div className="h-full px-6 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 select-none">
              <img src={toowixLogo} alt="Toowix" className="w-8 h-8 object-contain" />
              <span className="font-semibold text-slate-900 text-sm tracking-tight leading-tight">TOOWIX ADMIN</span>
            </div>
            <span className="text-slate-300 font-light text-base hidden md:inline select-none">/</span>
            <div className="hidden md:inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200/80 text-xs">
              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-800 tracking-tight">{tenant?.name || 'Organization'}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-semibold">
                {adminInitials}
              </div>
              <div className="hidden lg:flex flex-col text-left">
                <span className="text-xs font-medium text-slate-900 leading-tight">{adminEmail}</span>
                <span className="text-[11px] text-slate-400 font-normal leading-tight">Administrator</span>
              </div>
            </div>
            {onLogout && (
              <button
                onClick={onLogout}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors"
                title="Sign Out"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* SIDEBAR NAVIGATION RAIL (matches the Domain Dashboard's rail)             */}
      {/* ========================================================================= */}
      <aside className="fixed left-0 top-16 bottom-0 w-60 bg-white border-r border-slate-200 z-30 flex flex-col justify-between px-3 py-4 select-none">
        <div className="flex flex-col gap-1 overflow-y-auto">
          <div className="flex flex-col gap-0.5">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                    activeTab === tab.key
                      ? 'bg-indigo-50 text-indigo-700 font-medium'
                      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
                  }`}
                  id={`nav-home-${tab.key}`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <Icon
                      className={`w-5 h-5 shrink-0 transition-colors ${
                        activeTab === tab.key ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                      }`}
                      strokeWidth={1.75}
                    />
                    <span className="truncate">{tab.label}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <main className="pl-60 pt-16 min-h-screen">
        <div className="page-content-scaled w-full max-w-6xl mx-auto px-10 py-10 flex flex-col gap-8">
          {!is2FaEnabled && !dismissed2FaBanner && activeTab !== 'security' && (
            <div
              role="region"
              aria-label="Two-Factor Authentication Setup Notice"
              className="relative overflow-hidden bg-gradient-to-r from-indigo-50/90 via-blue-50/40 to-white border border-indigo-100/90 rounded-2xl p-4 sm:p-5 shadow-xs"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Shield className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">
                        Enhance account security with Two-Factor Authentication
                      </h3>
                      <span className="px-2 py-0.5 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200/80 rounded-full">
                        Recommended
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                      Protect your administrative controls and organization mailboxes from unauthorized access.
                    </p>
                    <div className="mt-2.5 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setActiveTab('security')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors"
                      >
                        <span>Set up 2FA</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleDismiss2FaBanner}
                        className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2 py-1.5 transition-colors"
                      >
                        Remind me later
                      </button>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleDismiss2FaBanner}
                  className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 rounded-lg transition-colors shrink-0"
                  aria-label="Dismiss 2FA notification"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {activeTab === 'overview' && (
            <>
              {domains.length === 0 && (
                <div className="relative overflow-hidden bg-gradient-to-r from-indigo-50/90 via-blue-50/40 to-white border border-indigo-100/90 rounded-2xl p-4 sm:p-5 shadow-xs">
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-indigo-600/10 text-indigo-600 flex items-center justify-center shrink-0 mt-0.5">
                      <Globe className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div className="flex flex-col gap-1">
                      <h3 className="text-sm font-semibold text-slate-900">Add your first domain to start provisioning mailboxes</h3>
                      <p className="text-xs text-slate-600 leading-relaxed max-w-2xl">
                        DNS records (MX, SPF, DKIM) are generated automatically the moment you add a domain.
                      </p>
                      <div className="mt-2.5 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setShowDomainModal(true)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors"
                          id="btn-add-first-domain-overview"
                        >
                          <span>Add Domain</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveTab('apikeys')}
                          className="text-xs font-medium text-slate-500 hover:text-slate-700 px-2 py-1.5 transition-colors"
                        >
                          Or save a DNS provider API key first
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <section className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Overview</h1>
                  <p className="text-xs text-slate-500">
                    {tenant?.name || 'Your organization'} at a glance — every domain, billing, and account security.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDomainModal(true)}
                  className="self-start sm:self-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-2 cursor-pointer shrink-0"
                  id="btn-add-domain-overview"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Domain</span>
                </button>
              </section>

              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-2 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Domains</span>
                    <Globe className="w-[18px] h-[18px] text-slate-400" />
                  </div>
                  <span className="text-2xl font-semibold text-slate-900">{domains.length}</span>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-2 shadow-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Mailboxes</span>
                    <Mail className="w-[18px] h-[18px] text-slate-400" />
                  </div>
                  <span className="text-2xl font-semibold text-slate-900">
                    {domains.reduce((sum, d) => sum + d.mailboxCount, 0)}
                    <span className="text-sm font-normal text-slate-500">
                      {' '}
                      / {domains.reduce((sum, d) => sum + d.mailboxLimit, 0)}
                    </span>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setActiveTab('billing')}
                  className="text-left bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-2 shadow-xs hover:border-indigo-300 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Billing</span>
                    <CreditCard className="w-[18px] h-[18px] text-slate-400" />
                  </div>
                  <span className="text-sm font-semibold text-slate-900 capitalize">
                    {billingSummary?.hasSubscription ? billingSummary.status?.replace(/_/g, ' ') : 'Not started'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab('security')}
                  className="text-left bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-2 shadow-xs hover:border-indigo-300 transition-colors cursor-pointer"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">2FA</span>
                    {is2FaEnabled ? (
                      <ShieldCheck className="w-[18px] h-[18px] text-emerald-500" />
                    ) : (
                      <Shield className="w-[18px] h-[18px] text-amber-500" />
                    )}
                  </div>
                  <span className={`text-sm font-semibold ${is2FaEnabled ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {is2FaEnabled ? 'Enabled' : 'Not enabled'}
                  </span>
                </button>
              </section>

              <section className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden flex flex-col">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Globe className="w-[18px] h-[18px] text-slate-400" />
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Domains</h2>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setShowDomainModal(true)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 border border-indigo-200/80 rounded-lg transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Domain</span>
                    </button>
                    <button
                      onClick={() => setActiveTab('domains')}
                      className="text-xs font-medium text-slate-500 hover:text-indigo-600 hover:underline flex items-center gap-1 cursor-pointer"
                    >
                      <span>View all domains</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {domains.length === 0 ? (
                  <div className="py-8 text-center flex flex-col items-center gap-2 text-slate-400">
                    <Globe className="w-7 h-7 text-slate-300" />
                    <p className="text-xs text-slate-500">No domains yet.</p>
                    <button
                      onClick={() => setShowDomainModal(true)}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                    >
                      + Add your first domain
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Domain</th>
                          <th>Status</th>
                          <th>Mailboxes</th>
                          <th>Plan</th>
                          <th style={{ textAlign: 'right' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {domains.slice(0, overviewLimit).map((domain) => {
                          const isDnsActive = domain.dnsStatus === 'active';
                          const pill = dnsStatusPill(domain.dnsStatus);
                          const usagePercent = Math.min(100, Math.round((domain.mailboxCount / Math.max(1, domain.mailboxLimit)) * 100));
                          const barColor = usagePercent >= 90 ? 'bg-rose-500' : usagePercent >= 75 ? 'bg-amber-500' : 'bg-indigo-600';
                          return (
                            <tr
                              key={domain.id}
                              onClick={() => onNavigateToDomain(domain.id)}
                              style={{ cursor: 'pointer' }}
                            >
                              <td>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-slate-900">{domain.domainName}</span>
                                  {domain.isPrimary && (
                                    <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
                                      Primary
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td>
                                <div className="flex items-center gap-1.5">
                                  {isDnsActive ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                  ) : (
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                  )}
                                  <span>{pill.label}</span>
                                </div>
                              </td>
                              <td>
                                <div className="flex items-center gap-2 min-w-[140px]">
                                  <div className="flex-1 min-w-[60px] max-w-[80px] bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${usagePercent}%` }} />
                                  </div>
                                  <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                                    {domain.mailboxCount} / {domain.mailboxLimit}
                                  </span>
                                </div>
                              </td>
                              <td>{domain.planName || '—'}</td>
                              <td style={{ textAlign: 'right' }}>
                                <ChevronRight className="w-4 h-4 text-slate-300 inline-block" />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="pagination-row">
                      <span>
                        Showing {Math.min(overviewLimit, domains.length)} of {domains.length}
                      </span>
                      <div className="flex items-center gap-2">
                        {overviewLimit < domains.length ? (
                          <button
                            type="button"
                            onClick={() => setOverviewLimit((prev) => prev + 5)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium text-xs shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
                          >
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                            <span>Show more</span>
                          </button>
                        ) : domains.length > 5 ? (
                          <button
                            type="button"
                            onClick={() => setOverviewLimit(5)}
                            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-medium text-xs shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
                          >
                            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
                            <span>Show less</span>
                          </button>
                        ) : null}

                        {domains.length > 5 && (
                          <button
                            type="button"
                            onClick={() => setActiveTab('domains')}
                            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1 cursor-pointer ml-1"
                          >
                            <span>View all</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          {activeTab === 'domains' && (
            <>
              {domains.length === 0 ? (
                <section className="bg-white border border-slate-200 rounded-2xl p-6 md:p-7 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                  <div className="flex flex-col gap-3 max-w-2xl">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full border border-indigo-200/60">
                        Setup Required
                      </span>
                    </div>
                    <h2 className="text-xl font-bold tracking-tight text-slate-900">Connect your first domain to get started</h2>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      Add an authoritative domain to allocate employee mailbox seats. Once added, your DNS records
                      (MX, SPF, DKIM) will be generated automatically so you can start provisioning team accounts.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowDomainModal(true)}
                      className="self-start px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
                      id="btn-add-first-domain-home"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Your First Domain</span>
                    </button>
                  </div>
                </section>
              ) : (
                <section className="flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col gap-0.5">
                      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Domains</h1>
                      <p className="text-xs text-slate-500">Every domain on this account and its mail setup.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowDomainModal(true)}
                      className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Add Domain</span>
                    </button>
                  </div>

                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={domainSearch}
                      onChange={(e) => setDomainSearch(e.target.value)}
                      placeholder="Search by domain name..."
                      className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-600/15 focus:border-indigo-600 transition-all placeholder:text-slate-400"
                    />
                  </div>

                  {(() => {
                    const filteredDomains = domains.filter((d) =>
                      d.domainName.toLowerCase().includes(domainSearch.trim().toLowerCase())
                    );
                    return (
                      <div className="data-table-container">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Domain</th>
                              <th>Status</th>
                              <th>Mailboxes</th>
                              <th>Plan</th>
                              <th style={{ textAlign: 'right' }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredDomains.length === 0 ? (
                              <tr>
                                <td colSpan={5} style={{ textAlign: 'center', color: 'var(--slate-400)' }}>
                                  No domains match "{domainSearch}".
                                </td>
                              </tr>
                            ) : (
                              filteredDomains.map((domain) => {
                                const isDnsActive = domain.dnsStatus === 'active';
                                const pill = dnsStatusPill(domain.dnsStatus);
                                const usagePercent = Math.min(100, Math.round((domain.mailboxCount / Math.max(1, domain.mailboxLimit)) * 100));
                                const barColor = usagePercent >= 90 ? 'bg-rose-500' : usagePercent >= 75 ? 'bg-amber-500' : 'bg-indigo-600';
                                return (
                                  <tr
                                    key={domain.id}
                                    onClick={() => onNavigateToDomain(domain.id)}
                                    style={{ cursor: 'pointer' }}
                                  >
                                    <td>
                                      <div className="flex items-center gap-2">
                                        <span className="font-semibold text-slate-900">{domain.domainName}</span>
                                        {domain.isPrimary && (
                                          <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600 border border-indigo-100">
                                            Primary
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td>
                                      <div className="flex items-center gap-1.5">
                                        {isDnsActive ? (
                                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                        ) : (
                                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                        )}
                                        <span>{pill.label}</span>
                                      </div>
                                    </td>
                                    <td>
                                      <div className="flex items-center gap-2 min-w-[140px]">
                                        <div className="flex-1 min-w-[60px] max-w-[80px] bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${usagePercent}%` }} />
                                        </div>
                                        <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
                                          {domain.mailboxCount} / {domain.mailboxLimit}
                                        </span>
                                      </div>
                                    </td>
                                    <td>{domain.planName || '—'}</td>
                                    <td style={{ textAlign: 'right' }}>
                                      <ChevronRight className="w-4 h-4 text-slate-300 inline-block" />
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                        <div className="pagination-row">
                          <span>
                            Showing {filteredDomains.length} of {domains.length}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                </section>
              )}
            </>
          )}

          {activeTab === 'apikeys' && <ApiKeysView />}

          {activeTab === 'billing' && <TenantBillingSummary domains={domains} />}

          {activeTab === 'security' && user && (
            <SecurityView user={user} on2FaStatusChange={setIs2FaEnabled} />
          )}

          {activeTab === 'audit' && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-6">
              <div className="flex flex-col gap-1 pb-4 border-b border-slate-100">
                <h2 className="text-lg font-semibold text-slate-900">Organization Audit Trail</h2>
                <p className="text-xs text-slate-500">
                  Immutable record of all administrative activities, mailbox operations, and security events.
                </p>
              </div>
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                      <th className="px-4 py-3">Timestamp</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">Resource</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Actor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400">
                          No audit log records found.
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                          <td className="px-4 py-3 font-medium text-slate-900">{formatAuditAction(log.action, log.metadata)}</td>
                          <td className="px-4 py-3 font-mono text-[11px] text-slate-600">{log.resource}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                log.success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                              }`}
                            >
                              {log.success ? 'Success' : 'Failed'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-500">{log.actor_role}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeTab === 'devices' && <ActiveDevicesView />}
        </div>
      </main>

      {showDomainModal && (
        <DomainSetupModal
          isOpen={showDomainModal}
          onClose={() => setShowDomainModal(false)}
          onDomainAdded={handleDomainAdded}
        />
      )}
    </div>
  );
};
