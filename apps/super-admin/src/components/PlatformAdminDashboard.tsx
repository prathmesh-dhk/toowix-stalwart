import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { api } from '../api';
import {
  TenantSummary,
  SystemMetrics,
  AuditItem,
  RegistrationApplication,
  SystemHealthDetails,
  BackupRecordItem,
  AlertConfig,
  DriftReport,
  UserContext,
} from '../types';
import {
  LayoutDashboard,
  ClipboardList,
  Building2,
  Server,
  History,
  AlertTriangle,
  CheckCircle2,
  X,
  Search,
  RefreshCw,
  LogOut,
  Mail,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  QrCode,
} from 'lucide-react';

// Views
import { DashboardOverviewView } from './views/DashboardOverviewView';
import { TenantApplicationsView } from './views/TenantApplicationsView';
import { TenantsManagementView } from './views/TenantsManagementView';
import { SystemOperationsView } from './views/SystemOperationsView';
import { AuditLogView } from './views/AuditLogView';

// Modals
import { ApplicationReviewModal } from './modals/ApplicationReviewModal';
import { TenantDetailModal } from './modals/TenantDetailModal';
import { TenantActivationModal } from './modals/TenantActivationModal';
import { CreateTenantModal } from './modals/CreateTenantModal';
import { ManageAdminsModal } from './modals/ManageAdminsModal';
import { UpdateQuotaModal } from './modals/UpdateQuotaModal';

export type DashboardTab = 'dashboard' | 'applications' | 'tenants' | 'operations' | 'audit';

export interface PlatformAdminDashboardProps {
  user?: UserContext | null;
  onLogout?: () => void;
  onUserUpdated?: (user: UserContext) => void;
}

export const PlatformAdminDashboard: React.FC<PlatformAdminDashboardProps> = ({
  user,
  onLogout,
  onUserUpdated,
}) => {
  // Navigation State
  const [activeTab, setActiveTab] = useState<DashboardTab>('dashboard');
  const [initialLoading, setInitialLoading] = useState(true);

  // Global Action Feedback Banner
  const [actionAlert, setActionAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Global Search
  const [globalSearch, setGlobalSearch] = useState('');

  // Telemetry Refresh State
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 2FA Setup Modal State
  const [show2FaModal, setShow2FaModal] = useState(false);
  const [setupData, setSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [setup2FaLoading, setSetup2FaLoading] = useState(false);
  const [setup2FaError, setSetup2FaError] = useState<string | null>(null);
  const [setup2FaSuccess, setSetup2FaSuccess] = useState(false);

  // Data States
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);

  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [healthDetails, setHealthDetails] = useState<SystemHealthDetails | null>(null);
  const [backups, setBackups] = useState<BackupRecordItem[]>([]);
  const [driftReport, setDriftReport] = useState<DriftReport | null>(null);
  const [alertConfig, setAlertConfig] = useState<AlertConfig>({
    webhookUrl: '',
    alertEmail: '',
    alertsEnabled: false,
    consecutiveFailureThreshold: 3,
  });
  const [operationsLoading, setOperationsLoading] = useState(false);

  const [applications, setApplications] = useState<RegistrationApplication[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);

  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // Modal Triggers
  const [reviewApp, setReviewApp] = useState<RegistrationApplication | null>(null);
  const [detailTenant, setDetailTenant] = useState<TenantSummary | null>(null);
  const [activateTenant, setActivateTenant] = useState<TenantSummary | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [adminTenant, setAdminTenant] = useState<TenantSummary | null>(null);
  const [quotaTenant, setQuotaTenant] = useState<TenantSummary | null>(null);

  // User Initials
  const userInitials = useMemo(() => {
    if (!user?.email) return 'SA';
    const namePart = user.email.split('@')[0];
    const parts = namePart.split(/[._-]/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return namePart.slice(0, 2).toUpperCase();
  }, [user]);

  // 1. Data Fetchers
  const loadTenantsAndMetrics = useCallback(async () => {
    setTenantsLoading(true);
    try {
      const [tenantsRes, metricsRes] = await Promise.all([
        api.listTenants().catch(() => ({ tenants: [] })),
        api.getSystemStatus().catch(() => null),
      ]);
      setTenants(tenantsRes.tenants || []);
      if (metricsRes) setMetrics(metricsRes);
    } catch (err) {
      console.error('Failed to load tenants:', err);
    } finally {
      setTenantsLoading(false);
    }
  }, []);

  const loadApplications = useCallback(async () => {
    setAppsLoading(true);
    try {
      const res = await api.listApplications({ limit: 100 });
      setApplications(res.applications || []);
    } catch (err) {
      console.error('Failed to load applications:', err);
    } finally {
      setAppsLoading(false);
    }
  }, []);

  const loadOperationsData = useCallback(async () => {
    setOperationsLoading(true);
    try {
      const [health, backupsRes, alerts, drift] = await Promise.all([
        api.getDetailedSystemHealth().catch(() => null),
        api.listBackups().catch(() => ({ backups: [] })),
        api.getAlertConfig().catch(() => null),
        api.getReconciliationReport().catch(() => null),
      ]);
      if (health) setHealthDetails(health);
      if (backupsRes) setBackups(backupsRes.backups || []);
      if (alerts) {
        setAlertConfig({
          webhookUrl: alerts.webhookUrl || '',
          alertEmail: alerts.alertEmail || '',
          alertsEnabled: Boolean(alerts.alertsEnabled),
          consecutiveFailureThreshold: alerts.consecutiveFailureThreshold || 3,
        });
      }
      if (drift) setDriftReport(drift);
    } catch (err) {
      console.error('Failed to load operations data:', err);
    } finally {
      setOperationsLoading(false);
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await api.getAuditLogs({ limit: 80 });
      setAuditLogs(res.logs || []);
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  // Initial Boot Load
  useEffect(() => {
    const init = async () => {
      setInitialLoading(true);
      await Promise.all([
        loadTenantsAndMetrics(),
        loadApplications(),
        loadOperationsData(),
        loadAuditLogs(),
      ]);
      setLastRefreshed(new Date());
      setInitialLoading(false);
    };
    init();
  }, [loadTenantsAndMetrics, loadApplications, loadOperationsData, loadAuditLogs]);

  // Tab change refreshes
  useEffect(() => {
    if (activeTab === 'applications') loadApplications();
    if (activeTab === 'tenants') loadTenantsAndMetrics();
    if (activeTab === 'operations') loadOperationsData();
    if (activeTab === 'audit') loadAuditLogs();
    if (activeTab === 'dashboard') {
      loadTenantsAndMetrics();
      loadOperationsData();
      loadApplications();
    }
  }, [activeTab, loadTenantsAndMetrics, loadApplications, loadOperationsData, loadAuditLogs]);

  // Refresh Telemetry Handler
  const handleRefreshTelemetry = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        loadTenantsAndMetrics(),
        loadOperationsData(),
        loadApplications(),
        loadAuditLogs(),
      ]);
      setLastRefreshed(new Date());
    } finally {
      setIsRefreshing(false);
    }
  };

  // Action Alert Handler
  const showAlert = (type: 'success' | 'error', message: string) => {
    setActionAlert({ type, message });
  };

  // Lifecycle Action Handlers
  const handleApproveApplication = async (appId: string) => {
    setActionAlert(null);
    try {
      const res = await api.approveApplication(appId);
      showAlert(
        'success',
        res.emailSent
          ? `Application approved. Domain "${res.tenant.domain}" provisioned and activation email dispatched to ${res.tenant.contactEmail}.`
          : `Application approved. Domain "${res.tenant.domain}" provisioned.`
      );
      await Promise.all([loadApplications(), loadTenantsAndMetrics()]);
    } catch (err: any) {
      showAlert('error', err.message || 'Failed to approve application.');
      throw err;
    }
  };

  const handleRejectApplication = async (appId: string, reason: string) => {
    setActionAlert(null);
    try {
      const res = await api.rejectApplication(appId, reason);
      showAlert('success', `Application rejected: ${res.message || 'Reason recorded.'}`);
      await loadApplications();
    } catch (err: any) {
      showAlert('error', err.message || 'Failed to reject application.');
      throw err;
    }
  };

  const handleToggleSuspend = async (tenant: TenantSummary) => {
    const isSuspending = tenant.status === 'active';
    const confirmPrompt = isSuspending
      ? `Are you sure you want to suspend tenant "${tenant.name}"? This immediately locks tenant admin access, freezes all mailbox authentication in Stalwart, and prevents outbound delivery.`
      : `Reactivate tenant "${tenant.name}" and restore mailbox routing?`;

    if (!confirm(confirmPrompt)) return;

    try {
      if (isSuspending) {
        await api.suspendTenant(tenant.id);
        showAlert('success', `Tenant "${tenant.name}" suspended. Access frozen.`);
      } else {
        await api.reactivateTenant(tenant.id);
        showAlert('success', `Tenant "${tenant.name}" reactivated. Access restored.`);
      }
      await loadTenantsAndMetrics();
    } catch (err: any) {
      showAlert('error', err.message || 'Failed to update tenant status.');
    }
  };

  const handleDeleteTenant = async (tenant: TenantSummary) => {
    if (!confirm(`CAUTION: Are you sure you want to permanently delete tenant "${tenant.name}" and all associated mailboxes? This action cannot be undone.`)) {
      return;
    }

    try {
      await api.deleteTenant(tenant.id);
      showAlert('success', `Tenant "${tenant.name}" and all records permanently removed.`);
      await loadTenantsAndMetrics();
    } catch (err: any) {
      showAlert('error', err.message || 'Failed to delete tenant.');
    }
  };

  // 2FA Setup Handlers
  const handleOpen2FaSetup = async () => {
    setShow2FaModal(true);
    setSetup2FaLoading(true);
    setSetup2FaError(null);
    setSetup2FaSuccess(false);
    try {
      const data = await api.setup2Fa();
      setSetupData(data);
    } catch (err: any) {
      setSetup2FaError(err.message || 'Unable to set up two-factor authentication. Please try again.');
    } finally {
      setSetup2FaLoading(false);
    }
  };

  const handleConfirm2Fa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!totpCode || totpCode.length !== 6) {
      setSetup2FaError('Enter a valid 6-digit code.');
      return;
    }

    setSetup2FaLoading(true);
    setSetup2FaError(null);
    try {
      await api.confirm2Fa(totpCode);
      setSetup2FaSuccess(true);
      if (onUserUpdated && user) {
        onUserUpdated({ ...user, twoFactorEnabled: true });
      }
      setTimeout(() => {
        setShow2FaModal(false);
        setSetupData(null);
        setTotpCode('');
      }, 1500);
    } catch (err: any) {
      setSetup2FaError(err.message || 'Verification failed. The code is invalid or has expired.');
    } finally {
      setSetup2FaLoading(false);
    }
  };

  // Operational badges
  const pendingAppsCount = applications.filter((a) => a.status === 'PENDING_REVIEW').length;
  const activeTenantsCount = tenants.filter((t) => t.status === 'active').length;

  const mongoStatus = healthDetails?.services?.mongodb?.status || 'healthy';
  const stalwartStatus = healthDetails?.services?.stalwart?.status || metrics?.stalwart?.status || 'connected';
  const hasSystemIssue = mongoStatus !== 'healthy' || stalwartStatus !== 'connected';

  // Global search filtering
  const filteredTenants = useMemo(() => {
    if (!globalSearch.trim()) return tenants;
    const q = globalSearch.toLowerCase().trim();
    return tenants.filter(
      (t) =>
        t.name?.toLowerCase().includes(q) ||
        t.domain?.domainName?.toLowerCase().includes(q)
    );
  }, [tenants, globalSearch]);

  const filteredApplications = useMemo(() => {
    if (!globalSearch.trim()) return applications;
    const q = globalSearch.toLowerCase().trim();
    return applications.filter(
      (a) =>
        a.companyName?.toLowerCase().includes(q) ||
        a.requestedDomain?.toLowerCase().includes(q) ||
        a.applicantName?.toLowerCase().includes(q) ||
        a.contactEmail?.toLowerCase().includes(q)
    );
  }, [applications, globalSearch]);

  const formatLastUpdated = (d: Date) => {
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec < 20) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    return `${diffMin}m ago`;
  };

  if (initialLoading) {
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="h-10 w-10 rounded-lg bg-quartz-900 flex items-center justify-center text-white mx-auto shadow-sm animate-pulse">
            <Mail size={20} />
          </div>
          <div className="text-xs font-semibold text-quartz-700">
            Initializing Super Admin Operational Control Center...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] text-quartz-900 font-sans antialiased flex flex-row selection:bg-slate-800 selection:text-white">
      {/* ================= GLOBAL SIDEBAR (CALM, CLEAN & FOCUSED) ================= */}
      <aside className="w-64 bg-white border-r border-quartz-200 flex flex-col justify-between shrink-0 min-h-screen z-30 sticky top-0 h-screen">
        <div className="p-6">
          {/* Brand Header */}
          <div className="flex items-center justify-between pb-6 mb-6 border-b border-quartz-100">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-quartz-900 flex items-center justify-center text-white shadow-sm">
                <Mail size={19} className="text-white" />
              </div>
              <div>
                <span className="font-bold text-sm tracking-wider text-quartz-900 uppercase font-mono block">
                  TOOWIX MAIL
                </span>
                <span className="text-[11px] text-quartz-500 font-medium">Platform Console</span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-slate-100 text-quartz-700 tracking-wider uppercase border border-quartz-200">
              Super Admin
            </span>
          </div>

          {/* 5 Primary Navigation Items */}
          <nav className="space-y-1.5">
            <button
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs transition ${
                activeTab === 'dashboard'
                  ? 'font-semibold bg-quartz-100 text-quartz-900'
                  : 'font-medium text-quartz-600 hover:text-quartz-900 hover:bg-quartz-50'
              }`}
              id="nav-dashboard"
              onClick={() => setActiveTab('dashboard')}
            >
              <LayoutDashboard
                size={18}
                className={activeTab === 'dashboard' ? 'text-quartz-900' : 'text-quartz-400'}
              />
              <span>Dashboard</span>
            </button>

            <button
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs transition ${
                activeTab === 'applications'
                  ? 'font-semibold bg-quartz-100 text-quartz-900'
                  : 'font-medium text-quartz-600 hover:text-quartz-900 hover:bg-quartz-50'
              }`}
              id="nav-applications"
              onClick={() => setActiveTab('applications')}
            >
              <div className="flex items-center gap-3">
                <ClipboardList
                  size={18}
                  className={activeTab === 'applications' ? 'text-quartz-900' : 'text-quartz-400'}
                />
                <span>Tenant Applications</span>
              </div>
              {pendingAppsCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 tabular-nums">
                  {pendingAppsCount}
                </span>
              )}
            </button>

            <button
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs transition ${
                activeTab === 'tenants'
                  ? 'font-semibold bg-quartz-100 text-quartz-900'
                  : 'font-medium text-quartz-600 hover:text-quartz-900 hover:bg-quartz-50'
              }`}
              id="nav-tenants"
              onClick={() => setActiveTab('tenants')}
            >
              <div className="flex items-center gap-3">
                <Building2
                  size={18}
                  className={activeTab === 'tenants' ? 'text-quartz-900' : 'text-quartz-400'}
                />
                <span>Tenants</span>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-quartz-100 text-quartz-600 tabular-nums">
                {activeTenantsCount}
              </span>
            </button>

            <button
              className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs transition ${
                activeTab === 'operations'
                  ? 'font-semibold bg-quartz-100 text-quartz-900'
                  : 'font-medium text-quartz-600 hover:text-quartz-900 hover:bg-quartz-50'
              }`}
              id="nav-system-health"
              onClick={() => setActiveTab('operations')}
            >
              <div className="flex items-center gap-3">
                <Server
                  size={18}
                  className={activeTab === 'operations' ? 'text-quartz-900' : 'text-quartz-400'}
                />
                <span>System Health</span>
              </div>
              <span
                className={`h-2 w-2 rounded-full ${hasSystemIssue ? 'bg-rose-500' : 'bg-emerald-500'}`}
              />
            </button>

            <button
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-xs transition ${
                activeTab === 'audit'
                  ? 'font-semibold bg-quartz-100 text-quartz-900'
                  : 'font-medium text-quartz-600 hover:text-quartz-900 hover:bg-quartz-50'
              }`}
              id="nav-audit-log"
              onClick={() => setActiveTab('audit')}
            >
              <History
                size={18}
                className={activeTab === 'audit' ? 'text-quartz-900' : 'text-quartz-400'}
              />
              <span>Audit Log</span>
            </button>
          </nav>
        </div>

        {/* Bottom Workspace Footer */}
        <div className="p-6 border-t border-quartz-100 flex items-center justify-between text-[11px] text-quartz-400 font-mono">
          <span>Toowix Core</span>
          <span>v2.4.0</span>
        </div>
      </aside>

      {/* ================= MAIN WORKSPACE ================= */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#f8fafc] overflow-y-auto">
        {/* Top Header Bar */}
        <header className="h-16 bg-white border-b border-quartz-200 px-8 flex items-center justify-between sticky top-0 z-20 gap-6">
          {/* Search Bar */}
          <div className="relative flex-1 max-w-xl">
            <Search size={16} className="absolute left-3.5 top-3 text-quartz-400" />
            <input
              className="w-full bg-quartz-50 hover:bg-white focus:bg-white border border-transparent focus:border-quartz-300 rounded-lg pl-10 pr-4 py-2 text-xs text-quartz-800 placeholder-quartz-400 focus:outline-none transition"
              placeholder="Search tenants, domains, applications..."
              type="text"
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
            />
          </div>

          {/* Right Controls: Status & User Profile */}
          <div className="flex items-center gap-4">
            {/* Last Updated Indicator with Refresh */}
            <div className="flex items-center gap-2 text-[11px] text-quartz-500">
              <span id="lastUpdatedText">Last updated {formatLastUpdated(lastRefreshed)}</span>
              <button
                className={`p-1 hover:bg-quartz-100 rounded text-quartz-400 hover:text-quartz-700 transition ${
                  isRefreshing ? 'animate-spin' : ''
                }`}
                onClick={handleRefreshTelemetry}
                title="Refresh telemetry"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            {/* Webmail Link */}
            <a
              href="http://localhost:8888"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-quartz-200 text-xs font-medium text-quartz-700 hover:bg-quartz-50 transition"
              title="Open Webmail"
            >
              <Mail size={13} className="text-quartz-600" />
              <span>Webmail</span>
              <ExternalLink size={11} className="text-quartz-400" />
            </a>

            {/* 2FA Security Pill / Setup */}
            {user?.twoFactorEnabled ? (
              <span
                className="hidden lg:inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200"
                title="Two-factor authentication is active"
              >
                <ShieldCheck size={13} /> 2FA Active
              </span>
            ) : (
              <button
                onClick={handleOpen2FaSetup}
                className="hidden lg:inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition"
                title="Set up two-factor authentication"
              >
                <ShieldAlert size={13} /> Set up 2FA
              </button>
            )}

            {/* Super Admin Profile */}
            <div className="flex items-center gap-3 pl-4 border-l border-quartz-200">
              <div className="h-8 w-8 rounded-full bg-slate-100 border border-quartz-200 text-quartz-800 flex items-center justify-center font-bold text-xs font-mono">
                {userInitials}
              </div>
              <div className="leading-tight hidden sm:block">
                <div className="text-xs font-semibold text-quartz-900">
                  {user?.email || 'sysadmin@toowix.net'}
                </div>
                <div className="text-[11px] text-quartz-500 font-medium">Super Admin</div>
              </div>
              {onLogout && (
                <button
                  className="p-1.5 text-quartz-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition ml-1"
                  onClick={onLogout}
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Workspace Container */}
        <div className="p-8 max-w-[1440px] w-full mx-auto space-y-7">
          {/* Global Action Alert Notification Banner */}
          {actionAlert && (
            <div
              className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
                actionAlert.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-rose-50 border-rose-200 text-rose-800'
              }`}
            >
              <div className="flex items-center gap-2.5 text-xs font-medium">
                {actionAlert.type === 'success' ? (
                  <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                ) : (
                  <AlertTriangle size={16} className="text-rose-600 shrink-0" />
                )}
                <span>{actionAlert.message}</span>
              </div>
              <button
                onClick={() => setActionAlert(null)}
                className="text-quartz-400 hover:text-quartz-700"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Active Area Content */}
          {activeTab === 'dashboard' && (
            <DashboardOverviewView
              tenants={filteredTenants}
              metrics={metrics}
              healthDetails={healthDetails}
              applications={filteredApplications}
              backups={backups}
              driftReport={driftReport}
              recentAuditLogs={auditLogs}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onReviewApplication={(app) => setReviewApp(app)}
              onActivateTenant={(tenant) => setActivateTenant(tenant)}
            />
          )}

          {activeTab === 'applications' && (
            <TenantApplicationsView
              applications={filteredApplications}
              loading={appsLoading}
              onRefresh={loadApplications}
              onReviewApplication={(app) => setReviewApp(app)}
            />
          )}

          {activeTab === 'tenants' && (
            <TenantsManagementView
              tenants={filteredTenants}
              loading={tenantsLoading}
              onRefresh={loadTenantsAndMetrics}
              onCreateTenant={() => setShowCreateModal(true)}
              onViewDetails={(tenant) => setDetailTenant(tenant)}
              onActivateTenant={(tenant) => setActivateTenant(tenant)}
              onToggleSuspend={handleToggleSuspend}
              onManageAdmins={(tenant) => setAdminTenant(tenant)}
              onUpdateQuota={(tenant) => setQuotaTenant(tenant)}
              onDeleteTenant={handleDeleteTenant}
            />
          )}

          {activeTab === 'operations' && (
            <SystemOperationsView
              healthDetails={healthDetails}
              metrics={metrics}
              backups={backups}
              driftReport={driftReport}
              alertConfig={alertConfig}
              loading={operationsLoading}
              onRefreshAll={loadOperationsData}
              onShowAlert={showAlert}
            />
          )}

          {activeTab === 'audit' && (
            <AuditLogView
              logs={auditLogs}
              loading={auditLoading}
              onRefresh={loadAuditLogs}
            />
          )}
        </div>
      </main>

      {/* ================= MODALS LAYER ================= */}
      {/* Review Application Modal */}
      <ApplicationReviewModal
        application={reviewApp}
        isOpen={Boolean(reviewApp)}
        onClose={() => setReviewApp(null)}
        onApprove={handleApproveApplication}
        onReject={handleRejectApplication}
      />

      {/* Tenant Detail Modal */}
      <TenantDetailModal
        tenant={detailTenant}
        isOpen={Boolean(detailTenant)}
        onClose={() => setDetailTenant(null)}
        onActivateTenant={(t: TenantSummary) => {
          setDetailTenant(null);
          setActivateTenant(t);
        }}
        onToggleSuspend={handleToggleSuspend}
        onManageAdmins={(t: TenantSummary) => {
          setDetailTenant(null);
          setAdminTenant(t);
        }}
        onUpdateQuota={(t: TenantSummary) => {
          setDetailTenant(null);
          setQuotaTenant(t);
        }}
        onDeleteTenant={handleDeleteTenant}
      />

      {/* Tenant Activation Modal */}
      <TenantActivationModal
        tenant={activateTenant}
        isOpen={Boolean(activateTenant)}
        onClose={() => setActivateTenant(null)}
        onActivated={() => {
          loadTenantsAndMetrics();
        }}
      />

      {/* Provision Tenant Modal */}
      <CreateTenantModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onTenantCreated={() => {
          showAlert('success', 'Tenant provisioned successfully.');
          loadTenantsAndMetrics();
        }}
      />

      {/* Manage Admins Modal */}
      <ManageAdminsModal
        isOpen={Boolean(adminTenant)}
        tenant={adminTenant}
        onClose={() => setAdminTenant(null)}
        onUpdated={() => {
          loadTenantsAndMetrics();
        }}
      />

      {/* Update Mailbox Quota Modal */}
      <UpdateQuotaModal
        isOpen={Boolean(quotaTenant)}
        tenant={quotaTenant}
        onClose={() => setQuotaTenant(null)}
        onQuotaUpdated={() => {
          showAlert('success', 'Mailbox limit updated.');
          loadTenantsAndMetrics();
        }}
      />

      {/* 2FA Setup Modal */}
      {show2FaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-quartz-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-xl border border-quartz-200 shadow-2xl max-w-md w-full overflow-hidden text-xs">
            <div className="px-6 py-4 border-b border-quartz-200 flex items-center justify-between bg-quartz-50">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-quartz-900 text-white flex items-center justify-center">
                  <QrCode size={16} />
                </div>
                <div>
                  <h3 className="font-bold text-quartz-900 text-xs uppercase tracking-wider">
                    Two-Factor Authentication
                  </h3>
                  <p className="text-[11px] text-quartz-500">Enhance platform operator security</p>
                </div>
              </div>
              <button
                onClick={() => setShow2FaModal(false)}
                className="text-quartz-400 hover:text-quartz-700"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {setup2FaError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded text-rose-700 text-xs">
                  {setup2FaError}
                </div>
              )}

              {setup2FaSuccess ? (
                <div className="text-center py-6 space-y-2">
                  <CheckCircle2 size={42} className="text-emerald-600 mx-auto" />
                  <div className="font-bold text-quartz-900 text-sm">2FA Successfully Enabled</div>
                  <p className="text-quartz-500 text-xs">
                    Your Super Admin account is now secured with TOTP verification.
                  </p>
                </div>
              ) : setup2FaLoading && !setupData ? (
                <div className="text-center py-10 text-quartz-500 text-xs">
                  Generating authentication secret...
                </div>
              ) : setupData ? (
                <form onSubmit={handleConfirm2Fa} className="space-y-4">
                  <p className="text-quartz-600">
                    1. Scan this QR code with your authenticator app (Google Authenticator, 1Password, etc.):
                  </p>
                  <div className="bg-white p-3 border border-quartz-200 rounded-lg flex items-center justify-center">
                    <img
                      src={setupData.qrCodeDataUrl}
                      alt="2FA QR Code"
                      className="w-44 h-44 block"
                    />
                  </div>
                  <div className="bg-quartz-50 p-2.5 rounded border border-quartz-200 text-center font-mono text-[11px] text-quartz-700 select-all">
                    Key: <strong>{setupData.secret}</strong>
                  </div>

                  <div>
                    <label className="block font-medium text-quartz-700 mb-1">
                      2. Enter the 6-digit verification code:
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="123456"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full bg-white border border-quartz-200 rounded-lg px-3 py-2 text-center text-base font-mono tracking-widest text-quartz-900 focus:border-quartz-900 focus:outline-none"
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setShow2FaModal(false)}
                      className="flex-1 py-2 bg-white border border-quartz-200 hover:bg-quartz-50 rounded-lg text-xs font-medium text-quartz-700 transition"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={setup2FaLoading || totpCode.length !== 6}
                      className="flex-1 py-2 bg-quartz-900 hover:bg-slate-800 disabled:opacity-50 text-white rounded-lg text-xs font-medium transition shadow-xs"
                    >
                      {setup2FaLoading ? 'Verifying...' : 'Enable 2FA'}
                    </button>
                  </div>
                </form>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
