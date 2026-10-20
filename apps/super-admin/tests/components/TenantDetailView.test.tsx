import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TenantDetailView } from '../../src/components/views/TenantDetailView';
import { api } from '../../src/api';
import { TenantFullDetails } from '../../src/types';

const mockTenantDetails: TenantFullDetails = {
  tenant: {
    id: 'tenant-123456789012345678901234',
    name: 'Wayne Enterprises',
    status: 'active',
    mailboxLimit: 20,
    mailboxCount: 5,
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-02-01T12:00:00.000Z',
  },
  domains: [
    {
      id: 'domain-1',
      domainName: 'waynecorp.com',
      stalwartDomainId: 'dom-wayne',
      status: 'active',
      isPrimary: true,
      mailboxLimit: 15,
      employeeCount: 15,
      dnsStatus: 'active',
      planId: null,
      planName: null,
      createdAt: '2026-01-15T10:00:00.000Z',
    },
    {
      id: 'domain-2',
      domainName: 'wayne-tech.test',
      stalwartDomainId: 'dom-waynetech',
      status: 'active',
      isPrimary: false,
      mailboxLimit: 5,
      employeeCount: 5,
      dnsStatus: 'conflict',
      planId: null,
      planName: null,
      createdAt: '2026-01-20T10:00:00.000Z',
    },
  ],
  admins: [
    {
      id: 'admin-1',
      email: 'bruce@waynecorp.com',
      role: 'TENANT_ADMIN',
      status: 'active',
      twoFactorEnabled: true,
      createdAt: '2026-01-15T10:00:00.000Z',
    },
    {
      id: 'mod-1',
      email: 'alfred@waynecorp.com',
      role: 'TENANT_MODERATOR',
      status: 'active',
      twoFactorEnabled: false,
      createdAt: '2026-01-16T10:00:00.000Z',
    },
  ],
  mailboxes: [
    {
      id: 'mb-1',
      address: 'bruce@waynecorp.com',
      localPart: 'bruce',
      domainId: 'domain-1',
      domainName: 'waynecorp.com',
      status: 'active',
      storageBytes: 10485760, // 10 MB
      createdAt: '2026-01-16T10:00:00.000Z',
    },
    {
      id: 'mb-2',
      address: 'alfred@waynecorp.com',
      localPart: 'alfred',
      domainId: 'domain-1',
      domainName: 'waynecorp.com',
      status: 'active',
      storageBytes: 5242880, // 5 MB
      createdAt: '2026-01-16T11:00:00.000Z',
    },
  ],
  auditLogs: [
    {
      id: 'log-1',
      action: 'MAILBOX_CREATE',
      actorEmail: 'bruce@waynecorp.com',
      actorRole: 'TENANT_ADMIN',
      actorIp: '192.168.1.1',
      resource: 'mailbox',
      resourceId: 'mb-1',
      status: 'success',
      timestamp: '2026-01-16T10:00:00.000Z',
    },
  ],
  stats: {
    totalDomains: 2,
    activeDomains: 1,
    totalMailboxes: 2,
    activeMailboxes: 2,
    suspendedMailboxes: 0,
    totalStorageBytes: 15728640,
    mailboxLimit: 20,
    usagePercent: 10,
  },
};

describe('TenantDetailView Component in Super Admin', () => {
  const defaultProps = {
    tenantId: 'tenant-123456789012345678901234',
    onBack: vi.fn(),
    onTenantUpdated: vi.fn(),
    onShowAlert: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(api, 'getTenantDetails').mockResolvedValue(mockTenantDetails);
    vi.spyOn(api, 'updateMailboxLimit').mockResolvedValue(mockTenantDetails.tenant as any);
    vi.spyOn(api, 'suspendTenant').mockResolvedValue(mockTenantDetails.tenant as any);
    vi.spyOn(api, 'getOrganisationDeletion').mockResolvedValue({
      deletion: null,
      timings: { suspensionDays: 7, otpWaitHours: 24, finalOtpMinutes: 10 },
    });
    vi.spyOn(api, 'reactivateTenant').mockResolvedValue(mockTenantDetails.tenant as any);
    vi.spyOn(api, 'resetTenantAdminPassword').mockResolvedValue({ success: true, message: 'Password reset' } as any);
  });

  it('renders tenant identity, KPI cards, and domains table', async () => {
    render(<TenantDetailView {...defaultProps} />);

    // Initially loads
    expect(screen.getByText(/loading tenant details/i)).toBeInTheDocument();

    // Resolves and displays tenant header
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Wayne Enterprises' })).toBeInTheDocument();
    });

    // Tenant identity details
    expect(screen.getByText(/tenant-123456789012345678901234/)).toBeInTheDocument();
    expect(screen.getAllByText('Active')[0]).toBeInTheDocument();

    // KPI cards
    expect(screen.getAllByText('Configured Domains')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Mailbox Allocation')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Administrators')[0]).toBeInTheDocument();
    expect(screen.getByText('Storage Consumed')).toBeInTheDocument();

    // Domains table lives under its own tab (default landing tab is now Overview)
    fireEvent.click(screen.getByRole('button', { name: /^domains/i }));
    expect(screen.getAllByText('waynecorp.com')[0]).toBeInTheDocument();
    expect(screen.getAllByText('wayne-tech.test')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Primary')[0]).toBeInTheDocument();
  });

  it('calls onBack when clicking "Back to Tenants"', async () => {
    render(<TenantDetailView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Wayne Enterprises' })).toBeInTheDocument();
    });

    const backBtn = screen.getByRole('button', { name: /back to tenants/i });
    fireEvent.click(backBtn);
    expect(defaultProps.onBack).toHaveBeenCalledTimes(1);
  });

  it('navigates through sub-tabs (Mailboxes, Admins, Audit Trail, Governance)', async () => {
    render(<TenantDetailView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Wayne Enterprises' })).toBeInTheDocument();
    });

    // 1. Mailboxes tab
    const mailboxesTab = screen.getByRole('button', { name: /^mailboxes/i });
    fireEvent.click(mailboxesTab);
    expect(screen.getByText('Provisioned Mailboxes')).toBeInTheDocument();
    expect(screen.getAllByText('bruce@waynecorp.com')[0]).toBeInTheDocument();
    expect(screen.getAllByText('alfred@waynecorp.com')[0]).toBeInTheDocument();

    // 2. Admins tab
    const adminsTab = screen.getByRole('button', { name: /^admins/i });
    fireEvent.click(adminsTab);
    expect(screen.getByText('Tenant Administrators')).toBeInTheDocument();
    expect(screen.getAllByText('2FA Protected')[0]).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /reset password/i })[0]).toBeInTheDocument();

    // 3. Audit tab
    const auditTab = screen.getByRole('button', { name: /^audit log/i });
    fireEvent.click(auditTab);
    expect(screen.getByText('Tenant Audit History')).toBeInTheDocument();
    expect(screen.getAllByText('MAILBOX_CREATE')[0]).toBeInTheDocument();

    // 4. Governance tab
    const govTab = screen.getByRole('button', { name: /^governance/i });
    fireEvent.click(govTab);
    expect(screen.getByText('Mailbox Quota Limit')).toBeInTheDocument();
    expect(screen.getByText('Organization Access & Lifecycle')).toBeInTheDocument();
    // The secure, timeline-driven flow is the primary path; the immediate delete is an explicit emergency bypass.
    expect(await screen.findByText(/^Delete organisation$/)).toBeInTheDocument();
    expect(screen.getByText('Emergency immediate delete')).toBeInTheDocument();
  });

  it('allows inline administrator password reset', async () => {
    render(<TenantDetailView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Wayne Enterprises' })).toBeInTheDocument();
    });

    const adminsTab = screen.getByRole('button', { name: /^admins/i });
    fireEvent.click(adminsTab);

    // Click reset password
    const resetBtn = screen.getAllByRole('button', { name: /reset password/i })[0];
    fireEvent.click(resetBtn);

    const passwordInput = screen.getByPlaceholderText(/enter new password/i);
    await userEvent.type(passwordInput, 'NewSecurePassword123!');

    const saveBtn = screen.getByRole('button', { name: /save password/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.resetTenantAdminPassword).toHaveBeenCalledWith(
        'tenant-123456789012345678901234',
        'admin-1',
        'NewSecurePassword123!'
      );
    });
  });

  it('hides Reset Password for a Moderator row — that account is managed by the Tenant Admin, not Super Admin', async () => {
    render(<TenantDetailView {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Wayne Enterprises' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^admins/i }));

    await waitFor(() => expect(screen.getAllByText('alfred@waynecorp.com')[0]).toBeInTheDocument());

    // Reset Password buttons exist for the Tenant Admin row (desktop & mobile) but NOT for Moderator row.
    expect(screen.getAllByRole('button', { name: /reset password/i })).toHaveLength(2);
    expect(screen.getAllByText('Managed by Tenant Admin')[0]).toBeInTheDocument();
  });

  it('notifies onSubTabChange when subtab is clicked', async () => {
    const onSubTabChange = vi.fn();
    render(<TenantDetailView {...defaultProps} onSubTabChange={onSubTabChange} />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Wayne Enterprises' })).toBeInTheDocument();
    });

    const mailboxesTab = screen.getByRole('button', { name: /^mailboxes/i });
    fireEvent.click(mailboxesTab);

    expect(onSubTabChange).toHaveBeenCalledWith('mailboxes');
  });

  it('renders with controlled activeSubTab prop directly', async () => {
    render(<TenantDetailView {...defaultProps} activeSubTab="admins" />);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Wayne Enterprises' })).toBeInTheDocument();
    });

    expect(screen.getAllByText('bruce@waynecorp.com')[0]).toBeInTheDocument();
    expect(screen.getAllByText('alfred@waynecorp.com')[0]).toBeInTheDocument();
  });

  describe('Billing tab', () => {
    const billing: NonNullable<TenantFullDetails['billing']> = {
      hasSubscription: true,
      status: 'grace',
      currentPeriodEnd: '2026-11-30T12:00:00.000Z',
      trialEnd: '2026-10-01T12:00:00.000Z',
      trialStartedAt: '2026-08-02T12:00:00.000Z',
      cancelAtPeriodEnd: true,
      gracePeriodEndsAt: '2026-11-04T12:00:00.000Z',
      totalMonthlyPaise: 50000,
      domains: [
        {
          domainId: 'domain-1', domainName: 'waynecorp.com', planName: 'Business', seatCount: 15, activeUserCount: 5, maxUsers: 15,
          pricePerUserMonthlyPaise: 10000, monthlySubtotalPaise: 50000, cancelled: false,
          pendingDowngrade: { planId: 'plan-starter', planName: 'Starter', effectiveAt: '2026-11-30T12:00:00.000Z' },
        },
        {
          domainId: 'domain-2', domainName: 'wayne-tech.test', planName: 'Business', seatCount: 5, activeUserCount: 0, maxUsers: 5,
          pricePerUserMonthlyPaise: 10000, monthlySubtotalPaise: 0, cancelled: true, pendingDowngrade: null,
        },
      ],
    };

    it('shows Trial end, period end, cancel at period end with its date, and the Grace Period end', async () => {
      vi.spyOn(api, 'getTenantDetails').mockResolvedValue({ ...mockTenantDetails, billing });
      render(<TenantDetailView {...defaultProps} activeSubTab="billing" />);

      expect(await screen.findByText('Trial ends')).toBeInTheDocument();
      expect(screen.getByText('1 Oct 2026')).toBeInTheDocument();
      expect(screen.getByText('Current period ends')).toBeInTheDocument();
      expect(screen.getByText('Cancels on 30 Nov 2026')).toBeInTheDocument();
      expect(screen.getByText('Grace Period ends')).toBeInTheDocument();
      expect(screen.getByText('4 Nov 2026')).toBeInTheDocument();
    });

    it("shows each domain's pending downgrade and whether it was cancelled on its own", async () => {
      vi.spyOn(api, 'getTenantDetails').mockResolvedValue({ ...mockTenantDetails, billing });
      render(<TenantDetailView {...defaultProps} activeSubTab="billing" />);

      expect(await screen.findByText('Moves to Starter on 30 Nov 2026')).toBeInTheDocument();
      expect(screen.getByText('Cancelled')).toBeInTheDocument();
    });

    it('hides the Grace Period end when none is open and says when the subscription renews', async () => {
      vi.spyOn(api, 'getTenantDetails').mockResolvedValue({
        ...mockTenantDetails,
        billing: { ...billing, status: 'active', cancelAtPeriodEnd: false, gracePeriodEndsAt: null },
      });
      render(<TenantDetailView {...defaultProps} activeSubTab="billing" />);

      expect(await screen.findByText('Current period ends')).toBeInTheDocument();
      expect(screen.getByText('No, renews')).toBeInTheDocument();
      expect(screen.queryByText('Grace Period ends')).not.toBeInTheDocument();
    });

    it('still renders the detail page, with Sync with Stripe, when billing is null', async () => {
      vi.spyOn(api, 'getTenantDetails').mockResolvedValue({ ...mockTenantDetails, billing: null });
      render(<TenantDetailView {...defaultProps} activeSubTab="billing" />);

      expect(await screen.findByText('No billing data for this tenant yet.')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sync with stripe/i })).toBeInTheDocument();
      expect(screen.queryByText('Trial ends')).not.toBeInTheDocument();
    });
  });
});
