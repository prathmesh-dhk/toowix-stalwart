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
  PlatformAnalytics,
  Plan,
} from '../types';
import {
  CheckCircle2,
  X,
  QrCode,
  Loader2,
  ShieldAlert,
  Shield,
  ArrowRight,
  LogOut,
  LayoutDashboard,
  ClipboardList,
  Building2,
  Server,
  Receipt,
  Laptop,
  BarChart3,
  Copy,
  Check,
  Printer,
  Layers,
  Archive,
} from 'lucide-react';
import toowixLogo from '../assets/toowix-logo.svg';
import { Button } from './ui/Button';
import { Alert } from './ui/Alert';

// Views
import { DashboardOverviewView } from './views/DashboardOverviewView';
import { TenantApplicationsView } from './views/TenantApplicationsView';
import { DeletedOrganisationsView } from './views/DeletedOrganisationsView';
import { TenantsManagementView } from './views/TenantsManagementView';
import { TenantDetailView } from './views/TenantDetailView';
import { SystemOperationsView } from './views/SystemOperationsView';
import { AuditLogView } from './views/AuditLogView';
import { ActiveDevicesView } from './views/ActiveDevicesView';
import { AnalyticsView } from './views/AnalyticsView';
import { PlansManagementView } from './views/PlansManagementView';

// Modals
import { ApplicationReviewModal } from './modals/ApplicationReviewModal';
import { TenantDetailModal } from './modals/TenantDetailModal';
import { TenantActivationModal } from './modals/TenantActivationModal';
import { CreateTenantModal } from './modals/CreateTenantModal';
import { ManageAdminsModal } from './modals/ManageAdminsModal';
import { UpdateQuotaModal } from './modals/UpdateQuotaModal';
import { PlanFormModal } from './modals/PlanFormModal';

export type DashboardTab = 'dashboard' | 'applications' | 'deleted-organisations' | 'tenants' | 'plans' | 'analytics' | 'operations' | 'audit' | 'devices';

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




  // 2FA Setup Modal State
  const [show2FaModal, setShow2FaModal] = useState(false);
  const [setupData, setSetupData] = useState<{ secret: string; qrCodeDataUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [setup2FaLoading, setSetup2FaLoading] = useState(false);
  const [setup2FaError, setSetup2FaError] = useState<string | null>(null);
  const [setup2FaSuccess, setSetup2FaSuccess] = useState(false);
  const [setupBackupCodes, setSetupBackupCodes] = useState<string[]>([]);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // 2FA Setup Reminder Banner State (removable per login session)
  const [dismissed2FaBanner, setDismissed2FaBanner] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('toowix_dismissed_2fa_banner') === 'true';
    } catch {
      return false;
    }
  });

  const handleDismiss2FaBanner = () => {
    setDismissed2FaBanner(true);
    try {
      sessionStorage.setItem('toowix_dismissed_2fa_banner', 'true');
    } catch {
      // ignore
    }
  };

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

  const [analyticsData, setAnalyticsData] = useState<PlatformAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);

  // Modal Triggers
  const [reviewApp, setReviewApp] = useState<RegistrationApplication | null>(null);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(null);
  const [detailTenant, setDetailTenant] = useState<TenantSummary | null>(null);
  const [activateTenant, setActivateTenant] = useState<TenantSummary | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [adminTenant, setAdminTenant] = useState<TenantSummary | null>(null);
  const [quotaTenant, setQuotaTenant] = useState<TenantSummary | null>(null);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

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

  // Data Fetchers
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

  const loadPlans = useCallback(async () => {
    setPlansLoading(true);
    try {
      const res = await api.listAllPlans();
      setPlans(res.plans || []);
    } catch (err) {
      console.error('Failed to load plans:', err);
    } finally {
      setPlansLoading(false);
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

  const loadAnalytics = useCallback(async () => {
    setAnalyticsLoading(true);
    try {
      const res = await api.getAnalytics();
      setAnalyticsData(res);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setAnalyticsLoading(false);
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
      setInitialLoading(false);
    };
    init();
  }, [loadTenantsAndMetrics, loadApplications, loadOperationsData, loadAuditLogs]);

  // Tab change refreshes
  useEffect(() => {
    if (activeTab === 'applications') loadApplications();
    if (activeTab === 'tenants') loadTenantsAndMetrics();
    if (activeTab === 'plans') loadPlans();
    if (activeTab === 'operations') loadOperationsData();
    if (activeTab === 'audit') loadAuditLogs();
    if (activeTab === 'analytics') loadAnalytics();
    if (activeTab === 'dashboard') {
      loadTenantsAndMetrics();
      loadOperationsData();
      loadApplications();
      loadAnalytics();
    }
  }, [activeTab, loadTenantsAndMetrics, loadApplications, loadOperationsData, loadAuditLogs, loadAnalytics, loadPlans]);



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

  // Organisation deletion is a multi-day security flow (reason, name, OTP) with a permanent
  // audit record, so "Delete" opens the organisation's Danger Zone instead of deleting on one click.
  const handleDeleteTenant = (tenant: TenantSummary) => {
    setDetailTenant(null);
    setActiveTab('tenants');
    setSelectedTenantId(tenant.id);
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
      const res = await api.confirm2Fa(totpCode);
      setSetup2FaSuccess(true);
      if (res.backupCodes && res.backupCodes.length > 0) {
        setSetupBackupCodes(res.backupCodes);
      }
      if (onUserUpdated && user) {
        onUserUpdated({ ...user, twoFactorEnabled: true });
      }
      if (!res.backupCodes || res.backupCodes.length === 0) {
        setTimeout(() => {
          setShow2FaModal(false);
          setSetupData(null);
          setTotpCode('');
          setSetup2FaSuccess(false);
        }, 1500);
      }
    } catch (err: any) {
      setSetup2FaError(err.message || 'Verification failed. The code is invalid or has expired.');
    } finally {
      setSetup2FaLoading(false);
    }
  };

  const handlePrintBackupCodes = () => {
    if (!setupBackupCodes.length) return;
    try {
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        window.print();
        return;
      }
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Toowix Mail - Emergency Backup Codes</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                padding: 40px;
                color: #0f172a;
                max-width: 480px;
                margin: 0 auto;
              }
              .header {
                border-bottom: 2px solid #e2e8f0;
                padding-bottom: 16px;
                margin-bottom: 20px;
              }
              h1 {
                font-size: 20px;
                margin: 0 0 6px 0;
                color: #0f172a;
              }
              p {
                font-size: 13px;
                color: #64748b;
                margin: 0;
                line-height: 1.5;
              }
              .alert {
                background: #fffbeb;
                border: 1px solid #fde68a;
                padding: 10px 14px;
                border-radius: 8px;
                font-size: 12px;
                color: #92400e;
                margin: 16px 0 20px 0;
              }
              .codes-block {
                background: #f8fafc;
                border: 1px solid #cbd5e1;
                border-radius: 8px;
                padding: 18px 24px;
                font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
                font-size: 15px;
                line-height: 1.9;
                text-align: center;
                font-weight: 700;
                letter-spacing: 1.5px;
              }
              .code-row {
                padding: 1px 0;
              }
              .footer {
                margin-top: 24px;
                font-size: 11px;
                color: #94a3b8;
                text-align: center;
                border-top: 1px solid #f1f5f9;
                padding-top: 12px;
              }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>Toowix Mail - Emergency Backup Codes</h1>
              <p>Keep these 10 single-use codes in a safe place. Each code can only be used once to bypass two-factor authentication.</p>
            </div>
            <div class="alert">
              Important: Each code can only be used once. If you regenerate new codes, all previous codes will stop working.
            </div>
            <div class="codes-block">
              ${setupBackupCodes.map((code) => `
                <div class="code-row">${code}</div>
              `).join('')}
            </div>
            <div class="footer">
              Generated on ${new Date().toLocaleDateString()} &bull; Toowix Account Security
            </div>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
      printWindow.close();
    } catch {
      window.print();
    }
  };

  // Operational badges
  const pendingAppsCount = applications.filter((a) => a.status === 'PENDING_REVIEW').length;
  const activeTenantsCount = tenants.filter((t) => t.status === 'active').length;

  const mongoStatus = healthDetails?.services?.mongodb?.status || 'healthy';
  const stalwartStatus = healthDetails?.services?.stalwart?.status || metrics?.stalwart?.status || 'connected';
  const hasSystemIssue = mongoStatus !== 'healthy' || stalwartStatus !== 'connected';


  if (initialLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
          <div className="text-xs font-semibold text-slate-700">
            Loading Super Admin platform console...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] font-sans text-slate-900 antialiased selection:bg-indigo-100 selection:text-indigo-900">
      {/* ========================================================================= */}
      {/* TOP HEADER (MATCHING TENANT ADMIN & STITCH DESIGN)                        */}
      {/* ========================================================================= */}
      <header className="fixed top-0 inset-x-0 z-40 bg-white border-b border-slate-200 h-16">
        <div className="h-full px-6 flex items-center justify-between">
          {/* Brand & Platform Context */}
          <div className="flex items-center gap-6">
            {/* Brand */}
            <div className="flex items-center gap-3 w-56">
              <img src={toowixLogo} alt="Toowix" className="w-8 h-8 object-contain" />
              <div className="flex flex-col">
                <span className="font-semibold text-slate-900 text-sm tracking-tight leading-tight">
                  TOOWIX MAIL
                </span>
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  Platform Console
                </span>
              </div>
            </div>

          </div>

          {/* Right Utility Actions */}
          <div className="flex items-center gap-4">

            {/* 2FA Security Pill / Setup */}
            {user?.twoFactorEnabled ? (
              <span
                className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200/60"
                title="Two-factor authentication is active"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                <span>2FA Active</span>
              </span>
            ) : (
              <button
                onClick={handleOpen2FaSetup}
                className="hidden lg:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
                title="Set up two-factor authentication"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                <span>Set up 2FA</span>
              </button>
            )}

            {/* Super Admin Profile */}
            <div className="flex items-center gap-3 pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-semibold">
                {userInitials}
              </div>
              <div className="hidden lg:flex flex-col text-left">
                <span className="text-xs font-medium text-slate-900 leading-tight">
                  {user?.email || 'admin@toowix.com'}
                </span>
                <span className="text-[11px] text-slate-400 font-normal leading-tight">
                  Super Admin
                </span>
              </div>
            </div>

            {/* Sign Out */}
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
      {/* SIDEBAR NAVIGATION RAIL (MATCHING GOOGLE ADMIN & DESIGN.MD)               */}
      {/* ========================================================================= */}
      <aside className="fixed left-0 top-16 bottom-0 w-60 bg-white border-r border-slate-200 z-30 flex flex-col justify-between px-3 py-4 select-none">
        <div className="flex flex-col gap-1 overflow-y-auto">
          {/* Main Navigation Group */}
          <div className="flex flex-col gap-0.5">
            {/* Dashboard */}
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeTab === 'dashboard'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-dashboard"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <LayoutDashboard
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeTab === 'dashboard' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Dashboard</span>
              </div>
            </button>

            {/* Domain Applications */}
            <button
              onClick={() => setActiveTab('applications')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeTab === 'applications'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-applications"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <ClipboardList
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeTab === 'applications' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Domain Applications</span>
              </div>
              {pendingAppsCount > 0 ? (
                <span className="text-xs font-semibold text-indigo-700 bg-indigo-100/90 px-2.5 py-0.5 rounded-full border border-indigo-200/60">
                  {pendingAppsCount}
                </span>
              ) : (
                <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200/60">
                  0
                </span>
              )}
            </button>

            {/* Deleted Organisations (permanent audit records) */}
            <button
              onClick={() => setActiveTab('deleted-organisations')}
              className={`w-full h-10 px-4 flex items-center gap-3.5 rounded-full text-sm transition-colors duration-150 text-left group ${
                activeTab === 'deleted-organisations'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-deleted-organisations"
            >
              <Archive
                className={`w-5 h-5 shrink-0 transition-colors ${
                  activeTab === 'deleted-organisations' ? 'text-rose-600' : 'text-slate-500 group-hover:text-slate-700'
                }`}
                strokeWidth={1.75}
              />
              <span className="truncate">Deleted Organisations</span>
            </button>

            {/* Tenants */}
            <button
              onClick={() => {
                setActiveTab('tenants');
                setSelectedTenantId(null);
              }}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeTab === 'tenants'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-tenants"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Building2
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeTab === 'tenants' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Tenants</span>
              </div>
              <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200/60">
                {activeTenantsCount}
              </span>
            </button>

            {/* Plans */}
            <button
              onClick={() => setActiveTab('plans')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeTab === 'plans'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-plans"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Layers
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeTab === 'plans' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Plans</span>
              </div>
            </button>

            {/* Analytics */}
            <button
              onClick={() => setActiveTab('analytics')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeTab === 'analytics'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-analytics"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <BarChart3
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeTab === 'analytics' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Analytics</span>
              </div>
            </button>
          </div>

          {/* Divider matching Google Admin console */}
          <div className="my-2 border-t border-slate-200/80" />

          {/* System Operations & Governance Group */}
          <div className="flex flex-col gap-0.5">
            {/* System Health */}
            <button
              onClick={() => setActiveTab('operations')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeTab === 'operations'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-system-health"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Server
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeTab === 'operations' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">System Health</span>
              </div>
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${hasSystemIssue ? 'bg-rose-500' : 'bg-emerald-500'}`}
              />
            </button>

            {/* Audit Log */}
            <button
              onClick={() => setActiveTab('audit')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeTab === 'audit'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-audit-log"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Receipt
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeTab === 'audit' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Audit Log</span>
              </div>
            </button>

            {/* Devices */}
            <button
              onClick={() => setActiveTab('devices')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeTab === 'devices'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-devices"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Laptop
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeTab === 'devices' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Active Devices</span>
              </div>
            </button>
          </div>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* MAIN VIEW CONTAINER                                                       */}
      {/* ========================================================================= */}
      <div className="pl-60 pt-16 min-h-screen bg-[#f8fafc]">
        <main className="page-content-scaled max-w-6xl mx-auto px-10 py-10 flex flex-col gap-8">
          {/* Global Action Alert */}
          {actionAlert && (
            <Alert
              type={actionAlert.type}
              message={actionAlert.message}
              onClose={() => setActionAlert(null)}
            />
          )}

          {/* 2FA Setup Reminder Banner (Removable per login session) */}
          {!user?.twoFactorEnabled && !dismissed2FaBanner && (
            <div
              role="region"
              aria-label="Two-Factor Authentication Setup Notice"
              className="relative overflow-hidden bg-gradient-to-r from-indigo-50/90 via-blue-50/40 to-white border border-indigo-100/90 rounded-2xl p-4 sm:p-5 shadow-xs transition-all animate-in fade-in duration-200"
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
                      Protect your super administrator platform controls from unauthorized access. Set up an authenticator app (TOTP) to secure your account.
                    </p>
                    <div className="mt-2.5 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleOpen2FaSetup}
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
                  title="Dismiss for this session"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Tab Views */}
          {activeTab === 'dashboard' && (
            <DashboardOverviewView
              tenants={tenants}
              metrics={metrics}
              healthDetails={healthDetails}
              applications={applications}
              backups={backups}
              driftReport={driftReport}
              recentAuditLogs={auditLogs}
              analyticsData={analyticsData}
              onNavigateTab={(tab) => setActiveTab(tab)}
              onReviewApplication={(app) => setReviewApp(app)}
              onActivateTenant={(tenant) => setActivateTenant(tenant)}
            />
          )}

          {activeTab === 'applications' && (
            <TenantApplicationsView
              applications={applications}
              loading={appsLoading}
              onRefresh={loadApplications}
              onReviewApplication={(app) => setReviewApp(app)}
            />
          )}

          {activeTab === 'deleted-organisations' && <DeletedOrganisationsView />}

          {activeTab === 'tenants' && (
            selectedTenantId ? (
              <TenantDetailView
                tenantId={selectedTenantId}
                onBack={() => setSelectedTenantId(null)}
                onTenantUpdated={loadTenantsAndMetrics}
                onShowAlert={showAlert}
                onActivateTenant={(tenant) => setActivateTenant(tenant)}
              />
            ) : (
              <TenantsManagementView
                tenants={tenants}
                loading={tenantsLoading}
                onRefresh={loadTenantsAndMetrics}
                onCreateTenant={() => setShowCreateModal(true)}
                onViewDetails={(tenant) => setSelectedTenantId(tenant.id)}
                onActivateTenant={(tenant) => setActivateTenant(tenant)}
                onToggleSuspend={handleToggleSuspend}
                onManageAdmins={(tenant) => setAdminTenant(tenant)}
                onUpdateQuota={(tenant) => setQuotaTenant(tenant)}
                onDeleteTenant={handleDeleteTenant}
              />
            )
          )}

          {activeTab === 'plans' && (
            <PlansManagementView
              plans={plans}
              loading={plansLoading}
              onRefresh={loadPlans}
              onCreatePlan={() => {
                setEditingPlan(null);
                setShowPlanModal(true);
              }}
              onEditPlan={(plan) => {
                setEditingPlan(plan);
                setShowPlanModal(true);
              }}
              onToggleActive={async (plan) => {
                try {
                  await api.updatePlan(plan.id, { isActive: !plan.isActive });
                  showAlert('success', `${plan.name} ${plan.isActive ? 'deactivated' : 'activated'}.`);
                  loadPlans();
                } catch (err: any) {
                  showAlert('error', err.message || 'Failed to update plan.');
                }
              }}
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

          {activeTab === 'analytics' && (
            <AnalyticsView
              data={analyticsData}
              loading={analyticsLoading}
              onRefresh={loadAnalytics}
            />
          )}

          {activeTab === 'devices' && (
            <ActiveDevicesView />
          )}
        </main>
      </div>
      {/* ================= MODALS LAYER ================= */}
      <ApplicationReviewModal
        application={reviewApp}
        isOpen={Boolean(reviewApp)}
        onClose={() => setReviewApp(null)}
        onApprove={handleApproveApplication}
        onReject={handleRejectApplication}
        onChanged={() => {
          loadApplications();
          loadTenantsAndMetrics();
        }}
      />

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

      <TenantActivationModal
        tenant={activateTenant}
        isOpen={Boolean(activateTenant)}
        onClose={() => setActivateTenant(null)}
        onActivated={() => {
          loadTenantsAndMetrics();
        }}
      />

      <CreateTenantModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onTenantCreated={() => {
          showAlert('success', 'Tenant provisioned successfully.');
          loadTenantsAndMetrics();
        }}
      />

      <ManageAdminsModal
        isOpen={Boolean(adminTenant)}
        tenant={adminTenant}
        onClose={() => setAdminTenant(null)}
        onUpdated={() => {
          loadTenantsAndMetrics();
        }}
      />

      <PlanFormModal
        isOpen={showPlanModal}
        plan={editingPlan}
        onClose={() => setShowPlanModal(false)}
        onSaved={() => {
          showAlert('success', editingPlan ? 'Plan updated.' : 'Plan created.');
          loadPlans();
        }}
      />

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl max-w-md w-full overflow-hidden text-xs page-content-scaled">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="h-7 w-7 rounded-md bg-indigo-600 text-white flex items-center justify-center">
                  <QrCode size={15} />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-xs">
                    Two-Factor Authentication
                  </h3>
                  <p className="text-[11px] text-slate-500">Enhance operator security</p>
                </div>
              </div>
              <button
                onClick={() => setShow2FaModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {setup2FaError && (
                <Alert type="error" message={setup2FaError} />
              )}

              {setup2FaSuccess ? (
                setupBackupCodes.length > 0 ? (
                  <div className="space-y-4">
                    <div className="text-center py-2 space-y-1">
                      <CheckCircle2 size={32} className="text-emerald-600 mx-auto" />
                      <div className="font-bold text-slate-900 text-sm">2FA Successfully Enabled</div>
                      <p className="text-slate-500 text-xs">
                        Save these 10 emergency backup codes in a safe place. Each code can be used once to bypass 2FA. A copy has also been sent to your email.
                      </p>
                    </div>

                    <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-4 font-mono text-sm font-semibold tracking-widest text-slate-900 text-center select-all space-y-1.5">
                      {setupBackupCodes.map((c, i) => (
                        <div key={i}>
                          {c}
                        </div>
                      ))}
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={() => {
                          navigator.clipboard.writeText(setupBackupCodes.join('\n'));
                          setCopiedCodes(true);
                          setTimeout(() => setCopiedCodes(false), 2000);
                        }}
                        className="flex-1 flex items-center justify-center gap-1.5"
                      >
                        {copiedCodes ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                        <span>{copiedCodes ? 'Copied' : 'Copy all'}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="md"
                        onClick={handlePrintBackupCodes}
                        className="flex items-center justify-center gap-1.5 px-3.5"
                      >
                        <Printer size={14} />
                        <span>Print</span>
                      </Button>
                      <Button
                        type="button"
                        variant="primary"
                        size="md"
                        onClick={() => {
                          setShow2FaModal(false);
                          setSetupData(null);
                          setTotpCode('');
                          setSetup2FaSuccess(false);
                          setSetupBackupCodes([]);
                        }}
                        className="flex-1"
                      >
                        Done
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-6 space-y-2">
                    <CheckCircle2 size={40} className="text-emerald-600 mx-auto" />
                    <div className="font-bold text-slate-900 text-sm">2FA Successfully Enabled</div>
                    <p className="text-slate-500 text-xs">
                      Your account is now secured with TOTP verification.
                    </p>
                  </div>
                )
              ) : setup2FaLoading && !setupData ? (
                <div className="text-center py-8 text-slate-500 text-xs">
                  Generating authentication secret...
                </div>
              ) : setupData ? (
                <form onSubmit={handleConfirm2Fa} className="space-y-4">
                  <p className="text-slate-600">
                    1. Scan this QR code with your authenticator app (Google Authenticator, 1Password, etc.):
                  </p>
                  <div className="bg-white p-3 border border-slate-200 rounded-lg flex items-center justify-center">
                    <img
                      src={setupData.qrCodeDataUrl}
                      alt="2FA QR Code"
                      className="w-40 h-40 block"
                    />
                  </div>
                  <div className="bg-slate-50 p-2 rounded border border-slate-200 text-center font-mono text-[11px] text-slate-700 select-all">
                    Key: <strong>{setupData.secret}</strong>
                  </div>

                  <div>
                    <label className="field-label mb-1">
                      2. Enter the 6-digit verification code:
                    </label>
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="123456"
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                      className="form-input text-center text-base tracking-widest tabular-nums font-semibold"
                    />
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="md"
                      onClick={() => setShow2FaModal(false)}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      size="md"
                      disabled={setup2FaLoading || totpCode.length !== 6}
                      loading={setup2FaLoading}
                      className="flex-1"
                    >
                      Enable 2FA
                    </Button>
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
