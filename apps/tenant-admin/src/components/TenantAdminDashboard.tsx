import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { TenantSummary, MailboxItem, AuditItem, UserContext } from '../types';

interface TenantAdminDashboardProps {
  user?: UserContext | null;
  onLogout?: () => void;
}

export const TenantAdminDashboard: React.FC<TenantAdminDashboardProps> = ({ user, onLogout }) => {
  const [tenant, setTenant] = useState<TenantSummary | null>(null);
  const [mailboxes, setMailboxes] = useState<MailboxItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditItem[]>([]);
  const [activeNav, setActiveNav] = useState<'dashboard' | 'mailboxes' | 'audit' | 'security'>('dashboard');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [loading, setLoading] = useState(true);

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

  // DNS copy feedback
  const [copiedRecordKey, setCopiedRecordKey] = useState<string | null>(null);

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

  const loadTenantData = async () => {
    try {
      const [tenantRes, mailboxesRes, auditRes] = await Promise.all([
        api.getTenantMe(),
        api.listMyMailboxes(),
        api.getAuditLogs({ limit: 50 }).catch(() => ({ logs: [] })),
      ]);
      setTenant(tenantRes.tenant);
      setMailboxes(mailboxesRes.mailboxes || []);
      setAuditLogs(auditRes.logs || []);
    } catch (err) {
      console.error('Failed to load tenant data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTenantData();
  }, []);

  const handleOpenCreateModal = () => {
    setLocalPart('');
    setPassword(generateStrongPassword());
    setModalError(null);
    setShowCreateModal(true);
  };

  const handleCreateMailbox = async (e: React.FormEvent) => {
    e.preventDefault();
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
      });
      setShowCreateModal(false);
      setLocalPart('');
      setPassword('');
      await loadTenantData();
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
      await loadTenantData();
    } catch (err: any) {
      setResetModalError(err.message || 'Failed to update mailbox password.');
    } finally {
      setResetModalLoading(false);
    }
  };

  const handleDeleteMailbox = async (mb: MailboxItem) => {
    if (!confirm(`Are you sure you want to permanently delete mailbox "${mb.address}"? All associated messages and data will be removed.`)) {
      return;
    }

    try {
      await api.deleteMailbox(mb.id);
      await loadTenantData();
    } catch (err: any) {
      alert(`Failed to delete mailbox: ${err.message}`);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedRecordKey(key);
    setTimeout(() => setCopiedRecordKey(null), 2000);
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

  const formatAuditAction = (action: string, metadata: any) => {
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

  const domainName = tenant?.domain?.domainName || 'domain.com';
  const mailboxCount = tenant?.mailboxCount || mailboxes.length || 0;
  const mailboxLimit = tenant?.mailboxLimit || 50;
  const usagePercent = Math.min(100, Math.round((mailboxCount / Math.max(1, mailboxLimit)) * 100));
  const availableCount = Math.max(0, mailboxLimit - mailboxCount);
  const isSuspended = tenant?.status === 'suspended';

  // Fallback admin email & initials
  const adminEmail = user?.email || (tenant ? `admin@${domainName}` : 'admin@toowix.com');
  const adminInitials = adminEmail ? adminEmail.slice(0, 2).toUpperCase() : 'AT';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <span className="material-symbols-outlined text-[32px] animate-spin text-[#1a73e8]">
            progress_activity
          </span>
          <span className="text-xs font-medium">Loading workspace...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f8fafc] font-body text-slate-900 antialiased selection:bg-blue-100 selection:text-blue-900">
      {/* ========================================================================= */}
      {/* TOP HEADER (MATCHING GOOGLE STITCH DESIGN)                                */}
      {/* ========================================================================= */}
      <header className="fixed top-0 inset-x-0 z-40 bg-white border-b border-slate-200 h-16">
        <div className="h-full px-6 flex items-center justify-between">
          {/* Brand & Tenant Context */}
          <div className="flex items-center gap-6">
            {/* Brand */}
            <div className="flex items-center gap-3 w-56">
              <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-white shadow-xs">
                <span className="material-symbols-outlined text-[19px]">mail</span>
              </div>
              <div className="flex flex-col">
                <span className="font-semibold text-slate-900 text-sm tracking-tight leading-tight">
                  TOOWIX MAIL
                </span>
                <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                  Tenant Console
                </span>
              </div>
            </div>

            <div className="h-5 w-px bg-slate-200 hidden md:block"></div>

            {/* Prominent Tenant Context */}
            <div className="hidden md:flex items-center gap-3">
              <span className="text-sm font-semibold text-slate-900">
                {tenant?.name || 'Acme Technologies'}
              </span>
              <span className="text-xs font-mono text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/80">
                {domainName}
              </span>
              {isSuspended ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-rose-700 font-medium">
                  <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                  Suspended
                </span>
              ) : tenant?.status === 'approved_pending_setup' ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 font-medium">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  Pending Activation
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 font-medium">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Active
                </span>
              )}
            </div>
          </div>

          {/* Right Utility Actions */}
          <div className="flex items-center gap-4">
            {/* Webmail external link */}
            <a
              href="http://localhost:8888"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              title="Open Webmail Client"
            >
              <span className="material-symbols-outlined text-[16px] text-[#1a73e8]">open_in_new</span>
              <span>Webmail</span>
            </a>

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
                  Tenant Administrator
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
                <span className="material-symbols-outlined text-[19px]">logout</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* SIDEBAR NAVIGATION RAIL                                                   */}
      {/* ========================================================================= */}
      <aside className="fixed left-0 top-16 bottom-0 w-60 bg-white border-r border-slate-200 z-30 flex flex-col justify-between p-4">
        <div className="flex flex-col gap-6">
          <nav className="flex flex-col gap-1">
            {/* Dashboard */}
            <button
              onClick={() => setActiveNav('dashboard')}
              className={`flex items-center justify-between px-3 py-2 text-xs font-semibold rounded-lg transition-colors text-left w-full ${
                activeNav === 'dashboard'
                  ? 'bg-blue-50 text-[#1a73e8]'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[18px]">dashboard</span>
                <span>Dashboard</span>
              </div>
            </button>

            {/* Mailboxes with dynamic Count Badge */}
            <button
              onClick={() => setActiveNav('mailboxes')}
              className={`flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors text-left w-full ${
                activeNav === 'mailboxes'
                  ? 'bg-blue-50 text-[#1a73e8] font-semibold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`material-symbols-outlined text-[18px] ${
                    activeNav === 'mailboxes' ? 'text-[#1a73e8]' : 'text-slate-400'
                  }`}
                >
                  mail
                </span>
                <span>Mailboxes</span>
              </div>
              <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200/60">
                {mailboxCount}
              </span>
            </button>

            {/* Audit Log */}
            <button
              onClick={() => setActiveNav('audit')}
              className={`flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors text-left w-full ${
                activeNav === 'audit'
                  ? 'bg-blue-50 text-[#1a73e8] font-semibold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`material-symbols-outlined text-[18px] ${
                    activeNav === 'audit' ? 'text-[#1a73e8]' : 'text-slate-400'
                  }`}
                >
                  receipt_long
                </span>
                <span>Audit Log</span>
              </div>
            </button>

            {/* Admin Security / Domain & DNS */}
            <button
              onClick={() => setActiveNav('security')}
              className={`flex items-center justify-between px-3 py-2 text-xs font-medium rounded-lg transition-colors text-left w-full ${
                activeNav === 'security'
                  ? 'bg-blue-50 text-[#1a73e8] font-semibold'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={`material-symbols-outlined text-[18px] ${
                    activeNav === 'security' ? 'text-[#1a73e8]' : 'text-slate-400'
                  }`}
                >
                  shield
                </span>
                <span>Admin Security</span>
              </div>
            </button>
          </nav>
        </div>

        {/* Sidebar Footer info */}
        <div className="pt-4 border-t border-slate-100 text-[11px] text-slate-400 flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span>Stalwart Mail Engine</span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          </div>
          <span className="font-mono text-[10px] text-slate-400">TLS 1.3 Strict Encrypted</span>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* MAIN VIEW CONTAINER                                                       */}
      {/* ========================================================================= */}
      <div className="pl-60 pt-16 min-h-screen bg-[#f8fafc]">
        <main className="max-w-6xl mx-auto px-10 py-10 flex flex-col gap-8">
          {/* Operational Banners */}
          {isSuspended && (
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3 text-rose-900">
              <span className="material-symbols-outlined text-rose-600 text-[20px] shrink-0 mt-0.5">
                warning
              </span>
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
              <span className="material-symbols-outlined text-amber-600 text-[20px] shrink-0 mt-0.5">
                info
              </span>
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

          {/* ===================================================================== */}
          {/* VIEW: DASHBOARD (MAIN SCREEN MATCHING STITCH DESIGN)                   */}
          {/* ===================================================================== */}
          {activeNav === 'dashboard' && (
            <>
              {/* TOP ACTION & CONTEXT BAR */}
              <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-2">
                <div className="flex flex-col gap-1">
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
                    Tenant Overview
                  </h1>
                  <p className="text-xs text-slate-500 font-normal">
                    Organization mail services for{' '}
                    <span className="font-mono text-slate-700">@{domainName}</span>
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    disabled={isSuspended || usagePercent >= 100}
                    onClick={handleOpenCreateModal}
                    className={`px-4 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-lg text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 ${
                      isSuspended || usagePercent >= 100 ? 'opacity-50 cursor-not-allowed' : ''
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    <span>Create mailbox</span>
                  </button>
                  <button
                    onClick={() => setActiveNav('mailboxes')}
                    className="px-3.5 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg text-xs font-medium transition-colors"
                  >
                    View mailboxes
                  </button>
                </div>
              </section>

              {/* 3-PART OVERVIEW GRID */}
              <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* Card 1: Mailbox Allocation */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between shadow-xs">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Mailbox Allocation
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-slate-400">
                      inventory_2
                    </span>
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
                            : 'bg-[#1a73e8]'
                        }`}
                        style={{ width: `${usagePercent}%` }}
                      ></div>
                    </div>
                    <span className="text-[11px] text-slate-500 mt-1">
                      {availableCount} Available for assignment
                    </span>
                  </div>
                </div>

                {/* Card 2: Operational Health */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between shadow-xs">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Operational Health
                    </span>
                    <span
                      className={`material-symbols-outlined text-[18px] ${
                        isSuspended ? 'text-rose-600' : 'text-emerald-600'
                      }`}
                    >
                      verified
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isSuspended ? 'bg-rose-500' : 'bg-emerald-500'
                        }`}
                      ></span>
                      <span className="text-2xl font-semibold text-slate-900">
                        {isSuspended ? 'Suspended' : 'Normal'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {isSuspended
                        ? 'Mail services suspended by platform control plane'
                        : 'No actions required — all services operational'}
                    </p>
                  </div>
                </div>

                {/* Card 3: Domain Summary */}
                <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between shadow-xs">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Domain Summary
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-slate-400">
                      dns
                    </span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-semibold font-mono text-slate-900 truncate">
                        {domainName}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-emerald-700 mt-1">
                      <span className="material-symbols-outlined text-[14px] text-emerald-600">
                        check_circle
                      </span>
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
                      <span className="material-symbols-outlined text-[18px] text-slate-400">
                        group
                      </span>
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Recently Added Mailboxes
                      </h2>
                    </div>
                    <button
                      onClick={() => setActiveNav('mailboxes')}
                      className="text-xs font-medium text-[#1a73e8] hover:underline flex items-center gap-1"
                    >
                      <span>View all mailboxes</span>
                      <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
                    </button>
                  </div>

                  {mailboxes.length === 0 ? (
                    <div className="py-8 text-center flex flex-col items-center gap-2 text-slate-400">
                      <span className="material-symbols-outlined text-[28px]">mark_email_unread</span>
                      <p className="text-xs">No mailboxes created yet.</p>
                      <button
                        onClick={handleOpenCreateModal}
                        className="text-xs font-medium text-[#1a73e8] hover:underline"
                      >
                        + Create your first mailbox
                      </button>
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
                            {/* Quick Reset action on hover */}
                            <button
                              onClick={() => handleOpenResetModal(mb)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-[#1a73e8] rounded transition-opacity"
                              title="Reset Password"
                            >
                              <span className="material-symbols-outlined text-[15px]">key</span>
                            </button>

                            <div className="flex items-center gap-1.5 text-xs text-slate-600">
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  mb.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'
                                }`}
                              ></span>
                              <span className="capitalize">{mb.status}</span>
                            </div>
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
                      <span className="material-symbols-outlined text-[18px] text-slate-400">
                        history
                      </span>
                      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Organization Event Log
                      </h2>
                    </div>
                    <button
                      onClick={() => setActiveNav('audit')}
                      className="text-xs font-medium text-[#1a73e8] hover:underline flex items-center gap-1"
                    >
                      <span>View audit log</span>
                      <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
                    </button>
                  </div>

                  {auditLogs.length === 0 ? (
                    <div className="py-8 text-center flex flex-col items-center gap-2 text-slate-400">
                      <span className="material-symbols-outlined text-[28px]">description</span>
                      <p className="text-xs">No recent events recorded.</p>
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

          {/* ===================================================================== */}
          {/* VIEW: FULL MAILBOXES TABLE                                            */}
          {/* ===================================================================== */}
          {activeNav === 'mailboxes' && (
            <section className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-semibold text-slate-900">Mailbox Management</h2>
                  <p className="text-xs text-slate-500">
                    Provision, maintain credentials, and manage mailbox accounts for @{domainName}
                  </p>
                </div>
                <button
                  disabled={isSuspended || usagePercent >= 100}
                  onClick={handleOpenCreateModal}
                  className={`px-4 py-2 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-lg text-xs font-medium shadow-xs transition-colors flex items-center gap-1.5 self-start sm:self-auto ${
                    isSuspended || usagePercent >= 100 ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  <span>Create mailbox</span>
                </button>
              </div>

              {/* Filter controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-[18px]">
                    search
                  </span>
                  <input
                    type="text"
                    placeholder="Search by address or username..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-9 pr-4 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-1 focus:ring-[#1a73e8] focus:border-[#1a73e8]"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500">Status:</span>
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-1 focus:ring-[#1a73e8]"
                  >
                    <option value="all">All statuses</option>
                    <option value="active">Active only</option>
                    <option value="suspended">Suspended only</option>
                  </select>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
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
                              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                mb.status === 'active'
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                  : 'bg-amber-50 text-amber-700 border border-amber-200/60'
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  mb.status === 'active' ? 'bg-emerald-500' : 'bg-amber-500'
                                }`}
                              ></span>
                              <span className="capitalize">{mb.status}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {new Date(mb.createdAt).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              <a
                                href="http://localhost:8888"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2 py-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                                title="Open in Webmail"
                              >
                                Webmail
                              </a>
                              <button
                                onClick={() => handleOpenResetModal(mb)}
                                className="px-2 py-1 text-slate-600 hover:text-[#1a73e8] hover:bg-slate-100 rounded transition-colors"
                                title="Reset Password"
                              >
                                Reset Password
                              </button>
                              <button
                                onClick={() => handleDeleteMailbox(mb)}
                                className="px-2 py-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                                title="Delete Mailbox"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ===================================================================== */}
          {/* VIEW: FULL AUDIT LOG                                                  */}
          {/* ===================================================================== */}
          {activeNav === 'audit' && (
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
                          <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-900">
                            {formatAuditAction(log.action, log.metadata)}
                          </td>
                          <td className="px-4 py-3 font-mono text-[11px] text-slate-600">
                            {log.resource}
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                log.success
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-rose-50 text-rose-700'
                              }`}
                            >
                              {log.success ? 'Success' : 'Failed'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {log.actor_role}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* ===================================================================== */}
          {/* VIEW: ADMIN SECURITY & DOMAIN DNS RECORDS                             */}
          {/* ===================================================================== */}
          {activeNav === 'security' && (
            <section className="flex flex-col gap-6">
              {/* Domain Health Card */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[19px] text-[#1a73e8]">
                      dns
                    </span>
                    <h2 className="text-sm font-semibold text-slate-900">
                      Authoritative Domain Verification
                    </h2>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                    Verified & Active
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/60">
                    <span className="text-slate-400 block text-[11px]">Assigned Domain</span>
                    <span className="font-mono font-semibold text-slate-900 text-sm mt-0.5 block">
                      {domainName}
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/60">
                    <span className="text-slate-400 block text-[11px]">Transport Security</span>
                    <span className="font-semibold text-slate-900 text-sm mt-0.5 block flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-emerald-600">
                        lock
                      </span>
                      TLS 1.3 Strict
                    </span>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200/60">
                    <span className="text-slate-400 block text-[11px]">Mail Engine Core</span>
                    <span className="font-semibold text-slate-900 text-sm mt-0.5 block">
                      Stalwart Enterprise Node
                    </span>
                  </div>
                </div>
              </div>

              {/* Recommended DNS Records */}
              <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-xs flex flex-col gap-4">
                <div className="flex flex-col gap-1 pb-3 border-b border-slate-100">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Public DNS Zone Configuration Records
                  </h3>
                  <p className="text-xs text-slate-500">
                    Publish these records with your DNS registrar (Cloudflare, Route 53, GoDaddy) to ensure optimal email deliverability and avoid spam classification.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  {[
                    {
                      type: 'MX',
                      name: '@',
                      target: `mail.${domainName}`,
                      priority: '10',
                      desc: 'Primary Mail Routing Exchange',
                      key: 'mx',
                    },
                    {
                      type: 'TXT (SPF)',
                      name: '@',
                      target: 'v=spf1 mx include:relay.toowix.net ~all',
                      priority: 'TTL 3600',
                      desc: 'Sender Policy Framework record',
                      key: 'spf',
                    },
                    {
                      type: 'TXT (DKIM)',
                      name: `mail._domainkey.${domainName}`,
                      target: 'v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ...',
                      priority: 'TTL 3600',
                      desc: 'DomainKeys Identified Mail Signature',
                      key: 'dkim',
                    },
                    {
                      type: 'TXT (DMARC)',
                      name: '_dmarc',
                      target: `v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@${domainName}`,
                      priority: 'TTL 3600',
                      desc: 'Domain-based Message Authentication Reporting',
                      key: 'dmarc',
                    },
                  ].map((rec) => (
                    <div
                      key={rec.key}
                      className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded font-mono font-bold bg-blue-100 text-blue-800 text-[11px]">
                            {rec.type}
                          </span>
                          <span className="font-mono text-slate-700 font-semibold">{rec.name}</span>
                          <span className="text-slate-400">• {rec.desc}</span>
                        </div>
                        <span className="font-mono text-[11px] text-slate-600 truncate bg-white px-2 py-1 rounded border border-slate-200 mt-1">
                          {rec.target}
                        </span>
                      </div>

                      <button
                        onClick={() => copyToClipboard(rec.target, rec.key)}
                        className="self-start md:self-auto px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 font-medium transition-colors flex items-center gap-1.5 shrink-0"
                      >
                        <span className="material-symbols-outlined text-[14px]">
                          {copiedRecordKey === rec.key ? 'done' : 'content_copy'}
                        </span>
                        <span>{copiedRecordKey === rec.key ? 'Copied' : 'Copy value'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </main>
      </div>

      {/* ========================================================================= */}
      {/* MODAL: CREATE MAILBOX (MATCHING STITCH DESIGN)                             */}
      {/* ========================================================================= */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-[1px] p-4">
          <div className="w-full max-w-md bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Create New Mailbox</h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            {modalError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
                <span className="material-symbols-outlined text-[16px] text-rose-500">error</span>
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
                    className="flex-1 px-3 py-1.5 text-xs rounded-l-lg border border-r-0 border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1a73e8] focus:border-[#1a73e8]"
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
                    className="text-[11px] text-[#1a73e8] hover:underline flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[13px]">refresh</span>
                    <span>Generate strong</span>
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1a73e8] focus:border-[#1a73e8]"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyPassword(password, 'create-modal')}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1 transition-colors shrink-0 shadow-xs"
                    title="Copy password to clipboard"
                  >
                    <span
                      className={`material-symbols-outlined text-[15px] ${
                        copiedPasswordKey === 'create-modal' ? 'text-emerald-600' : 'text-slate-500'
                      }`}
                    >
                      {copiedPasswordKey === 'create-modal' ? 'done' : 'content_copy'}
                    </span>
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
                  className="px-3.5 py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5"
                >
                  {modalLoading && (
                    <span className="material-symbols-outlined text-[14px] animate-spin">
                      progress_activity
                    </span>
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
          <div className="w-full max-w-sm bg-white rounded-xl shadow-xl border border-slate-200 p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Reset Password</h3>
              <button
                onClick={() => setSelectedMailboxForReset(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
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
                <span className="material-symbols-outlined text-[16px] text-rose-500">error</span>
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
                    className="text-[11px] text-[#1a73e8] hover:underline flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[13px]">refresh</span>
                    <span>Generate strong</span>
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    required
                    value={newMailboxPassword}
                    onChange={(e) => setNewMailboxPassword(e.target.value)}
                    className="flex-1 px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1a73e8]"
                  />
                  <button
                    type="button"
                    onClick={() => handleCopyPassword(newMailboxPassword, 'reset-modal')}
                    className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium flex items-center gap-1 transition-colors shrink-0 shadow-xs"
                    title="Copy password to clipboard"
                  >
                    <span
                      className={`material-symbols-outlined text-[15px] ${
                        copiedPasswordKey === 'reset-modal' ? 'text-emerald-600' : 'text-slate-500'
                      }`}
                    >
                      {copiedPasswordKey === 'reset-modal' ? 'done' : 'content_copy'}
                    </span>
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
                  className="px-3.5 py-1.5 bg-[#1a73e8] hover:bg-[#1557b0] text-white rounded-lg text-xs font-medium flex items-center gap-1.5"
                >
                  {resetModalLoading && (
                    <span className="material-symbols-outlined text-[14px] animate-spin">
                      progress_activity
                    </span>
                  )}
                  <span>Update Password</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
