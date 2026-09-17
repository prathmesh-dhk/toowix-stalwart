import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { TenantSummary, DomainItem, MailboxItem, AuditItem, UserContext, DomainDeletionRequestItem, DomainDnsStatus } from '../types';
import toowixLogo from '../assets/toowix-logo.svg';
import { Button } from './ui/Button';
import { StatusBadge } from './ui/StatusBadge';
import { StorageView } from './StorageView';
import { BillingView } from './BillingView';
import { DomainSetupModal } from './DomainSetupModal';
import { DomainDnsStatusModal } from './DomainDnsStatusModal';
import { DomainDeletionModal } from './DomainDeletionModal';
import { DnsStatusPanel } from './DnsStatusPanel';
import { DnsProviderCredentialForm } from './DnsProviderCredentialForm';
import {
  Loader2,
  LogOut,
  LayoutDashboard,
  Mail,
  HardDrive,
  CreditCard,
  FileText,
  Shield,
  AlertCircle,
  AlertTriangle,
  Plus,
  CheckCircle2,
  Globe,
  Users,
  Building2,
  ArrowRight,
  Key,
  History,
  Search,
  Lock,
  Copy,
  Check,
  RefreshCw,
  X,
  Trash2,
  MoreVertical,
  Ban,
  KeyRound,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface TenantAdminDashboardProps {
  domainId: string;
  user?: UserContext | null;
  onLogout?: () => void;
  onNavigateHome: () => void;
}

export const TenantAdminDashboard: React.FC<TenantAdminDashboardProps> = ({ domainId, user, onLogout, onNavigateHome }) => {
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [activeDomain, setActiveDomain] = useState<DomainItem | null>(null);
  const [showDomainModal, setShowDomainModal] = useState(false);
  const [showDnsStatusModal, setShowDnsStatusModal] = useState(false);
  const [showDomainDeletionModal, setShowDomainDeletionModal] = useState(false);
  const [deletionRequest, setDeletionRequest] = useState<DomainDeletionRequestItem | null>(null);
  const [mailboxes, setMailboxes] = useState<MailboxItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [activeNav, setActiveNav] = useState<'dashboard' | 'mailboxes' | 'storage' | 'billing' | 'domains'>('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [loading, setLoading] = useState(true);

  // 2FA Setup Notification State (removable per login session)
  const [dismissed2FaBanner, setDismissed2FaBanner] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('toowix_dismissed_2fa_banner') === 'true';
    } catch {
      return false;
    }
  });
  const [is2FaEnabled, setIs2FaEnabled] = useState<boolean>(Boolean(user?.twoFactorEnabled));

  useEffect(() => {
    if (user?.twoFactorEnabled !== undefined) {
      setIs2FaEnabled(Boolean(user.twoFactorEnabled));
    }
    if (typeof api.getSecuritySettings === 'function') {
      api.getSecuritySettings()
        .then((sec) => {
          if (typeof sec?.twoFactorEnabled === 'boolean') {
            setIs2FaEnabled(sec.twoFactorEnabled);
          }
        })
        .catch(() => {});
    }
  }, [user?.twoFactorEnabled]);

  const handleDismiss2FaBanner = () => {
    setDismissed2FaBanner(true);
    try {
      sessionStorage.setItem('toowix_dismissed_2fa_banner', 'true');
    } catch {
      // ignore
    }
  };

  // Create Mailbox Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [localPart, setLocalPart] = useState('');
  const [password, setPassword] = useState('');
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Reset Password Modal state
  const [selectedMailboxForReset, setSelectedMailboxForReset] = useState<MailboxItem | null>(null);
  const [newMailboxPassword, setNewMailboxPassword] = useState('');
  const [resetModalLoading, setResetModalLoading] = useState(false);
  const [resetModalError, setResetModalError] = useState<string | null>(null);

  // Delete Mailbox Confirmation Modal state
  const [selectedMailboxForDelete, setSelectedMailboxForDelete] = useState<MailboxItem | null>(null);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [deleteModalLoading, setDeleteModalLoading] = useState(false);
  const [deleteModalError, setDeleteModalError] = useState<string | null>(null);

  const isDeleteConfirmed = Boolean(
    selectedMailboxForDelete &&
    deleteConfirmEmail.trim().toLowerCase() === selectedMailboxForDelete.address.toLowerCase()
  );

  // Mailbox three-dots actions menu
  const [openMenuMailboxId, setOpenMenuMailboxId] = useState<string | null>(null);

  // Suspend Mailbox Confirmation Modal state
  const [selectedMailboxForSuspend, setSelectedMailboxForSuspend] = useState<MailboxItem | null>(null);
  const [suspendModalLoading, setSuspendModalLoading] = useState(false);
  const [suspendModalError, setSuspendModalError] = useState<string | null>(null);

  // Reactivate Mailbox Confirmation Modal state
  const [selectedMailboxForReactivate, setSelectedMailboxForReactivate] = useState<MailboxItem | null>(null);
  const [reactivateModalLoading, setReactivateModalLoading] = useState(false);
  const [reactivateModalError, setReactivateModalError] = useState<string | null>(null);

  // DNS Status state
  const [domainDnsStatus, setDomainDnsStatus] = useState<DomainDnsStatus | null>(null);
  const [dnsStatusLoading, setDnsStatusLoading] = useState(false);
  const [dnsStatusError, setDnsStatusError] = useState<string | null>(null);
  const [showInlineProviderForm, setShowInlineProviderForm] = useState(false);

  // Password copy feedback
  const [copiedPasswordKey, setCopiedPasswordKey] = useState<string | null>(null);

  const generateStrongPassword = () => {
    const uppercase = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lowercase = 'abcdefghijkmnopqrstuvwxyz';
    const digits = '23456789';
    const symbols = '!@#$%^&*_-+=';
    const allChars = uppercase + lowercase + digits + symbols;

    const getRandomChar = (charset: string) => {
      const randomValues = new Uint32Array(1);
      window.crypto.getRandomValues(randomValues);
      return charset[randomValues[0] % charset.length];
    };

    // Ensure balanced character distribution (minimum 2 of each class)
    const chars: string[] = [
      getRandomChar(uppercase),
      getRandomChar(uppercase),
      getRandomChar(lowercase),
      getRandomChar(lowercase),
      getRandomChar(digits),
      getRandomChar(digits),
      getRandomChar(symbols),
      getRandomChar(symbols),
    ];

    // Expand to 16 characters with full entropy
    while (chars.length < 16) {
      chars.push(getRandomChar(allChars));
    }

    // Cryptographically strong Fisher-Yates shuffle
    const shuffleArray = new Uint32Array(chars.length);
    window.crypto.getRandomValues(shuffleArray);
    for (let i = chars.length - 1; i > 0; i--) {
      const j = shuffleArray[i] % (i + 1);
      [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    return chars.join('');
  };

  const handleCopyPassword = (pwd: string, key: string) => {
    if (!pwd) return;
    navigator.clipboard.writeText(pwd);
    setCopiedPasswordKey(key);
    setTimeout(() => setCopiedPasswordKey(null), 2000);
  };

  const loadTenantData = async (targetDomainId?: string) => {
    try {
      const [tenantRes, domainsRes, auditRes] = await Promise.all([
        api.getTenantMe(),
        typeof api.listTenantDomains === 'function'
          ? api.listTenantDomains().catch(() => ({ domains: [] }))
          : Promise.resolve({ domains: [] }),
        api.getAuditLogs({ limit: 50 }).catch(() => ({ logs: [] })),
      ]);

      const loadedTenant = tenantRes.tenant;
      const loadedDomains: DomainItem[] = domainsRes?.domains?.length
        ? domainsRes.domains
        : loadedTenant.domains?.length
          ? loadedTenant.domains
          : loadedTenant.domain
            ? [{
                id: loadedTenant.domain.id,
                domainName: loadedTenant.domain.domainName,
                status: loadedTenant.domain.status,
                mailboxLimit: loadedTenant.mailboxLimit || 50,
                employeeCount: loadedTenant.mailboxLimit || 50,
                mailboxCount: loadedTenant.mailboxCount || 0,
                isPrimary: true,
              }]
            : [];

      setTenant(loadedTenant);
      setDomains(loadedDomains);
      setAuditLogs(auditRes.logs || []);

      // This view is always scoped to one domain, sourced from the route
      // (`domainId` prop) — never a sidebar switcher (that's Tenant Home now).
      const currentDomain = loadedDomains.find((d) => d.id === (targetDomainId || domainId)) || null;
      setActiveDomain(currentDomain);

      // Load mailboxes, deletion request, and DNS status for active domain
      if (currentDomain) {
        const [mailboxesRes, deletionRes] = await Promise.all([
          api.listMyMailboxes(currentDomain.id).catch(() => ({ mailboxes: [] })),
          typeof api.getDomainDeletionRequest === 'function'
            ? api.getDomainDeletionRequest(currentDomain.id).catch(() => ({ request: null }))
            : Promise.resolve({ request: null }),
        ]);
        setMailboxes(mailboxesRes.mailboxes || []);
        setDeletionRequest(deletionRes.request);
        loadDomainDnsStatus(currentDomain.id);
      } else {
        setMailboxes([]);
        setDeletionRequest(null);
        setDomainDnsStatus(null);
      }
    } catch (err) {
      console.error('Failed to load tenant data:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadDeletionRequest = async (domainId: string) => {
    try {
      const res = await api.getDomainDeletionRequest(domainId);
      setDeletionRequest(res.request);
    } catch {
      setDeletionRequest(null);
    }
  };

  useEffect(() => {
    loadTenantData();
  }, []);

  useEffect(() => {
    const handleDocumentClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-mailbox-menu]')) {
        setOpenMenuMailboxId(null);
      }
    };
    document.addEventListener('click', handleDocumentClick);
    return () => document.removeEventListener('click', handleDocumentClick);
  }, []);

  const loadDomainDnsStatus = async (domainId: string) => {
    if (!domainId || typeof api.getDomainDnsStatus !== 'function') return;
    setDnsStatusLoading(true);
    setDnsStatusError(null);
    try {
      const res = await api.getDomainDnsStatus(domainId);
      setDomainDnsStatus(res);
    } catch (err: any) {
      setDnsStatusError(err.message || 'Failed to load DNS status.');
    } finally {
      setDnsStatusLoading(false);
    }
  };

  const handleDomainAdded = async (newDomain: DomainItem) => {
    await loadTenantData(newDomain.id);
  };

  useEffect(() => {
    if (activeNav === 'domains' && activeDomain?.id) {
      loadDomainDnsStatus(activeDomain.id);
    }
  }, [activeNav, activeDomain?.id]);

  const handleOpenCreateModal = () => {
    if (activeDomain && activeDomain.dnsStatus !== 'active') {
      alert(`Domain '${activeDomain.domainName}' is pending activation by a Super Admin. Mailbox creation will unlock once activated.`);
      return;
    }
    setLocalPart('');
    setPassword(generateStrongPassword());
    setModalError(null);
    setShowCreateModal(true);
  };

  const handleCreateMailbox = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDomain) {
      setModalError('Please add or select a domain before creating mailboxes.');
      return;
    }
    if (activeDomain.dnsStatus !== 'active') {
      setModalError(`Domain '${activeDomain.domainName}' is pending activation by a Super Admin. Mailboxes can only be created once activated.`);
      return;
    }

    const cleanPrefix = localPart.trim().toLowerCase();
    if (!cleanPrefix) {
      setModalError('Please enter a username prefix.');
      return;
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(cleanPrefix)) {
      setModalError('Local part can only contain letters, numbers, dots, hyphens, and underscores.');
      return;
    }
    if (!password || password.length < 8) {
      setModalError('Password must be at least 8 characters long.');
      return;
    }

    setModalLoading(true);
    setModalError(null);

    try {
      await api.createMailbox({
        localPart: cleanPrefix,
        password,
        domainId: activeDomain.id,
      });
      setShowCreateModal(false);
      setLocalPart('');
      setPassword('');
      await loadTenantData(activeDomain.id);
    } catch (err: any) {
      setModalError(err.message || 'Failed to create mailbox.');
    } finally {
      setModalLoading(false);
    }
  };

  const handleOpenResetModal = (mb: MailboxItem) => {
    setSelectedMailboxForReset(mb);
    setNewMailboxPassword(generateStrongPassword());
    setResetModalError(null);
    setOpenMenuMailboxId(null);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedMailboxForReset) return;
    if (!newMailboxPassword || newMailboxPassword.length < 8) {
      setResetModalError('New password must be at least 8 characters long.');
      return;
    }

    setResetModalLoading(true);
    setResetModalError(null);

    try {
      await api.resetMailboxPassword(selectedMailboxForReset.id, newMailboxPassword);
      const addr = selectedMailboxForReset.address;
      setSelectedMailboxForReset(null);
      setNewMailboxPassword('');
      alert(`Password for ${addr} has been updated successfully.`);
      await loadTenantData(activeDomain?.id);
    } catch (err: any) {
      setResetModalError(err.message || 'Failed to update mailbox password.');
    } finally {
      setResetModalLoading(false);
    }
  };

  const handleOpenSuspendModal = (mb: MailboxItem) => {
    setSelectedMailboxForSuspend(mb);
    setSuspendModalError(null);
    setOpenMenuMailboxId(null);
  };

  const handleConfirmSuspendMailbox = async () => {
    if (!selectedMailboxForSuspend) return;
    setSuspendModalLoading(true);
    setSuspendModalError(null);

    try {
      await api.suspendMailbox(selectedMailboxForSuspend.id);
      setSelectedMailboxForSuspend(null);
      await loadTenantData(activeDomain?.id);
    } catch (err: any) {
      setSuspendModalError(err.message || 'Failed to suspend mailbox.');
    } finally {
      setSuspendModalLoading(false);
    }
  };

  const handleOpenReactivateModal = (mb: MailboxItem) => {
    setSelectedMailboxForReactivate(mb);
    setReactivateModalError(null);
    setOpenMenuMailboxId(null);
  };

  const handleConfirmReactivateMailbox = async () => {
    if (!selectedMailboxForReactivate) return;
    setReactivateModalLoading(true);
    setReactivateModalError(null);

    try {
      await api.reactivateMailbox(selectedMailboxForReactivate.id);
      setSelectedMailboxForReactivate(null);
      await loadTenantData(activeDomain?.id);
    } catch (err: any) {
      setReactivateModalError(err.message || 'Failed to reactivate mailbox.');
    } finally {
      setReactivateModalLoading(false);
    }
  };

  const handleOpenDeleteModal = (mb: MailboxItem) => {
    setSelectedMailboxForDelete(mb);
    setDeleteConfirmEmail('');
    setDeleteModalError(null);
    setOpenMenuMailboxId(null);
  };

  const handleConfirmDeleteMailbox = async () => {
    if (!selectedMailboxForDelete || !isDeleteConfirmed) return;
    setDeleteModalLoading(true);
    setDeleteModalError(null);

    try {
      await api.deleteMailbox(selectedMailboxForDelete.id);
      setSelectedMailboxForDelete(null);
      setDeleteConfirmEmail('');
      await loadTenantData(activeDomain?.id);
    } catch (err: any) {
      setDeleteModalError(err.message || 'Failed to delete mailbox.');
    } finally {
      setDeleteModalLoading(false);
    }
  };


  const formatRelativeTime = (dateString?: string) => {
    if (!dateString) return 'recently';
    const date = new Date(dateString);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min${diffMin > 1 ? 's' : ''} ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getInitials = (text: string) => {
    if (!text) return 'MB';
    const prefix = text.split('@')[0];
    const parts = prefix.split(/[._-]/);
    if (parts.length >= 2 && parts[0] && parts[1]) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return prefix.slice(0, 2).toUpperCase();
  };

  const formatAuditAction = (action: string, metadata?: any) => {
    switch (action) {
      case 'MAILBOX_CREATED':
        return `${metadata?.address || 'Mailbox'} created`;
      case 'MAILBOX_PASSWORD_RESET':
        return `Password reset for ${metadata?.address || 'mailbox'}`;
      case 'MAILBOX_DELETED':
        return `Mailbox ${metadata?.address || ''} deleted`;
      case 'AUTH_LOGIN_SUCCESS':
        return `Admin login authenticated`;
      case '2FA_VERIFIED':
        return `Two-Factor verification completed`;
      case 'SETTINGS_UPDATED':
        return `Security settings updated`;
      default:
        return action.replace(/_/g, ' ').toLowerCase();
    }
  };

  const filteredMailboxes = useMemo(() => {
    return mailboxes.filter((m) => {
      const matchSearch =
        m.localPart.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.address.toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === 'all' || m.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [mailboxes, searchTerm, statusFilter]);

  const domainName = activeDomain?.domainName || tenant?.domain?.domainName || '';
  const mailboxCount = mailboxes.length;
  const mailboxLimit = activeDomain?.mailboxLimit ?? (tenant?.mailboxLimit || 10);
  const usagePercent = Math.min(100, Math.round((mailboxCount / Math.max(1, mailboxLimit)) * 100));
  const availableCount = Math.max(0, mailboxLimit - mailboxCount);
  const isSuspended = tenant?.status === 'suspended';
  const isDomainPendingActivation = Boolean(activeDomain && activeDomain.dnsStatus !== 'active');

  // Fallback admin email & initials
  const adminEmail = user?.email || (tenant ? `admin@${domainName}` : 'admin@toowix.com');
  const adminInitials = adminEmail ? adminEmail.slice(0, 2).toUpperCase() : 'AT';

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
      {/* ========================================================================= */}
      {/* TOP HEADER (MATCHING GOOGLE STITCH DESIGN)                                */}
      {/* ========================================================================= */}
      <header className="fixed top-0 inset-x-0 z-40 bg-white border-b border-slate-200 h-16">
        <div className="h-full px-6 flex items-center justify-between">
          {/* Brand & Tenant Context */}
          <div className="flex items-center gap-4">
            {/* Brand — clickable here: this view is one domain drilled into
                from Tenant Home, so it's always a way back to the full list. */}
            <button
              type="button"
              onClick={onNavigateHome}
              className="flex items-center gap-3 cursor-pointer group"
              title="Back to all domains"
            >
              <img src={toowixLogo} alt="Toowix" className="w-8 h-8 object-contain" />
              <span className="font-semibold text-slate-900 text-sm tracking-tight leading-tight select-none group-hover:text-indigo-600 transition-colors">
                TOOWIX ADMIN
              </span>
            </button>

            <span className="text-slate-300 font-light text-base hidden md:inline select-none">/</span>

            {/* Organization Badge */}
            <div className="hidden md:inline-flex items-center gap-2 px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200/80 text-xs">
              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-800 tracking-tight">
                {tenant?.name || 'Acme Technologies'}
              </span>
            </div>
          </div>

          {/* Right Utility Actions */}
          <div className="flex items-center gap-4">
            {/* Admin Profile */}
            <div className="flex items-center gap-3 pl-2 border-l border-slate-200">
              <div className="w-8 h-8 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-semibold">
                {adminInitials}
              </div>
              <div className="hidden lg:flex flex-col text-left">
                <span className="text-xs font-medium text-slate-900 leading-tight">
                  {adminEmail}
                </span>
                <span className="text-[11px] text-slate-400 font-normal leading-tight">
                  Administrator
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
          {/* Back to Tenant Home (domain switching now happens by going back
              to the full domain list, not an inline dropdown). */}
          <button
            type="button"
            onClick={onNavigateHome}
            className="w-full flex items-center gap-2 px-3 py-2.5 mb-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 text-slate-700 transition-colors cursor-pointer text-xs font-medium"
            id="btn-back-to-domains"
          >
            <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0 rotate-180" />
            <span className="truncate">{activeDomain?.domainName || 'All Domains'}</span>
          </button>

          {activeDomain && (
            <button
              type="button"
              onClick={() => setShowDnsStatusModal(true)}
              className="w-full flex items-center gap-2 px-3 py-2 mb-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-700 transition-colors cursor-pointer text-xs font-medium"
              id="btn-view-dns-setup"
            >
              <FileText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>View DNS Setup</span>
            </button>
          )}

          {/* Main Navigation Group */}
          <div className="flex flex-col gap-0.5">
            {/* Dashboard */}
            <button
              onClick={() => setActiveNav('dashboard')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeNav === 'dashboard'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-dashboard"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <LayoutDashboard
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeNav === 'dashboard' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Dashboard</span>
              </div>
            </button>

            {/* Mailboxes with dynamic Count Badge */}
            <button
              onClick={() => setActiveNav('mailboxes')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeNav === 'mailboxes'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-mailboxes"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Mail
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeNav === 'mailboxes' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Mailboxes</span>
              </div>
              <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200/60">
                {mailboxCount}
              </span>
            </button>

            {/* Storage */}
            <button
              onClick={() => setActiveNav('storage')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeNav === 'storage'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-storage"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <HardDrive
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeNav === 'storage' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Storage</span>
              </div>
            </button>

            {/* Billing */}
            <button
              onClick={() => setActiveNav('billing')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeNav === 'billing'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-billing"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <CreditCard
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeNav === 'billing' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Billing</span>
              </div>
            </button>
          </div>

          {/* Divider matching Google Admin console */}
          <div className="my-2 border-t border-slate-200/80" />

          {/* Security & Organization Governance */}
          <div className="flex flex-col gap-0.5">
            {/* Domains & DNS */}
            <button
              onClick={() => setActiveNav('domains')}
              className={`w-full h-10 px-4 flex items-center justify-between rounded-full text-sm transition-colors duration-150 text-left group ${
                activeNav === 'domains'
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-normal'
              }`}
              id="nav-domains"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <Globe
                  className={`w-5 h-5 shrink-0 transition-colors ${
                    activeNav === 'domains' ? 'text-indigo-600' : 'text-slate-500 group-hover:text-slate-700'
                  }`}
                  strokeWidth={1.75}
                />
                <span className="truncate">Domains & DNS</span>
              </div>
            </button>
          </div>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* MAIN VIEW CONTAINER                                                       */}
      {/* ========================================================================= */}
      <div className="pl-60 pt-16 min-h-screen bg-[#f8fafc]">
        <main className="page-content-scaled w-full max-w-6xl mx-auto px-10 py-10 flex flex-col gap-8">
          {/* Operational Banners */}
          {isSuspended && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3 text-rose-900">
              <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5 text-xs">
                <span className="font-semibold text-rose-900">
                  Workspace Suspended by Platform Administrators
                </span>
                <span className="text-rose-700">
                  Mailbox provisioning, password resets, and outbound email routing are currently paused. Please contact platform support for resolution.
                </span>
              </div>
            </div>
          )}

          {usagePercent >= 100 && !isSuspended && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3 text-amber-900">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5 text-xs">
                <span className="font-semibold text-amber-900">
                  Mailbox Allocation Limit Reached ({mailboxLimit} / {mailboxLimit})
                </span>
                <span className="text-amber-700">
                  All allocated mailbox accounts have been provisioned. To add more employee mailboxes, request a quota upgrade from the Super Admin.
                </span>
              </div>
            </div>
          )}

          {isDomainPendingActivation && !isSuspended && domains.length > 0 && (
            <div className="bg-sky-50 border border-sky-200 rounded-xl p-4 flex items-start gap-3 text-sky-950">
              <AlertCircle className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
              <div className="flex flex-col gap-0.5 text-xs">
                <span className="font-semibold text-sky-900">
                  Domain Pending Super Admin Activation
                </span>
                <span className="text-sky-700">
                  Domain <span className="font-medium">@{domainName}</span> is awaiting activation by a Super Admin. You can copy the DNS Zone File now from the{' '}
                  <button
                    type="button"
                    onClick={() => setActiveNav('domains')}
                    className="underline font-semibold hover:text-sky-900 cursor-pointer"
                  >
                    Domains
                  </button>{' '}
                  tab; mailbox creation will unlock automatically once activated.
                </span>
              </div>
            </div>
          )}

          {/* 2FA Setup Reminder Banner (Removable per login session) */}
          {!is2FaEnabled && !dismissed2FaBanner && (
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
                      Protect your administrative controls and organization mailboxes from unauthorized access. Set up an authenticator app or email-based 2-step verification.
                    </p>
                    <div className="mt-2.5 flex items-center gap-3">
                      <button
                        type="button"
                        onClick={onNavigateHome}
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

          {/* ===================================================================== */}
          {/* VIEW: DASHBOARD (ADMIN OVERVIEW)                                      */}
          {/* ===================================================================== */}
          {activeNav === 'dashboard' && (
            <>
              {/* TOP ACTION & CONTEXT BAR */}
              <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                    Admin Overview
                  </h1>
                  <p className="text-xs text-slate-500 font-normal">
                    {domainName ? (
                      <>
                        Organization mail services for{' '}
                        <span className="font-medium text-slate-700">@{domainName}</span>
                      </>
                    ) : (
                      'Organization mail infrastructure and domain controls'
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Button
                    disabled={isSuspended || domains.length === 0 || usagePercent >= 100 || isDomainPendingActivation}
                    title={isDomainPendingActivation ? 'Domain is pending Super Admin activation' : undefined}
                    onClick={handleOpenCreateModal}
                    size="sm"
                    icon={<Plus className="w-4 h-4" />}
                  >
                    Create mailbox
                  </Button>
                  <Button
                    onClick={() => setActiveNav(domains.length === 0 ? 'domains' : 'mailboxes')}
                    variant="secondary"
                    size="sm"
                  >
                    {domains.length === 0 ? 'Domain settings' : 'View mailboxes'}
                  </Button>
                </div>
              </section>

              {/* ONBOARDING SETUP BANNER WHEN NO DOMAINS CONFIGURED */}
              {domains.length === 0 && (
                <section className="bg-white border border-slate-200 rounded-2xl p-6 md:p-7 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6 animate-in fade-in">
                  <div className="flex flex-col gap-3 max-w-2xl">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider bg-indigo-50 text-indigo-700 px-2.5 py-0.5 rounded-full border border-indigo-200/60">
                        Setup Required
                      </span>
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-500 font-medium">Getting Started</span>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <h2 className="text-xl font-bold tracking-tight text-slate-900">
                        Connect your first domain to get started
                      </h2>
                      <p className="text-xs text-slate-600 leading-relaxed">
                        Add an authoritative domain to allocate employee mailbox seats. Once added, your DNS records (MX, SPF, DKIM) will be generated automatically so you can start provisioning team accounts.
                      </p>
                    </div>

                    <div className="flex items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowDomainModal(true)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
                        id="btn-add-first-domain-dashboard"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add Your First Domain</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveNav('domains')}
                        className="px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-medium transition-colors cursor-pointer"
                      >
                        Learn about DNS setup
                      </button>
                    </div>
                  </div>

                  {/* Clean 3-Step Setup Checklist */}
                  <div className="w-full md:w-64 bg-slate-50 border border-slate-200/70 rounded-xl p-4 flex flex-col gap-3 shrink-0">
                    <span className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider">
                      Setup Checklist
                    </span>
                    <div className="flex flex-col gap-2.5 text-xs">
                      <div className="flex items-center gap-2 text-indigo-700 font-medium">
                        <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                          1
                        </span>
                        <span>Connect Domain</span>
                        <span className="ml-auto text-[10px] bg-indigo-50 px-1.5 py-0.5 rounded text-indigo-600 font-semibold border border-indigo-200/50">Next</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400">
                        <span className="w-5 h-5 rounded-full bg-slate-200/70 text-slate-500 flex items-center justify-center text-[10px] font-bold shrink-0">
                          2
                        </span>
                        <span>Publish DNS Records</span>
                      </div>
                      <div className="flex items-center gap-2 text-slate-400">
                        <span className="w-5 h-5 rounded-full bg-slate-200/70 text-slate-500 flex items-center justify-center text-[10px] font-bold shrink-0">
                          3
                        </span>
                        <span>Create Team Mailboxes</span>
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* OVERVIEW CONTENT - ONLY VISIBLE ONCE FIRST DOMAIN IS CONFIGURED */}
              {domains.length > 0 && (
                <>
                  {/* 2-PART OVERVIEW GRID */}
                  <section className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* Card 1: Mailbox Allocation */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between shadow-xs">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Mailbox Allocation
                        </span>
                        <Mail className="w-[18px] h-[18px] text-slate-400" />
                      </div>
                      <div className="flex flex-col gap-2">
                        <div className="flex items-baseline gap-2">
                          <span className="text-2xl font-semibold text-slate-900">
                            {mailboxCount}{' '}
                            <span className="text-sm font-normal text-slate-500">
                              / {mailboxLimit} Used
                            </span>
                          </span>
                          <span className="text-xs text-slate-500 ml-auto font-medium">
                            {usagePercent}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              usagePercent >= 90
                                ? 'bg-rose-500'
                                : usagePercent >= 75
                                  ? 'bg-amber-500'
                                  : 'bg-indigo-600'
                            }`}
                            style={{ width: `${usagePercent}%` }}
                          ></div>
                        </div>
                        <span className="text-[11px] text-slate-500 mt-1">
                          {availableCount} Available for assignment
                        </span>
                      </div>
                    </div>

                    {/* Card 2: Domain Summary */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between shadow-xs">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                          Domain Summary
                        </span>
                        <Globe className="w-[18px] h-[18px] text-slate-400" />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-semibold tracking-tight text-slate-900 truncate">
                            {domainName || 'No domain'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-emerald-700 mt-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Authoritative domain verified</span>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* SIDE-BY-SIDE DUAL PANELS */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* Left Panel: Recently Added Mailboxes */}
                    <section className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-5">
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <Users className="w-[18px] h-[18px] text-slate-400" />
                          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                            Recently Added Mailboxes
                          </h2>
                        </div>
                        <button
                          onClick={() => setActiveNav('mailboxes')}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span>View all mailboxes</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {mailboxes.length === 0 ? (
                        <div className="py-8 text-center flex flex-col items-center gap-2 text-slate-400">
                          <Mail className="w-7 h-7 text-slate-300" />
                          <p className="text-xs text-slate-500">No mailboxes created yet.</p>
                          {isDomainPendingActivation ? (
                            <p className="text-xs text-amber-600 font-medium">
                              Mailbox creation will unlock once @{domainName} is activated by a Super Admin.
                            </p>
                          ) : (
                            <button
                              onClick={handleOpenCreateModal}
                              className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline cursor-pointer"
                            >
                              + Create your first mailbox
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col divide-y divide-slate-100">
                          {mailboxes.slice(0, 4).map((mb) => (
                            <div
                              key={mb.id}
                              className="py-3 flex items-center justify-between gap-4 hover:bg-slate-50/50 -mx-2 px-2 rounded-lg transition-colors group"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-xs font-medium shrink-0">
                                  {getInitials(mb.address)}
                                </div>
                                <div className="flex flex-col min-w-0">
                                  <span className="text-xs font-medium text-slate-900 truncate">
                                    {mb.address}
                                  </span>
                                  <span className="text-[11px] text-slate-400 mt-0.5">
                                    Created {formatRelativeTime(mb.createdAt)}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 shrink-0">
                                <button
                                  onClick={() => handleOpenResetModal(mb)}
                                  className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-indigo-600 rounded transition-opacity"
                                  title="Reset Password"
                                >
                                  <Key className="w-3.5 h-3.5" />
                                </button>

                                <StatusBadge status={mb.status} label={mb.status} />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    {/* Right Panel: Organization Event Log */}
                    <section className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-5">
                      <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                          <History className="w-[18px] h-[18px] text-slate-400" />
                          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                            Organization Event Log
                          </h2>
                        </div>
                        <button
                          onClick={onNavigateHome}
                          className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1 cursor-pointer"
                        >
                          <span>View audit log</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {auditLogs.length === 0 ? (
                        <div className="py-8 text-center flex flex-col items-center gap-2 text-slate-400">
                          <FileText className="w-7 h-7 text-slate-300" />
                          <p className="text-xs text-slate-500">No recent events recorded.</p>
                        </div>
                      ) : (
                        <div className="flex flex-col divide-y divide-slate-100">
                          {auditLogs.slice(0, 4).map((log) => (
                            <div key={log.id} className="py-3 flex flex-col gap-0.5">
                              <span className="text-xs text-slate-800 leading-snug">
                                {formatAuditAction(log.action, log.metadata)}
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {formatRelativeTime(log.timestamp)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
            </>
          )}

          {/* ===================================================================== */}
          {/* VIEW: FULL MAILBOXES TABLE                                            */}
          {/* ===================================================================== */}
          {activeNav === 'mailboxes' && (
            domains.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center flex flex-col items-center justify-center gap-3 shadow-xs animate-in fade-in">
                <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-1 shadow-2xs">
                  <Globe className="w-6 h-6" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">No Domains Configured</h3>
                <p className="text-xs text-slate-500 max-w-sm">
                  You must add a domain and choose an employee tier before creating and managing mailbox accounts.
                </p>
                <button
                  type="button"
                  onClick={() => setShowDomainModal(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-2 cursor-pointer mt-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Your First Domain</span>
                </button>
              </div>
            ) : (
            <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-semibold text-slate-900">Mailbox Management</h2>
                  <p className="text-xs text-slate-500">
                    Provision, maintain credentials, and manage mailbox accounts for @{domainName}
                  </p>
                </div>
                <button
                  disabled={isSuspended || usagePercent >= 100 || isDomainPendingActivation}
                  title={isDomainPendingActivation ? 'Domain is pending Super Admin activation' : undefined}
                  onClick={handleOpenCreateModal}
                  className={`px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 self-start sm:self-auto ${
                    isSuspended || usagePercent >= 100 || isDomainPendingActivation ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  <span>Create mailbox</span>
                </button>
              </div>

              {/* Filter controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by address or username..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Status:</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active only</option>
                    <option value="suspended">Suspended only</option>
                  </select>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-lg min-h-[240px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-medium">
                      <th className="px-4 py-3">Email Address</th>
                      <th className="px-4 py-3">Username</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMailboxes.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400">
                          No mailboxes match your query.
                        </td>
                      </tr>
                    ) : (
                      filteredMailboxes.map((mb) => (
                        <tr key={mb.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center text-[11px] font-medium shrink-0">
                                {getInitials(mb.address)}
                              </div>
                              <span className="font-medium text-slate-900">{mb.address}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-600">{mb.localPart}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${mb.status === 'active'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200/60'
                                }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${mb.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'
                                  }`}
                              ></span>
                              <span className="capitalize">{mb.status}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {new Date(mb.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="relative inline-block text-left" data-mailbox-menu>
                              <button
                                type="button"
                                onClick={() => setOpenMenuMailboxId(openMenuMailboxId === mb.id ? null : mb.id)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                                title="Mailbox actions"
                                aria-label="Mailbox actions"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>

                              {openMenuMailboxId === mb.id && (
                                <div className="absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1.5 z-30 animate-in fade-in zoom-in-95 focus:outline-none">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleOpenResetModal(mb);
                                      setOpenMenuMailboxId(null);
                                    }}
                                    className="w-full text-left px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 flex items-center gap-2 transition-colors cursor-pointer"
                                  >
                                    <KeyRound className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <span>Reset Password</span>
                                  </button>

                                  {mb.status === 'active' ? (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenSuspendModal(mb)}
                                      className="w-full text-left px-3.5 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50/70 flex items-center gap-2 transition-colors cursor-pointer"
                                    >
                                      <Ban className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                      <span>Suspend Mailbox</span>
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleOpenReactivateModal(mb)}
                                      className="w-full text-left px-3.5 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50/70 flex items-center gap-2 transition-colors cursor-pointer"
                                    >
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                      <span>Reactivate Mailbox</span>
                                    </button>
                                  )}

                                  <div className="h-px bg-slate-100 my-1"></div>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      handleOpenDeleteModal(mb);
                                      setOpenMenuMailboxId(null);
                                    }}
                                    className="w-full text-left px-3.5 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 flex items-center gap-2 transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                    <span>Delete Mailbox</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            )
          )}

          {/* ===================================================================== */}
          {/* VIEW: DOMAINS & DNS ZONE RECORDS                                      */}
          {/* ===================================================================== */}
          {activeNav === 'domains' && (
            domains.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center flex flex-col items-center justify-center gap-3 shadow-xs animate-in fade-in">
                <div className="w-12 h-12 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-1 shadow-2xs">
                  <Globe className="w-6 h-6" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">No Domains Configured</h3>
                <p className="text-xs text-slate-500 max-w-sm">
                  Connect your domain to view authoritative DNS zone routing records (MX, SPF, DKIM, DMARC).
                </p>
                <button
                  type="button"
                  onClick={() => setShowDomainModal(true)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-2 cursor-pointer mt-2"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add Your First Domain</span>
                </button>
              </div>
            ) : (
            <section className="flex flex-col gap-6">
              {/* Domain Health Card */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Globe className="w-5 h-5 text-indigo-600" />
                    <h2 className="text-sm font-semibold text-slate-900">
                      Authoritative Domain Verification
                    </h2>
                  </div>
                  {(() => {
                    const currentStatus = domainDnsStatus?.dnsStatus || activeDomain?.dnsStatus || 'not_started';
                    if (currentStatus === 'active') {
                      return (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                          Verified & Active
                        </span>
                      );
                    }
                    if (currentStatus === 'activating') {
                      return (
                        <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                          Activating / Propagating
                        </span>
                      );
                    }
                    if (currentStatus === 'conflict') {
                      return (
                        <span className="inline-flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                          DNS Conflict
                        </span>
                      );
                    }
                    if (currentStatus === 'activation_failed') {
                      return (
                        <span className="inline-flex items-center gap-1.5 text-xs text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                          Activation Failed
                        </span>
                      );
                    }
                    return (
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full border border-slate-200 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                        Pending DNS Setup
                      </span>
                    );
                  })()}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/60">
                    <span className="text-slate-400 block text-[11px]">Assigned Domain</span>
                    <span className="font-mono font-semibold text-slate-900 text-sm mt-0.5 block">
                      {domainName}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/60">
                    <span className="text-slate-400 block text-[11px]">Transport Security</span>
                    <span className="font-semibold text-slate-900 text-sm mt-0.5 block flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-emerald-600" />
                      TLS 1.3 Strict Encrypted
                    </span>
                  </div>
                </div>
              </div>

              {/* Authoritative DNS Zone Records & Status Panel */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-4">
                <div className="flex flex-col gap-1 pb-3 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Authoritative DNS Zone Configuration
                  </h3>
                  <p className="text-xs text-slate-500">
                    Publish this zone configuration or individual records with your DNS registrar (Cloudflare, GoDaddy, Hostinger, Route 53) to ensure optimal email deliverability and avoid spam classification.
                  </p>
                </div>

                <DnsStatusPanel
                  domainName={domainName}
                  status={domainDnsStatus}
                  loading={dnsStatusLoading}
                  error={dnsStatusError}
                  onRefresh={() => {
                    if (activeDomain) loadDomainDnsStatus(activeDomain.id);
                  }}
                />

                {/* Inline DNS Provider Configuration (Optional) */}
                {activeDomain && (
                  <div className="mt-1 border border-indigo-100 rounded-xl overflow-hidden bg-indigo-50/30">
                    <button
                      type="button"
                      onClick={() => setShowInlineProviderForm((prev) => !prev)}
                      className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-indigo-50/60 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0">
                          <Key className="w-3.5 h-3.5" />
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-slate-900 block">
                            Connect DNS Provider
                          </span>
                          <span className="text-[11px] text-slate-500 block">
                            Auto-publish and verify records on GoDaddy, Hostinger, or Cloudflare
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs font-medium text-indigo-600">
                        <span>{showInlineProviderForm ? 'Hide' : 'Configure'}</span>
                        {showInlineProviderForm ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </button>

                    {showInlineProviderForm && (
                      <div className="p-4 bg-white border-t border-indigo-100 animate-in fade-in duration-150">
                        <DnsProviderCredentialForm
                          domainId={activeDomain.id}
                          domainName={activeDomain.domainName}
                          compact
                          onSuccess={() => {
                            loadDomainDnsStatus(activeDomain.id);
                            loadTenantData(activeDomain.id);
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Danger Zone: Domain Deletion */}
              <div className="bg-white border border-rose-200 rounded-xl p-6 shadow-xs flex flex-col gap-4">
                <div className="flex items-center justify-between pb-3 border-b border-rose-100">
                  <div className="flex items-center gap-2">
                    <Trash2 className="w-5 h-5 text-rose-600" />
                    <h3 className="text-sm font-semibold text-rose-950">Danger Zone</h3>
                  </div>
                  {deletionRequest?.status === 'pending' && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                      Deletion Request Pending Review
                    </span>
                  )}
                </div>

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex flex-col gap-1 max-w-xl">
                    <span className="text-xs font-semibold text-slate-900">
                      Delete Domain {domainName}
                    </span>
                    <p className="text-xs text-slate-500 leading-relaxed">
                      Permanently request removal of this domain. All associated configurations, DNS records, and active Stripe subscriptions will be cancelled upon Super Admin approval.
                    </p>
                    {activeDomain.mailboxCount > 0 ? (
                      <p className="text-xs text-rose-600 font-medium mt-1 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Remove all mailboxes first (current: {activeDomain.mailboxCount} {activeDomain.mailboxCount === 1 ? 'mailbox' : 'mailboxes'})</span>
                      </p>
                    ) : deletionRequest?.status === 'pending' ? (
                      <p className="text-xs text-amber-700 mt-1">
                        A deletion request submitted on {new Date(deletionRequest.createdAt).toLocaleDateString()} is awaiting Super Admin approval.
                      </p>
                    ) : deletionRequest?.status === 'rejected' ? (
                      <p className="text-xs text-slate-600 mt-1">
                        Previous deletion request was rejected{deletionRequest.rejectionReason ? `: "${deletionRequest.rejectionReason}"` : ''}. You may submit a new request.
                      </p>
                    ) : null}
                  </div>

                  <div className="shrink-0">
                    <button
                      type="button"
                      disabled={activeDomain.mailboxCount > 0 || deletionRequest?.status === 'pending'}
                      onClick={() => setShowDomainDeletionModal(true)}
                      title={
                        activeDomain.mailboxCount > 0
                          ? 'Remove all mailboxes first'
                          : deletionRequest?.status === 'pending'
                          ? 'Deletion request already pending review'
                          : undefined
                      }
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed border border-rose-600 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow transition-all flex items-center gap-1.5 cursor-pointer"
                      id="btn-delete-domain"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{deletionRequest?.status === 'pending' ? 'Deletion Requested' : 'Delete Domain'}</span>
                    </button>
                  </div>
                </div>
              </div>
            </section>
            )
          )}

          {/* ===================================================================== */}
          {/* VIEW: STORAGE MONITORING                                              */}
          {/* ===================================================================== */}
          {activeNav === 'storage' && (
            <StorageView activeDomain={activeDomain} />
          )}

          {/* ===================================================================== */}
          {/* VIEW: BILLING (per-domain Stripe subscription)                        */}
          {/* ===================================================================== */}
          {activeNav === 'billing' && (
            <BillingView activeDomain={activeDomain} />
          )}

        </main>
      </div>

      {/* ========================================================================= */}
      {/* MODAL: CREATE MAILBOX (MATCHING STITCH DESIGN)                             */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-5 page-content-scaled">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Create New Mailbox</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-500" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleCreateMailbox} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-slate-700">Mailbox Address</label>
                <div className="flex items-center">
                  <input
                    type="text"
                    required
                    placeholder="username"
                    value={localPart}
                    onChange={(e) => setLocalPart(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                    className="flex-1 px-3 py-1.5 text-xs rounded-l-lg border border-r-0 border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
                  />
                  <span className="px-3 py-1.5 bg-slate-50 border border-slate-300 text-xs font-mono text-slate-500 rounded-r-lg">
                    @{domainName}
                  </span>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">Temporary Password</label>
                  <button
                    type="button"
                    onClick={() => setPassword(generateStrongPassword())}
                    className="text-[11px] text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Generate strong</span>
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyPassword(password, 'create-modal')}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1 transition-colors shrink-0 shadow-xs"
                    title="Copy password to clipboard"
                  >
                    {copiedPasswordKey === 'create-modal' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span>{copiedPasswordKey === 'create-modal' ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
                <span className="text-[11px] text-slate-400">
                  User will be prompted to reset password on first sign-in.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 mt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalLoading}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  {modalLoading && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>Create Mailbox</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: RESET PASSWORD (MATCHING STITCH DESIGN)                            */}
      {/* ========================================================================= */}
      {selectedMailboxForReset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-sm bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4 page-content-scaled">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Reset Password</h3>
              <button
                onClick={() => setSelectedMailboxForReset(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Generate a new password for{' '}
              <span className="font-medium text-slate-800">
                {selectedMailboxForReset.address}
              </span>
              . Active sessions will be terminated immediately.
            </p>

            {resetModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-500" />
                <span>{resetModalError}</span>
              </div>
            )}

            <form onSubmit={handleResetPassword} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">New Password</label>
                  <button
                    type="button"
                    onClick={() => setNewMailboxPassword(generateStrongPassword())}
                    className="text-[11px] text-indigo-600 hover:text-indigo-700 hover:underline flex items-center gap-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Generate strong</span>
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    required
                    value={newMailboxPassword}
                    onChange={(e) => setNewMailboxPassword(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-600 focus:border-indigo-600"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyPassword(newMailboxPassword, 'reset-modal')}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1 transition-colors shrink-0 shadow-xs"
                    title="Copy password to clipboard"
                  >
                    {copiedPasswordKey === 'reset-modal' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                    )}
                    <span>{copiedPasswordKey === 'reset-modal' ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedMailboxForReset(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resetModalLoading}
                  className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  {resetModalLoading && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  <span>Update Password</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DELETE MAILBOX CONFIRMATION POPUP                                 */}
      {/* ========================================================================= */}
      {selectedMailboxForDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-mailbox-title"
          onClick={() => {
            if (!deleteModalLoading) {
              setSelectedMailboxForDelete(null);
              setDeleteConfirmEmail('');
              setDeleteModalError(null);
            }
          }}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 page-content-scaled"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                  <Trash2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="delete-mailbox-title" className="text-sm font-semibold text-slate-900">
                    Delete Mailbox
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Permanent deletion warning
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!deleteModalLoading) {
                    setSelectedMailboxForDelete(null);
                    setDeleteConfirmEmail('');
                    setDeleteModalError(null);
                  }
                }}
                disabled={deleteModalLoading}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Short and clear warning message */}
            <div className="p-3 bg-rose-50 border border-rose-200/80 rounded-xl text-xs text-rose-900 leading-relaxed">
              This action cannot be undone. All mailbox data will be permanently deleted.
            </div>

            {/* Confirmation input requiring exact email address */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (isDeleteConfirmed && !deleteModalLoading) {
                  handleConfirmDeleteMailbox();
                }
              }}
              className="flex flex-col gap-4"
            >
              <div className="flex flex-col gap-1.5">
                <label htmlFor="delete-confirm-email" className="text-xs text-slate-600 font-normal">
                  To confirm, type <strong className="text-slate-900 font-semibold select-all">{selectedMailboxForDelete.address}</strong> below:
                </label>
                <input
                  id="delete-confirm-email"
                  type="text"
                  value={deleteConfirmEmail}
                  onChange={(e) => setDeleteConfirmEmail(e.target.value)}
                  placeholder={selectedMailboxForDelete.address}
                  disabled={deleteModalLoading}
                  autoFocus
                  autoComplete="off"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500 font-medium text-slate-900 placeholder:text-slate-400 transition-colors"
                />
              </div>

              {deleteModalError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                  <span>{deleteModalError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedMailboxForDelete(null);
                    setDeleteConfirmEmail('');
                    setDeleteModalError(null);
                  }}
                  disabled={deleteModalLoading}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deleteModalLoading || !isDeleteConfirmed}
                  className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {deleteModalLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Mailbox</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: SUSPEND MAILBOX CONFIRMATION POPUP                                */}
      {/* ========================================================================= */}
      {selectedMailboxForSuspend && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="suspend-mailbox-title"
          onClick={() => {
            if (!suspendModalLoading) {
              setSelectedMailboxForSuspend(null);
              setSuspendModalError(null);
            }
          }}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 page-content-scaled"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                  <Ban className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="suspend-mailbox-title" className="text-sm font-semibold text-slate-900">
                    Suspend Mailbox
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Temporary access restriction
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!suspendModalLoading) {
                    setSelectedMailboxForSuspend(null);
                    setSuspendModalError(null);
                  }
                }}
                disabled={suspendModalLoading}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-xl text-xs text-slate-700 leading-relaxed space-y-1.5">
              <p>
                Are you sure you want to suspend{' '}
                <strong className="text-slate-900 font-semibold">{selectedMailboxForSuspend.address}</strong>?
              </p>
              <p className="text-amber-800 font-medium">
                The user will be immediately blocked from signing in to webmail and sending or receiving messages. Mailbox data and configurations will be preserved.
              </p>
            </div>

            {suspendModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                <span>{suspendModalError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setSelectedMailboxForSuspend(null);
                  setSuspendModalError(null);
                }}
                disabled={suspendModalLoading}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSuspendMailbox}
                disabled={suspendModalLoading}
                className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {suspendModalLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Suspending...</span>
                  </>
                ) : (
                  <>
                    <Ban className="w-3.5 h-3.5" />
                    <span>Suspend Mailbox</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: REACTIVATE MAILBOX CONFIRMATION POPUP                              */}
      {/* ========================================================================= */}
      {selectedMailboxForReactivate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reactivate-mailbox-title"
          onClick={() => {
            if (!reactivateModalLoading) {
              setSelectedMailboxForReactivate(null);
              setReactivateModalError(null);
            }
          }}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 page-content-scaled"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-600 shrink-0">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 id="reactivate-mailbox-title" className="text-sm font-semibold text-slate-900">
                    Reactivate Mailbox
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Restore active account access
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!reactivateModalLoading) {
                    setSelectedMailboxForReactivate(null);
                    setReactivateModalError(null);
                  }
                }}
                disabled={reactivateModalLoading}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-xl text-xs text-slate-700 leading-relaxed space-y-1.5">
              <p>
                Are you sure you want to reactivate{' '}
                <strong className="text-slate-900 font-semibold">{selectedMailboxForReactivate.address}</strong>?
              </p>
              <p className="text-emerald-800 font-medium">
                The user will regain immediate access to sign in to webmail and send or receive messages.
              </p>
            </div>

            {reactivateModalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                <span>{reactivateModalError}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => {
                  setSelectedMailboxForReactivate(null);
                  setReactivateModalError(null);
                }}
                disabled={reactivateModalLoading}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReactivateMailbox}
                disabled={reactivateModalLoading}
                className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              >
                {reactivateModalLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Reactivating...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Reactivate Mailbox</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: DOMAIN SETUP WIZARD (MULTI-DOMAIN & EMPLOYEE TIERS)                */}
      {/* ========================================================================= */}
      <DomainSetupModal
        isOpen={showDomainModal}
        onClose={() => setShowDomainModal(false)}
        onDomainAdded={handleDomainAdded}
      />

      {/* ========================================================================= */}
      {/* MODAL: DNS SETUP STATUS (RECORDS + MANUAL ZONE FILE)                      */}
      {/* ========================================================================= */}
      <DomainDnsStatusModal
        domain={activeDomain}
        isOpen={showDnsStatusModal}
        onClose={() => setShowDnsStatusModal(false)}
        onDomainUpdated={() => {
          loadTenantData(activeDomain?.id);
        }}
      />

      {/* ========================================================================= */}
      {/* MODAL: DOMAIN DELETION CONFIRMATION & REQUEST FLOW                         */}
      {/* ========================================================================= */}
      <DomainDeletionModal
        domain={activeDomain}
        isOpen={showDomainDeletionModal}
        onClose={() => setShowDomainDeletionModal(false)}
        onRequestSubmitted={() => {
          if (activeDomain) {
            loadDeletionRequest(activeDomain.id);
            loadTenantData();
          }
        }}
      />
    </div>
  );
};
