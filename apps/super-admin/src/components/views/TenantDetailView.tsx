import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Building2,
  Globe,
  ArrowLeft,
  Mail,
  Users,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Calendar,
  Clock,
  HardDrive,
  Copy,
  Check,
  RefreshCw,
  PauseCircle,
  PlayCircle,
  Sliders,
  Trash2,
  KeyRound,
  Search,
  AlertTriangle,
  FileText,
  Plus,
  CheckCircle2,
  Activity,
  Key,
  AlertCircle,
} from 'lucide-react';
import { TenantFullDetails, TenantSummary } from '../../types';
import { api } from '../../api';
import { Button } from '../ui/Button';
import { Alert } from '../ui/Alert';
import { StatusBadge } from '../ui/StatusBadge';
import { OrganisationDeletionPanel } from '../OrganisationDeletionPanel';
import { dnsStatusBadgeProps } from '../../utils/dnsStatus';

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export type TenantDetailSubTab = 'domains' | 'mailboxes' | 'admins' | 'audit' | 'governance';

export interface TenantDetailViewProps {
  tenantId: string;
  onBack: () => void;
  onTenantUpdated?: () => void;
  onShowAlert?: (type: 'success' | 'error', message: string) => void;
  onActivateTenant?: (tenant: TenantSummary) => void;
  activeSubTab?: TenantDetailSubTab;
  onSubTabChange?: (tab: TenantDetailSubTab) => void;
}

export const TenantDetailView: React.FC<TenantDetailViewProps> = ({
  tenantId,
  onBack,
  onTenantUpdated,
  onShowAlert,
  onActivateTenant,
  activeSubTab: controlledActiveSubTab,
  onSubTabChange,
}) => {
  const [details, setDetails] = useState<TenantFullDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSubTab, setActiveSubTab] = useState<TenantDetailSubTab>(controlledActiveSubTab || 'domains');

  useEffect(() => {
    if (controlledActiveSubTab && controlledActiveSubTab !== activeSubTab) {
      setActiveSubTab(controlledActiveSubTab);
    }
  }, [controlledActiveSubTab]);

  const handleSubTabChange = (tab: TenantDetailSubTab) => {
    setActiveSubTab(tab);
    onSubTabChange?.(tab);
  };
  const [copiedId, setCopiedId] = useState(false);

  // Search & Filter
  const [mailboxSearch, setMailboxSearch] = useState('');
  const [domainSearch, setDomainSearch] = useState('');
  const [auditSearch, setAuditSearch] = useState('');

  // Modal triggers

  // Admin password reset
  const [resettingAdminId, setResettingAdminId] = useState<string | null>(null);
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [adminActionLoading, setAdminActionLoading] = useState(false);
  const [adminSuccessMsg, setAdminSuccessMsg] = useState<string | null>(null);
  const [adminErrorMsg, setAdminErrorMsg] = useState<string | null>(null);

  // Add new admin inline modal
  const [showAddAdmin, setShowAddAdmin] = useState(false);
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPass, setNewAdminPass] = useState('');

  // Quota editor
  const [newQuotaValue, setNewQuotaValue] = useState<number>(0);
  const [quotaSaving, setQuotaSaving] = useState(false);

  // Danger zone deletion
  const [confirmDeleteName, setConfirmDeleteName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  // Lifecycle action loading
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  // Domain actions
  const [checkingDnsDomainId, setCheckingDnsDomainId] = useState<string | null>(null);
  const [dnsCheckResult, setDnsCheckResult] = useState<{ domain: string; allConfigured: boolean; records: any[] } | null>(null);
  const [deletingDomainId, setDeletingDomainId] = useState<string | null>(null);

  // Mailbox actions
  const [resettingMailboxId, setResettingMailboxId] = useState<string | null>(null);
  const [newMailboxPassword, setNewMailboxPassword] = useState('');
  const [mailboxActionLoading, setMailboxActionLoading] = useState(false);

  const fetchTenantDetails = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getTenantDetails(tenantId);
      setDetails(data);
      setNewQuotaValue(data.tenant.mailboxLimit);
    } catch (err: any) {
      console.error('[TenantDetailView] Failed to load tenant details:', err);
      setError(err.message || 'Failed to retrieve tenant details');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchTenantDetails();
  }, [fetchTenantDetails]);

  const handleCopyId = () => {
    if (!details?.tenant?.id) return;
    navigator.clipboard.writeText(details.tenant.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const tenantSummaryAdapter = useMemo<TenantSummary | null>(() => {
    if (!details) return null;
    return {
      id: details.tenant.id,
      name: details.tenant.name,
      status: details.tenant.status,
      mailboxLimit: details.tenant.mailboxLimit,
      mailboxCount: details.tenant.mailboxCount,
      createdAt: details.tenant.createdAt,
      updatedAt: details.tenant.updatedAt,
      domain: (details.domains[0] as any) || null,
      domains: details.domains as any,
      adminCount: details.admins.length,
    };
  }, [details]);

  // Lifecycle actions
  const handleToggleSuspend = async () => {
    if (!details) return;
    setLifecycleLoading(true);
    try {
      if (details.tenant.status === 'active') {
        await api.suspendTenant(details.tenant.id);
        onShowAlert?.('success', `Tenant "${details.tenant.name}" has been suspended.`);
      } else {
        await api.reactivateTenant(details.tenant.id);
        onShowAlert?.('success', `Tenant "${details.tenant.name}" has been reactivated.`);
      }
      await fetchTenantDetails();
      onTenantUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to update tenant status');
    } finally {
      setLifecycleLoading(false);
    }
  };

  const handleSaveQuota = async () => {
    if (!details) return;
    if (newQuotaValue < 1) {
      setError('Mailbox quota must be at least 1.');
      return;
    }
    setQuotaSaving(true);
    try {
      await api.updateMailboxLimit(details.tenant.id, newQuotaValue);
      onShowAlert?.('success', `Mailbox quota updated to ${newQuotaValue}.`);
      await fetchTenantDetails();
      onTenantUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to update quota limit');
    } finally {
      setQuotaSaving(false);
    }
  };

  const handleResetAdminPassword = async (adminId: string) => {
    if (!details) return;
    if (!newAdminPassword || newAdminPassword.length < 8) {
      setAdminErrorMsg('Password must be at least 8 characters long.');
      return;
    }
    setAdminActionLoading(true);
    setAdminErrorMsg(null);
    try {
      await api.resetTenantAdminPassword(details.tenant.id, adminId, newAdminPassword);
      setAdminSuccessMsg('Administrator password reset successfully.');
      setResettingAdminId(null);
      setNewAdminPassword('');
      setTimeout(() => setAdminSuccessMsg(null), 3500);
      await fetchTenantDetails();
    } catch (err: any) {
      setAdminErrorMsg(err.message || 'Failed to reset administrator password');
    } finally {
      setAdminActionLoading(false);
    }
  };

  const handleCreateAdmin = async () => {
    if (!details) return;
    if (!newAdminEmail || !newAdminPass) {
      setAdminErrorMsg('Please provide both email and initial password.');
      return;
    }
    if (newAdminPass.length < 8) {
      setAdminErrorMsg('Password must be at least 8 characters long.');
      return;
    }
    setAdminActionLoading(true);
    setAdminErrorMsg(null);
    try {
      await api.createTenantAdmin(details.tenant.id, {
        email: newAdminEmail.trim().toLowerCase(),
        password: newAdminPass,
      });
      setAdminSuccessMsg(`Administrator ${newAdminEmail} created.`);
      setShowAddAdmin(false);
      setNewAdminEmail('');
      setNewAdminPass('');
      setTimeout(() => setAdminSuccessMsg(null), 3500);
      await fetchTenantDetails();
      onTenantUpdated?.();
    } catch (err: any) {
      setAdminErrorMsg(err.message || 'Failed to add administrator');
    } finally {
      setAdminActionLoading(false);
    }
  };

  const handleDeleteTenant = async () => {
    if (!details) return;
    if (confirmDeleteName !== details.tenant.name) {
      setError(`Confirmation mismatch. Please type "${details.tenant.name}" exactly.`);
      return;
    }
    setIsDeleting(true);
    try {
      await api.deleteTenant(details.tenant.id);
      onShowAlert?.('success', `Tenant "${details.tenant.name}" and all associated data deleted.`);
      onTenantUpdated?.();
      onBack();
    } catch (err: any) {
      setError(err.message || 'Failed to delete tenant');
      setIsDeleting(false);
    }
  };

  const handleCheckDomainDns = async (domainId: string, domainName: string) => {
    setCheckingDnsDomainId(domainId);
    try {
      const res = await api.checkDomainDns(tenantId, domainId);
      setDnsCheckResult(res);
      if (res.allConfigured) {
        onShowAlert?.('success', `DNS verification passed for ${domainName}! All required records are live.`);
      } else {
        onShowAlert?.('error', `DNS check incomplete for ${domainName}. Some records are missing or not propagated yet.`);
      }
      await fetchTenantDetails();
    } catch (err: any) {
      onShowAlert?.('error', err.message || 'Failed to check DNS records.');
    } finally {
      setCheckingDnsDomainId(null);
    }
  };

  const handleDeleteDomain = async (domainId: string, domainName: string) => {
    const hasMailboxes = mailboxes.some((m) => m.domainId === domainId || m.domainName?.toLowerCase() === domainName.toLowerCase());
    if (hasMailboxes) {
      onShowAlert?.('error', `Cannot delete domain "${domainName}": mailboxes still exist on this domain. Remove all mailboxes first.`);
      return;
    }
    if (!confirm(`Are you sure you want to permanently delete domain "${domainName}"? This action cannot be undone.`)) {
      return;
    }
    setDeletingDomainId(domainId);
    try {
      await api.deleteDomain(tenantId, domainId);
      onShowAlert?.('success', `Domain "${domainName}" deleted successfully.`);
      await fetchTenantDetails();
      onTenantUpdated?.();
    } catch (err: any) {
      onShowAlert?.('error', err.message || 'Failed to delete domain.');
    } finally {
      setDeletingDomainId(null);
    }
  };

  const handleResetMailboxPassword = async (mailboxId: string) => {
    if (!newMailboxPassword || newMailboxPassword.length < 8) {
      onShowAlert?.('error', 'New password must be at least 8 characters long.');
      return;
    }
    setMailboxActionLoading(true);
    try {
      await api.resetMailboxPassword(mailboxId, newMailboxPassword);
      onShowAlert?.('success', 'Mailbox password reset successfully.');
      setResettingMailboxId(null);
      setNewMailboxPassword('');
    } catch (err: any) {
      onShowAlert?.('error', err.message || 'Failed to reset mailbox password.');
    } finally {
      setMailboxActionLoading(false);
    }
  };

  const handleToggleSuspendMailbox = async (mailboxId: string, isCurrentlyActive: boolean) => {
    try {
      if (isCurrentlyActive) {
        await api.suspendMailbox(mailboxId);
        onShowAlert?.('success', 'Mailbox suspended.');
      } else {
        await api.reactivateMailbox(mailboxId);
        onShowAlert?.('success', 'Mailbox reactivated.');
      }
      await fetchTenantDetails();
    } catch (err: any) {
      onShowAlert?.('error', err.message || 'Failed to update mailbox status.');
    }
  };

  const handleDeleteMailbox = async (mailboxId: string, address: string) => {
    if (!confirm(`Are you sure you want to permanently delete mailbox "${address}"? All messages and attachments will be deleted.`)) {
      return;
    }
    try {
      await api.deleteMailbox(mailboxId);
      onShowAlert?.('success', `Mailbox "${address}" deleted successfully.`);
      await fetchTenantDetails();
      onTenantUpdated?.();
    } catch (err: any) {
      onShowAlert?.('error', err.message || 'Failed to delete mailbox.');
    }
  };

  // Filtered lists
  const filteredMailboxes = useMemo(() => {
    if (!details?.mailboxes) return [];
    if (!mailboxSearch.trim()) return details.mailboxes;
    const q = mailboxSearch.toLowerCase().trim();
    return details.mailboxes.filter(
      (m) =>
        m.address.toLowerCase().includes(q) ||
        m.domainName.toLowerCase().includes(q) ||
        m.localPart.toLowerCase().includes(q)
    );
  }, [details?.mailboxes, mailboxSearch]);

  const filteredDomains = useMemo(() => {
    if (!details?.domains) return [];
    if (!domainSearch.trim()) return details.domains;
    const q = domainSearch.toLowerCase().trim();
    return details.domains.filter((d) => d.domainName.toLowerCase().includes(q));
  }, [details?.domains, domainSearch]);

  const filteredAuditLogs = useMemo(() => {
    if (!details?.auditLogs) return [];
    if (!auditSearch.trim()) return details.auditLogs;
    const q = auditSearch.toLowerCase().trim();
    return details.auditLogs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.actorEmail?.toLowerCase().includes(q) ||
        l.resource.toLowerCase().includes(q)
    );
  }, [details?.auditLogs, auditSearch]);

  if (loading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-12 text-center flex flex-col items-center justify-center gap-3">
        <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
        <div className="text-sm font-semibold text-slate-800">Loading tenant details...</div>
        <p className="text-xs text-slate-500">Retrieving domains, mailboxes, administrators, and telemetry</p>
      </div>
    );
  }

  if (error && !details) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 space-y-4">
        <Alert type="error" message={error} />
        <Button variant="secondary" onClick={onBack} icon={<ArrowLeft className="w-4 h-4" />}>
          Return to Tenant Directory
        </Button>
      </div>
    );
  }

  if (!details) return null;

  const { tenant, domains = [], admins = [], mailboxes = [], auditLogs = [], stats = { totalDomains: 0, activeDomains: 0, totalMailboxes: 0, activeMailboxes: 0, suspendedMailboxes: 0, totalStorageBytes: 0, mailboxLimit: 0, usagePercent: 0 } } = details;
  const usagePercent = stats?.usagePercent || 0;
  const isSuspended = tenant.status === 'suspended';
  const isPending = tenant.status === 'approved_pending_setup';
  const isActive = tenant.status === 'active';

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Return Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors shadow-xs"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Tenants</span>
          </button>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>/</span>
            <span className="font-medium text-slate-700">{tenant.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={fetchTenantDetails}
            icon={<RefreshCw className="w-3.5 h-3.5" />}
            title="Refresh tenant data"
          >
            Refresh
          </Button>

          {isPending && onActivateTenant && tenantSummaryAdapter && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => onActivateTenant(tenantSummaryAdapter)}
              icon={<PlayCircle className="w-4 h-4" />}
            >
              Activate Tenant
            </Button>
          )}

          {isActive && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleToggleSuspend}
              disabled={lifecycleLoading}
              className="text-amber-600 hover:text-amber-700 hover:bg-amber-50"
              icon={<PauseCircle className="w-4 h-4" />}
            >
              Suspend Tenant
            </Button>
          )}

          {isSuspended && (
            <Button
              size="sm"
              variant="secondary"
              onClick={handleToggleSuspend}
              disabled={lifecycleLoading}
              className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
              icon={<PlayCircle className="w-4 h-4" />}
            >
              Reactivate Tenant
            </Button>
          )}
        </div>
      </div>

      {error && <Alert type="error" message={error} onClose={() => setError(null)} />}

      {/* Main Tenant Identity Header Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-6 border-b border-slate-100">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0 shadow-xs">
              <Building2 className="w-7 h-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-xl font-bold text-slate-900 tracking-tight">{tenant.name}</h1>
                {isActive && <StatusBadge status="success">Active</StatusBadge>}
                {isPending && <StatusBadge status="warning">Pending Setup</StatusBadge>}
                {isSuspended && <StatusBadge status="danger">Suspended</StatusBadge>}
              </div>

              <div className="flex flex-wrap items-center gap-4 mt-2 text-xs text-slate-500">
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-400">ID:</span>
                  <span className="font-mono font-medium text-slate-700">{tenant.id}</span>
                  <button
                    type="button"
                    onClick={handleCopyId}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                    title="Copy full tenant ID"
                  >
                    {copiedId ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                <div className="flex items-center gap-1.5 text-slate-500">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>Created {new Date(tenant.createdAt).toLocaleDateString()}</span>
                </div>

                <div className="flex items-center gap-1.5 text-slate-500">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Updated {new Date(tenant.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleSubTabChange('governance')}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-1.5"
            >
              <Sliders className="w-3.5 h-3.5 text-slate-500" />
              <span>Adjust Quota</span>
            </button>
          </div>
        </div>

        {/* High-level KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
          {/* Domains Card */}
          <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Configured Domains</span>
              <Globe className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight mt-1">
              {stats.totalDomains}
            </div>
            <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              <span>{stats.activeDomains} active with DNS verified</span>
            </div>
          </div>

          {/* Mailbox Quota Allocation */}
          <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Mailbox Allocation</span>
              <Mail className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="flex items-baseline justify-between mt-1">
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {mailboxes.length} <span className="text-sm font-normal text-slate-400">/ {tenant.mailboxLimit}</span>
              </div>
              <span className="text-xs font-semibold text-slate-600">{usagePercent}%</span>
            </div>
            <div className="mt-2">
              <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${
                    usagePercent > 90 ? 'bg-rose-500' : usagePercent > 75 ? 'bg-amber-500' : 'bg-indigo-600'
                  }`}
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                />
              </div>
              <div className="text-[10px] text-slate-400 mt-1">
                {Math.max(0, tenant.mailboxLimit - mailboxes.length)} seats available
              </div>
            </div>
          </div>

          {/* Administrators Card */}
          <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Administrators</span>
              <Users className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight mt-1">
              {admins.length}
            </div>
            <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              <span>{admins.filter((a) => a.twoFactorEnabled).length} with 2FA enabled</span>
            </div>
          </div>

          {/* Storage & Mailbox Status */}
          <div className="p-4 rounded-xl bg-slate-50/80 border border-slate-200/80 flex flex-col justify-between">
            <div className="flex items-center justify-between text-slate-500 mb-1">
              <span className="text-xs font-medium">Storage Consumed</span>
              <HardDrive className="w-4 h-4 text-indigo-500" />
            </div>
            <div className="text-2xl font-bold text-slate-900 tracking-tight mt-1">
              {formatBytes(stats.totalStorageBytes)}
            </div>
            <div className="text-[11px] text-slate-500 mt-2 flex items-center gap-2">
              <span className="text-emerald-700 font-medium">{stats.activeMailboxes} active</span>
              {stats.suspendedMailboxes > 0 && (
                <span className="text-rose-600 font-medium">&bull; {stats.suspendedMailboxes} suspended</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Sub-Tab Navigation Bar */}
      <div className="flex border-b border-slate-200 bg-white px-4 rounded-t-xl overflow-x-auto">
        <button
          type="button"
          onClick={() => handleSubTabChange('domains')}
          className={`py-3.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${
            activeSubTab === 'domains'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Globe className="w-4 h-4" />
          <span>Configured Domains</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold">
            {domains.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSubTabChange('mailboxes')}
          className={`py-3.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${
            activeSubTab === 'mailboxes'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Mail className="w-4 h-4" />
          <span>Mailboxes</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold">
            {mailboxes.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSubTabChange('admins')}
          className={`py-3.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${
            activeSubTab === 'admins'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Administrators</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold">
            {admins.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSubTabChange('audit')}
          className={`py-3.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${
            activeSubTab === 'audit'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Audit Trail</span>
          <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-100 text-slate-600 font-bold">
            {auditLogs.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSubTabChange('governance')}
          className={`py-3.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-2 shrink-0 ${
            activeSubTab === 'governance'
              ? 'border-indigo-600 text-indigo-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <ShieldAlert className="w-4 h-4" />
          <span>Governance & Danger Zone</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* SUB-TAB 1: CONFIGURED DOMAINS                                             */}
      {/* ========================================================================= */}
      {activeSubTab === 'domains' && (
        <section className="bg-white border border-slate-200 rounded-b-xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Configured Domains & DNS Status</h3>
              <p className="text-xs text-slate-500">
                Domains bound to Stalwart mail engine and automated GoDaddy DNS records
              </p>
            </div>
            <div className="w-full sm:w-64 relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={domainSearch}
                onChange={(e) => setDomainSearch(e.target.value)}
                placeholder="Search domains..."
                className="form-input pl-8 h-8 text-xs w-full"
              />
            </div>
          </div>

          {/* DNS Diagnostic Result Banner */}
          {dnsCheckResult && (
            <div className="p-4 rounded-xl border border-indigo-200 bg-indigo-50/50 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className={`w-5 h-5 ${dnsCheckResult.allConfigured ? 'text-emerald-600' : 'text-amber-500'}`} />
                  <span className="text-sm font-semibold text-slate-900">
                    DNS Live Check: <span className="font-mono text-indigo-700">{dnsCheckResult.domain}</span>
                  </span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${dnsCheckResult.allConfigured ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                    {dnsCheckResult.allConfigured ? 'All Records Configured' : 'Missing / Incomplete Records'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setDnsCheckResult(null)}
                  className="text-xs text-slate-400 hover:text-slate-600 font-medium"
                >
                  Dismiss
                </button>
              </div>

              {dnsCheckResult.records && dnsCheckResult.records.length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold">
                      <tr>
                        <th className="px-3 py-2">Record Type</th>
                        <th className="px-3 py-2">Host / Name</th>
                        <th className="px-3 py-2">Expected Value</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {dnsCheckResult.records.map((r: any, idx: number) => {
                        const isValid = r.status === 'valid' || r.configured === true || r.valid === true;
                        return (
                          <tr key={idx} className="hover:bg-slate-50/50">
                            <td className="px-3 py-2 font-mono font-bold text-slate-800">{r.type || r.recordType}</td>
                            <td className="px-3 py-2 font-mono text-slate-600">{r.host || r.name || '@'}</td>
                            <td className="px-3 py-2 font-mono text-slate-600 max-w-xs truncate" title={r.expectedValue || r.value}>
                              {r.expectedValue || r.value || '-'}
                            </td>
                            <td className="px-3 py-2">
                              {isValid ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700">
                                  <CheckCircle2 className="w-3.5 h-3.5" /> Valid
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-600">
                                  <AlertCircle className="w-3.5 h-3.5" /> Pending
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {filteredDomains.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
              No domains match your search query.
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-lg">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Domain Name</th>
                      <th>Type</th>
                      <th>DNS Status</th>
                      <th>Mailbox Quota</th>
                      <th>Stalwart ID</th>
                      <th>Added</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDomains.map((dom) => {
                      const badge = dnsStatusBadgeProps(dom.dnsStatus);
                      const hasMailboxes = mailboxes.some(
                        (m) => m.domainId === dom.id || m.domainName?.toLowerCase() === dom.domainName.toLowerCase()
                      );
                      return (
                        <tr key={dom.id}>
                          <td>
                            <div className="flex items-center gap-2 font-semibold text-slate-900 text-xs">
                              <Globe className="w-4 h-4 text-indigo-600 shrink-0" />
                              <span>{dom.domainName}</span>
                            </div>
                          </td>
                          <td>
                            {dom.isPrimary ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                                Primary
                              </span>
                            ) : (
                              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                                Secondary
                              </span>
                            )}
                          </td>
                          <td>
                            <StatusBadge status={badge.status} label={badge.label} />
                          </td>
                          <td>
                            <span className="text-xs text-slate-700 font-medium">
                              {dom.mailboxLimit ? `${dom.mailboxLimit} seats` : 'Tenant Shared'}
                            </span>
                          </td>
                          <td>
                            <span className="text-[11px] font-mono text-slate-500">
                              {dom.stalwartDomainId || 'Auto-generated'}
                            </span>
                          </td>
                          <td>
                            <span className="text-xs text-slate-500">
                              {new Date(dom.createdAt).toLocaleDateString()}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => handleCheckDomainDns(dom.id, dom.domainName)}
                                loading={checkingDnsDomainId === dom.id}
                                icon={<Activity className="w-3.5 h-3.5 text-indigo-600" />}
                                title="Check DNS propagation status"
                              >
                                Check DNS
                              </Button>
                              <Button
                                size="xs"
                                variant="secondary"
                                onClick={() => handleDeleteDomain(dom.id, dom.domainName)}
                                loading={deletingDomainId === dom.id}
                                disabled={hasMailboxes}
                                className="text-rose-600 hover:bg-rose-50 border-rose-200"
                                icon={<Trash2 className="w-3.5 h-3.5" />}
                                title={hasMailboxes ? 'Cannot delete domain with active mailboxes' : 'Delete Domain'}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Stacked Cards View */}
              <div className="md:hidden space-y-3">
                {filteredDomains.map((dom) => {
                  const badge = dnsStatusBadgeProps(dom.dnsStatus);
                  const hasMailboxes = mailboxes.some(
                    (m) => m.domainId === dom.id || m.domainName?.toLowerCase() === dom.domainName.toLowerCase()
                  );
                  return (
                    <div
                      key={dom.id}
                      className="p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 shadow-xs transition-all space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 border border-indigo-100 mt-0.5">
                            <Globe size={16} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 text-sm tracking-tight truncate">
                              {dom.domainName}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono truncate">
                              {dom.stalwartDomainId || 'Auto-generated'}
                            </div>
                          </div>
                        </div>
                        {dom.isPrimary ? (
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200/60">
                            Primary
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                            Secondary
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                        <div className="bg-slate-50 rounded-lg p-2.5">
                          <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">DNS Status</div>
                          <div className="mt-1">
                            <StatusBadge status={badge.status} label={badge.label} />
                          </div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2.5">
                          <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Quota</div>
                          <div className="font-medium text-slate-800 mt-1">
                            {dom.mailboxLimit ? `${dom.mailboxLimit} seats` : 'Tenant Shared'}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                        <div className="text-[11px] text-slate-400">
                          Added {new Date(dom.createdAt).toLocaleDateString()}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => handleCheckDomainDns(dom.id, dom.domainName)}
                            loading={checkingDnsDomainId === dom.id}
                            icon={<Activity className="w-3.5 h-3.5 text-indigo-600" />}
                          >
                            Check DNS
                          </Button>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => handleDeleteDomain(dom.id, dom.domainName)}
                            loading={deletingDomainId === dom.id}
                            disabled={hasMailboxes}
                            className="text-rose-600 hover:bg-rose-50 border-rose-200"
                            icon={<Trash2 className="w-3.5 h-3.5" />}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 2: MAILBOXES                                                      */}
      {/* ========================================================================= */}
      {activeSubTab === 'mailboxes' && (
        <section className="bg-white border border-slate-200 rounded-b-xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Provisioned Mailboxes</h3>
              <p className="text-xs text-slate-500">
                All email accounts created and active under this organization
              </p>
            </div>
            <div className="w-full sm:w-64 relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={mailboxSearch}
                onChange={(e) => setMailboxSearch(e.target.value)}
                placeholder="Search mailboxes or address..."
                className="form-input pl-8 h-8 text-xs w-full"
              />
            </div>
          </div>

          {filteredMailboxes.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
              {mailboxes.length === 0
                ? 'No mailboxes have been created for this tenant yet.'
                : 'No mailboxes match your search filter.'}
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-lg">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Email Address</th>
                      <th>Domain</th>
                      <th>Status</th>
                      <th>Storage Used</th>
                      <th>Created</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMailboxes.map((mb) => {
                      const isMbActive = mb.status === 'active';
                      const isResetting = resettingMailboxId === mb.id;
                      return (
                        <React.Fragment key={mb.id}>
                          <tr>
                            <td>
                              <div className="flex items-center gap-2 font-medium text-slate-900 text-xs">
                                <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span>{mb.address}</span>
                              </div>
                            </td>
                            <td>
                              <span className="text-xs text-slate-600">{mb.domainName}</span>
                            </td>
                            <td>
                              {isMbActive ? (
                                <StatusBadge status="success">Active</StatusBadge>
                              ) : (
                                <StatusBadge status="danger">{mb.status}</StatusBadge>
                              )}
                            </td>
                            <td>
                              <span className="text-xs font-mono text-slate-700">
                                {formatBytes(mb.storageBytes)}
                              </span>
                            </td>
                            <td>
                              <span className="text-xs text-slate-500">
                                {new Date(mb.createdAt).toLocaleDateString()}
                              </span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  onClick={() => {
                                    setResettingMailboxId(isResetting ? null : mb.id);
                                    setNewMailboxPassword('');
                                  }}
                                  icon={<Key className="w-3.5 h-3.5 text-slate-600" />}
                                  title="Reset password"
                                >
                                  {isResetting ? 'Cancel' : 'Reset Pass'}
                                </Button>
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  onClick={() => handleToggleSuspendMailbox(mb.id, isMbActive)}
                                  className={isMbActive ? 'text-amber-700 hover:bg-amber-50 border-amber-200' : 'text-emerald-700 hover:bg-emerald-50 border-emerald-200'}
                                  icon={isMbActive ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                                  title={isMbActive ? 'Suspend mailbox' : 'Reactivate mailbox'}
                                >
                                  {isMbActive ? 'Suspend' : 'Activate'}
                                </Button>
                                <Button
                                  size="xs"
                                  variant="secondary"
                                  onClick={() => handleDeleteMailbox(mb.id, mb.address)}
                                  className="text-rose-600 hover:bg-rose-50 border-rose-200"
                                  icon={<Trash2 className="w-3.5 h-3.5" />}
                                  title="Delete mailbox"
                                />
                              </div>
                            </td>
                          </tr>

                          {/* Inline Reset Password Panel */}
                          {isResetting && (
                            <tr className="bg-indigo-50/40 border-y border-indigo-100">
                              <td colSpan={6} className="px-4 py-3">
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-semibold text-slate-700">
                                    Set new password for <span className="font-mono text-indigo-700">{mb.address}</span>:
                                  </span>
                                  <input
                                    type="password"
                                    value={newMailboxPassword}
                                    onChange={(e) => setNewMailboxPassword(e.target.value)}
                                    placeholder="Min. 8 characters"
                                    className="form-input h-7 text-xs w-48"
                                  />
                                  <Button
                                    size="xs"
                                    variant="primary"
                                    onClick={() => handleResetMailboxPassword(mb.id)}
                                    loading={mailboxActionLoading}
                                  >
                                    Save New Password
                                  </Button>
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    onClick={() => {
                                      setResettingMailboxId(null);
                                      setNewMailboxPassword('');
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Stacked Cards View */}
              <div className="md:hidden space-y-3">
                {filteredMailboxes.map((mb) => {
                  const isMbActive = mb.status === 'active';
                  const isResetting = resettingMailboxId === mb.id;
                  return (
                    <div
                      key={mb.id}
                      className="p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 shadow-xs transition-all space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2.5">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0 border border-blue-100 mt-0.5">
                            <Mail size={16} />
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-slate-900 text-sm tracking-tight truncate">
                              {mb.address}
                            </div>
                            <div className="text-xs text-slate-500 truncate">{mb.domainName}</div>
                          </div>
                        </div>
                        {isMbActive ? (
                          <StatusBadge status="success">Active</StatusBadge>
                        ) : (
                          <StatusBadge status="danger">{mb.status}</StatusBadge>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                        <div className="bg-slate-50 rounded-lg p-2.5">
                          <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Storage</div>
                          <div className="font-semibold text-slate-800 font-mono mt-0.5">
                            {formatBytes(mb.storageBytes)}
                          </div>
                        </div>
                        <div className="bg-slate-50 rounded-lg p-2.5">
                          <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Created</div>
                          <div className="font-medium text-slate-800 mt-0.5">
                            {new Date(mb.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>

                      {/* Mobile Actions */}
                      <div className="flex flex-wrap items-center justify-end gap-1.5 pt-2 border-t border-slate-100">
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => {
                            setResettingMailboxId(isResetting ? null : mb.id);
                            setNewMailboxPassword('');
                          }}
                          icon={<Key className="w-3.5 h-3.5 text-slate-600" />}
                        >
                          {isResetting ? 'Cancel' : 'Reset Pass'}
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => handleToggleSuspendMailbox(mb.id, isMbActive)}
                          className={isMbActive ? 'text-amber-700 hover:bg-amber-50 border-amber-200' : 'text-emerald-700 hover:bg-emerald-50 border-emerald-200'}
                        >
                          {isMbActive ? 'Suspend' : 'Activate'}
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => handleDeleteMailbox(mb.id, mb.address)}
                          className="text-rose-600 hover:bg-rose-50 border-rose-200"
                          icon={<Trash2 className="w-3.5 h-3.5" />}
                        />
                      </div>

                      {/* Mobile Inline Reset Form */}
                      {isResetting && (
                        <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-100 space-y-2 mt-2">
                          <div className="text-xs font-semibold text-slate-700">Set new password:</div>
                          <div className="flex gap-2">
                            <input
                              type="password"
                              value={newMailboxPassword}
                              onChange={(e) => setNewMailboxPassword(e.target.value)}
                              placeholder="Min. 8 characters"
                              className="form-input h-7 text-xs flex-1"
                            />
                            <Button
                              size="xs"
                              variant="primary"
                              onClick={() => handleResetMailboxPassword(mb.id)}
                              loading={mailboxActionLoading}
                            >
                              Save
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 3: ADMINISTRATORS                                                 */}
      {/* ========================================================================= */}
      {activeSubTab === 'admins' && (
        <section className="bg-white border border-slate-200 rounded-b-xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Tenant Administrators</h3>
              <p className="text-xs text-slate-500">
                Organization admins with permissions to manage mailboxes and domains in Tenant Admin Portal
              </p>
            </div>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setShowAddAdmin(!showAddAdmin)}
              icon={<Plus className="w-3.5 h-3.5" />}
            >
              Add Administrator
            </Button>
          </div>

          {adminSuccessMsg && <Alert type="success" message={adminSuccessMsg} onClose={() => setAdminSuccessMsg(null)} />}
          {adminErrorMsg && <Alert type="error" message={adminErrorMsg} onClose={() => setAdminErrorMsg(null)} />}

          {/* Inline Add Admin Form */}
          {showAddAdmin && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
              <h4 className="text-xs font-semibold text-slate-900">Add New Administrator</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label mb-1">Admin Email Address</label>
                  <input
                    type="email"
                    value={newAdminEmail}
                    onChange={(e) => setNewAdminEmail(e.target.value)}
                    placeholder="admin@tenant.com"
                    className="form-input h-8 text-xs w-full"
                  />
                </div>
                <div>
                  <label className="field-label mb-1">Temporary Initial Password</label>
                  <input
                    type="password"
                    value={newAdminPass}
                    onChange={(e) => setNewAdminPass(e.target.value)}
                    placeholder="Min. 8 characters"
                    className="form-input h-8 text-xs w-full"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleCreateAdmin}
                  disabled={adminActionLoading}
                >
                  Create Admin
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setShowAddAdmin(false);
                    setNewAdminEmail('');
                    setNewAdminPass('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Inline Reset Password Form */}
          {resettingAdminId && (
            <div className="p-4 bg-indigo-50/50 border border-indigo-200/80 rounded-lg space-y-3">
              <h4 className="text-xs font-semibold text-indigo-900">
                Reset Administrator Password ({admins.find((a) => a.id === resettingAdminId)?.email})
              </h4>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <input
                  type="password"
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  placeholder="Enter new password (min. 8 chars)"
                  className="form-input h-8 text-xs flex-1 w-full"
                />
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => handleResetAdminPassword(resettingAdminId)}
                    disabled={adminActionLoading}
                  >
                    Save Password
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setResettingAdminId(null);
                      setNewAdminPassword('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}

          {admins.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
              No administrators assigned to this tenant yet.
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-lg">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Administrator</th>
                      <th>Role</th>
                      <th>2FA Security</th>
                      <th>Created</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {admins.map((admin) => (
                      <tr key={admin.id}>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-semibold text-xs border border-slate-200">
                              {admin.email.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 text-xs">{admin.email}</div>
                              <div className="text-[10px] text-slate-400">ID: {admin.id.slice(-8)}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                            {admin.role}
                          </span>
                        </td>
                        <td>
                          {admin.twoFactorEnabled ? (
                            <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                              <ShieldCheck className="w-4 h-4 text-emerald-600" />
                              <span>2FA Protected</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs text-slate-400">
                              <Shield className="w-4 h-4 text-slate-400" />
                              <span>Not configured</span>
                            </div>
                          )}
                        </td>
                        <td>
                          <span className="text-xs text-slate-500">
                            {new Date(admin.createdAt).toLocaleDateString()}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>
                          {admin.role === 'TENANT_MODERATOR' ? (
                            <span className="text-[11px] text-slate-400 italic">Managed by Tenant Admin</span>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setResettingAdminId(resettingAdminId === admin.id ? null : admin.id);
                                setNewAdminPassword('');
                              }}
                              icon={<KeyRound className="w-3.5 h-3.5 text-slate-600" />}
                            >
                              Reset Password
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Stacked Cards View */}
              <div className="md:hidden space-y-3">
                {admins.map((admin) => (
                  <div
                    key={admin.id}
                    className="p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 shadow-xs transition-all space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2.5">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs border border-slate-200 shrink-0 mt-0.5">
                          {admin.email.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 text-sm truncate">{admin.email}</div>
                          <div className="text-[10px] text-slate-400">ID: {admin.id.slice(-8)}</div>
                        </div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                        {admin.role}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Security</div>
                        <div className="mt-1">
                          {admin.twoFactorEnabled ? (
                            <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                              <ShieldCheck className="w-4 h-4 text-emerald-600" />
                              <span>2FA Enabled</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-xs text-slate-400">
                              <Shield className="w-4 h-4 text-slate-400" />
                              <span>No 2FA</span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Created</div>
                        <div className="text-slate-800 font-medium mt-1">
                          {new Date(admin.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>

                    <div className="pt-1">
                      {admin.role === 'TENANT_MODERATOR' ? (
                        <span className="text-[11px] text-slate-400 italic">Managed by Tenant Admin</span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setResettingAdminId(resettingAdminId === admin.id ? null : admin.id);
                            setNewAdminPassword('');
                          }}
                          icon={<KeyRound className="w-3.5 h-3.5 text-slate-600" />}
                          className="w-full min-h-[44px] justify-center"
                        >
                          Reset Password
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 4: AUDIT TRAIL                                                    */}
      {/* ========================================================================= */}
      {activeSubTab === 'audit' && (
        <section className="bg-white border border-slate-200 rounded-b-xl p-6 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Tenant Audit History</h3>
              <p className="text-xs text-slate-500">
                Security-sensitive events and administrative operations filtered for this organization
              </p>
            </div>
            <div className="w-full sm:w-64 relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                placeholder="Search audit trail..."
                className="form-input pl-8 h-8 text-xs w-full"
              />
            </div>
          </div>

          {filteredAuditLogs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
              {auditLogs.length === 0
                ? 'No audit log entries found for this tenant.'
                : 'No audit records match your search filter.'}
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-lg">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Resource</th>
                      <th>IP Address</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAuditLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="whitespace-nowrap">
                          <span className="text-xs font-mono text-slate-600">
                            {new Date(log.timestamp).toLocaleString()}
                          </span>
                        </td>
                        <td>
                          <div className="text-xs font-medium text-slate-900">{log.actorEmail}</div>
                          <div className="text-[10px] text-slate-400">{log.actorRole}</div>
                        </td>
                        <td>
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-slate-100 text-slate-800">
                            {log.action}
                          </span>
                        </td>
                        <td>
                          <span className="text-xs text-slate-700">
                            {log.resource} {log.resourceId ? `(${log.resourceId.slice(-6)})` : ''}
                          </span>
                        </td>
                        <td>
                          <span className="text-xs font-mono text-slate-500">{log.actorIp || '—'}</span>
                        </td>
                        <td>
                          {log.status === 'success' ? (
                            <StatusBadge status="success">Success</StatusBadge>
                          ) : (
                            <StatusBadge status="danger">Failed</StatusBadge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Stacked Cards View */}
              <div className="md:hidden space-y-3">
                {filteredAuditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-4 rounded-xl border border-slate-200 bg-white hover:border-indigo-300 shadow-xs transition-all space-y-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-slate-100 text-slate-800">
                        {log.action}
                      </span>
                      {log.status === 'success' ? (
                        <StatusBadge status="success">Success</StatusBadge>
                      ) : (
                        <StatusBadge status="danger">Failed</StatusBadge>
                      )}
                    </div>

                    <div className="text-xs text-slate-800 font-medium">
                      {log.actorEmail} <span className="text-[10px] text-slate-400 font-normal">({log.actorRole})</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-1 border-t border-slate-100">
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">Resource</div>
                        <div className="font-medium text-slate-700 truncate mt-0.5">
                          {log.resource} {log.resourceId ? `(${log.resourceId.slice(-6)})` : ''}
                        </div>
                      </div>
                      <div className="bg-slate-50 rounded-lg p-2.5">
                        <div className="text-[10px] uppercase font-semibold text-slate-400 tracking-wider">IP Address</div>
                        <div className="font-mono text-slate-600 truncate mt-0.5">
                          {log.actorIp || '—'}
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-400 font-mono">
                      {new Date(log.timestamp).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {/* ========================================================================= */}
      {/* SUB-TAB 5: GOVERNANCE & DANGER ZONE                                       */}
      {/* ========================================================================= */}
      {activeSubTab === 'governance' && (
        <div className="space-y-6">
          {/* Mailbox Allocation Adjustment */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Mailbox Quota Limit</h3>
                <p className="text-xs text-slate-500">
                  Total maximum mailbox capacity granted across all domains in this tenant
                </p>
              </div>
              <span className="text-xs font-semibold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-100">
                Current: {tenant.mailboxLimit} seats
              </span>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-800">Change Mailbox Limit</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                  Currently utilizing {mailboxes.length} of {tenant.mailboxLimit} seats ({usagePercent}%).
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <input
                  type="number"
                  min={Math.max(1, mailboxes.length)}
                  max={5000}
                  value={newQuotaValue}
                  onChange={(e) => setNewQuotaValue(parseInt(e.target.value, 10) || 0)}
                  className="form-input h-8 text-xs w-28 text-center font-semibold"
                />
                <Button
                  size="sm"
                  variant="primary"
                  onClick={handleSaveQuota}
                  disabled={quotaSaving || newQuotaValue === tenant.mailboxLimit}
                >
                  {quotaSaving ? 'Saving...' : 'Update Limit'}
                </Button>
              </div>
            </div>
          </section>

          {/* Lifecycle Controls */}
          <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Organization Access & Lifecycle</h3>
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="text-xs font-semibold text-slate-800">
                  {isSuspended ? 'Reactivate Organization' : 'Suspend Organization Access'}
                </div>
                <div className="text-[11px] text-slate-500 mt-0.5 max-w-xl">
                  {isSuspended
                    ? 'Restore full platform and webmail access for all users, domains, and administrators in this tenant.'
                    : 'Suspension immediately restricts webmail authentication, SMTP outbound delivery, and administrator logins for all users in this tenant.'}
                </div>
              </div>

              {isActive && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleToggleSuspend}
                  disabled={lifecycleLoading}
                  className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 shrink-0"
                  icon={<PauseCircle className="w-4 h-4" />}
                >
                  Suspend Tenant
                </Button>
              )}

              {isSuspended && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleToggleSuspend}
                  disabled={lifecycleLoading}
                  className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 shrink-0"
                  icon={<PlayCircle className="w-4 h-4" />}
                >
                  Reactivate Tenant
                </Button>
              )}
            </div>
          </section>

          {/* Permanent deletion: the secure timeline flow first, then an emergency bypass */}
          <OrganisationDeletionPanel
            tenantId={tenant.id}
            organisationName={tenant.name}
            domainCount={details.domains.length}
            onChanged={() => {
              fetchTenantDetails();
              onTenantUpdated?.();
            }}
            onDeleted={() => {
              onTenantUpdated?.();
              onBack();
            }}
          />

          <section className="bg-white border border-rose-200 rounded-xl p-6 shadow-xs space-y-4">
            <div className="flex items-center gap-2.5 text-rose-600">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-sm font-bold text-rose-700">Emergency immediate delete</h3>
            </div>
            <p className="text-xs text-rose-600/90 leading-relaxed">
              Skips the 7-day suspension, name confirmation and OTP steps and deletes this organization straight away. It is still recorded in
              Deleted Organisations with your name, IP and device, and the registration email is still permanently blocked. Irreversible.
            </p>

            <div className="p-4 bg-rose-50/50 border border-rose-200/80 rounded-lg space-y-3">
              <label className="field-label text-rose-900">
                To confirm deletion, type <span className="font-bold underline">{tenant.name}</span> below:
              </label>
              <div className="flex flex-col sm:flex-row items-center gap-3">
                <input
                  type="text"
                  value={confirmDeleteName}
                  onChange={(e) => setConfirmDeleteName(e.target.value)}
                  placeholder={`Type "${tenant.name}"`}
                  className="form-input h-8 text-xs flex-1 w-full border-rose-300 focus:border-rose-500 focus:ring-rose-500"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleDeleteTenant}
                  disabled={isDeleting || confirmDeleteName !== tenant.name}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-semibold disabled:opacity-40 shrink-0 w-full sm:w-auto"
                  icon={<Trash2 className="w-4 h-4" />}
                >
                  {isDeleting ? 'Deleting...' : 'Permanently Delete Tenant'}
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}

    </div>
  );
};
