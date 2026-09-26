import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TenantAdminDashboard } from '../../src/components/TenantAdminDashboard';
import { api } from '../../src/api';
import { UserContext } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getTenantMe: vi.fn(),
    listMyMailboxes: vi.fn(),
    getAuditLogs: vi.fn(),
    createMailbox: vi.fn(),
    resetMailboxPassword: vi.fn(),
    suspendMailbox: vi.fn(),
    reactivateMailbox: vi.fn(),
    deleteMailbox: vi.fn(),
    migrateMailbox: vi.fn(),
    migrateMailboxAndDelete: vi.fn(),
    getMigrationJobStatus: vi.fn(),
    listTenantDomains: vi.fn(),
    createTenantDomain: vi.fn(),
    deleteDomain: vi.fn(),
    listPlans: vi.fn().mockResolvedValue({ plans: [] }),
    getDomainDnsStatus: vi.fn().mockResolvedValue({
      dnsStatus: 'active',
      dnsRecords: [],
      dnsConflicts: [],
      dnsZoneFile: '; Authoritative Zone file for acmecorp.com\nacmecorp.com. IN MX 10 mail.acmecorp.com.\n',
    }),
    getSecuritySettings: vi.fn(),
    getBlockedIps: vi.fn().mockResolvedValue({ list: [] }),
    getAllowedIps: vi.fn().mockResolvedValue({ list: [] }),
    checkIpStatus: vi.fn().mockResolvedValue({ isBlocked: false, isAllowed: false }),
    getStorageUsage: vi.fn().mockResolvedValue({
      summary: { totalStorageBytes: 1048576, totalStorageFormatted: '1.0 MB', mailboxCount: 1, mailboxesWithData: 1 },
      mailboxes: [
        { id: 'mb-1', address: 'user@acmecorp.com', localPart: 'user', domainId: 'dom-1', domainName: 'acmecorp.com', storageBytes: 1048576, storageFormatted: '1.0 MB', percentage: 100, status: 'active', createdAt: '2026-09-01T00:00:00Z' }
      ]
    }),
    listModerators: vi.fn().mockResolvedValue({ moderators: [] }),
    getTenantBillingSummary: vi.fn().mockResolvedValue({
      hasSubscription: true,
      status: 'active',
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      domains: [],
    }),
    getDomainBillingStatus: vi.fn().mockResolvedValue({
      domainId: 'dom-1',
      domainName: 'acmecorp.com',
      subscription: { status: 'active', planId: 'plan-1', cancelAtPeriodEnd: false },
    }),
    getCart: vi.fn().mockResolvedValue({
      trial: { started: true, startedAt: '2026-09-01T00:00:00.000Z', endsAt: '2026-10-31T00:00:00.000Z', daysRemaining: 40, isTrialing: true },
      hasPaymentMethod: true,
      paymentMethod: { brand: 'visa', last4: '4242' },
      requiresActivation: false,
      pendingMailboxes: [],
      domains: [],
      estimatedMonthlyPaise: 0,
      previousEstimatedMonthlyPaise: 0,
      dueTodayPaise: 0,
      recentChanges: [],
    }),
    activateCart: vi.fn(),
  },
  clearStoredToken: vi.fn(),
}));

const mockUser: UserContext = {
  id: 'tenant-user-1',
  email: 'admin@acmecorp.com',
  role: 'TENANT_ADMIN',
  tenantId: 'tenant-123',
};

describe('TenantAdminDashboard Component', () => {
  const onLogout = vi.fn();
  const onNavigateHome = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTenantMe).mockResolvedValue({
      tenant: {
        id: 'tenant-123',
        name: 'Acme Corporation',
        status: 'active',
        mailboxLimit: 50,
        mailboxCount: 2,
        availableMailboxes: 48,
        adminCount: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        domain: {
          id: 'dom-1',
          domainName: 'acmecorp.com',
          status: 'active',
        },
      },
    });

    vi.mocked(api.listMyMailboxes).mockResolvedValue({
      mailboxes: [
        {
          id: 'mb-1',
          tenantId: 'tenant-123',
          domainId: 'dom-1',
          localPart: 'alice',
          address: 'alice@acmecorp.com',
          stalwartAccountId: 'acc-alice',
          status: 'active',
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
        {
          id: 'mb-2',
          tenantId: 'tenant-123',
          domainId: 'dom-1',
          localPart: 'bob',
          address: 'bob@acmecorp.com',
          stalwartAccountId: 'acc-bob',
          status: 'active',
          createdAt: '2026-01-03T00:00:00.000Z',
          updatedAt: '2026-01-03T00:00:00.000Z',
        },
      ],
    });

    vi.mocked(api.listTenantDomains).mockResolvedValue({
      domains: [
        {
          id: 'dom-1',
          domainName: 'acmecorp.com',
          status: 'active',
          dnsStatus: 'active',
          mailboxLimit: 50,
          employeeCount: 50,
          mailboxCount: 2,
          isPrimary: true,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    vi.mocked(api.getAuditLogs).mockResolvedValue({ logs: [], limit: 50, offset: 0 });
    vi.mocked(api.getSecuritySettings).mockResolvedValue({
      email: 'admin@acmecorp.com',
      recoveryEmail: null,
      twoFactorEnabled: false,
      twoFactorMethod: null,
      remainingBackupCodes: 0,
    } as any);
    sessionStorage.clear();
  });

  const renderDashboard = (props: Partial<React.ComponentProps<typeof TenantAdminDashboard>> = {}) =>
    render(
      <TenantAdminDashboard
        domainId="dom-1"
        user={mockUser}
        onLogout={onLogout}
        onNavigateHome={onNavigateHome}
        {...props}
      />
    );

  it('renders tenant overview with domain, quota stats, and mailbox count', async () => {
    renderDashboard();

    expect(await screen.findByText('Admin Overview')).toBeInTheDocument();
    expect(screen.getAllByText(/@acmecorp\.com/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Domain Summary')).toBeInTheDocument();
    expect(screen.queryByText('Operational Health')).not.toBeInTheDocument();
  });

  it('displays suspended banner when tenant status is suspended', async () => {
    vi.mocked(api.getTenantMe).mockResolvedValueOnce({
      tenant: {
        id: 'tenant-123',
        name: 'Acme Corporation',
        status: 'suspended',
        mailboxLimit: 50,
        mailboxCount: 2,
        availableMailboxes: 48,
        adminCount: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        domain: {
          id: 'dom-1',
          domainName: 'acmecorp.com',
          status: 'suspended',
        },
      },
    });

    renderDashboard();

    expect(
      await screen.findByText(/Workspace Suspended by Platform Administrators/i)
    ).toBeInTheDocument();
  });

  it('opens Create Mailbox modal and provisions mailbox successfully', async () => {
    vi.mocked(api.createMailbox).mockResolvedValueOnce({
      id: 'mb-3',
      tenantId: 'tenant-123',
      domainId: 'dom-1',
      localPart: 'charlie',
      address: 'charlie@acmecorp.com',
      stalwartAccountId: 'acc-charlie',
      status: 'active',
      createdAt: '2026-01-04T00:00:00.000Z',
      updatedAt: '2026-01-04T00:00:00.000Z',
    });

    renderDashboard();
    await screen.findByText('Admin Overview');

    const createBtn = screen.getByRole('button', { name: /create mailbox/i });
    fireEvent.click(createBtn);

    // Modal appears
    expect(await screen.findByText('Create New Mailbox')).toBeInTheDocument();

    const usernameInput = screen.getByPlaceholderText('username');
    await userEvent.type(usernameInput, 'charlie');

    // Click submit in modal
    const submitBtn = screen.getAllByRole('button', { name: /create mailbox/i })[1];
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.createMailbox).toHaveBeenCalledWith(
        expect.objectContaining({
          localPart: 'charlie',
        })
      );
    });
  });

  it('a mailbox created before payment is confirmed is held: toast says so, and it shows up in the cart banner', async () => {
    const pendingCart = {
      trial: { started: false, startedAt: null, endsAt: null, daysRemaining: 0, isTrialing: false },
      hasPaymentMethod: false,
      paymentMethod: null,
      requiresActivation: true,
      pendingMailboxes: [
        { id: 'mb-9', address: 'dana@acmecorp.com', domainId: 'dom-1', domainName: 'acmecorp.com', planName: 'Starter', ratePaise: 10000, createdAt: '2026-09-24T00:00:00.000Z' },
      ],
      domains: [],
      estimatedMonthlyPaise: 10000,
      previousEstimatedMonthlyPaise: 0,
      dueTodayPaise: 0,
      recentChanges: [],
    };
    vi.mocked(api.getCart).mockResolvedValue(pendingCart as any);
    vi.mocked(api.createMailbox).mockResolvedValueOnce({
      id: 'mb-9',
      tenantId: 'tenant-123',
      domainId: 'dom-1',
      localPart: 'dana',
      address: 'dana@acmecorp.com',
      stalwartAccountId: 'acc-dana',
      status: 'suspended',
      billingHold: true,
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
    });

    renderDashboard();
    await screen.findByText('Admin Overview');

    // Banner + cart badge point at the waiting mailbox.
    expect(await screen.findByText(/1 mailbox waiting for activation/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: /create mailbox/i })[0]);
    await userEvent.type(await screen.findByPlaceholderText('username'), 'dana');
    fireEvent.click(screen.getAllByRole('button', { name: /create mailbox/i })[1]);

    expect(await screen.findByText(/stays suspended until you activate it from the Cart/i)).toBeInTheDocument();
    // Creating never takes you to the cart by itself.
    expect(window.location.pathname).not.toBe('/cart');

    // The cart is its own page — the button navigates there.
    fireEvent.click(screen.getAllByRole('button', { name: /^cart/i })[0]);
    expect(window.location.pathname).toBe('/cart');
  });

  it('displays quota exceeded error when mailbox limit reached', async () => {
    vi.mocked(api.createMailbox).mockRejectedValueOnce(
      new Error('Mailbox limit of 50 reached for tenant')
    );

    renderDashboard();
    await screen.findByText('Admin Overview');

    const createBtn = screen.getByRole('button', { name: /create mailbox/i });
    fireEvent.click(createBtn);

    expect(await screen.findByText('Create New Mailbox')).toBeInTheDocument();

    const usernameInput = screen.getByPlaceholderText('username');
    await userEvent.type(usernameInput, 'user51');

    const submitBtn = screen.getAllByRole('button', { name: /create mailbox/i })[1];
    fireEvent.click(submitBtn);

    expect(
      await screen.findByText(/Mailbox limit of 50 reached for tenant/i)
    ).toBeInTheDocument();
  });

  it('opens confirmation popup before deleting mailbox and executes deletion upon confirmation', async () => {
    vi.mocked(api.deleteMailbox).mockResolvedValueOnce({ success: true });

    renderDashboard();
    await screen.findByText('Admin Overview');

    // Switch to Mailboxes tab
    const mailboxesTab = screen.getByText('View all mailboxes');
    fireEvent.click(mailboxesTab);

    // Find three-dots actions button for alice@acmecorp.com
    const actionButtons = await screen.findAllByRole('button', { name: /mailbox actions/i });
    expect(actionButtons.length).toBeGreaterThan(0);

    // Open three-dots menu
    fireEvent.click(actionButtons[0]);

    // Click delete mailbox in dropdown
    const deleteBtn = await screen.findByRole('button', { name: /delete mailbox/i });
    fireEvent.click(deleteBtn);

    // Delete confirmation popup should appear
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /delete mailbox/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/alice@acmecorp\.com/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/permanent deletion warning/i)).toBeInTheDocument();

    // Test cancel
    const cancelBtn = within(dialog).getByRole('button', { name: /^cancel$/i });
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.deleteMailbox).not.toHaveBeenCalled();

    // Click actions and delete again to confirm
    fireEvent.click(actionButtons[0]);
    const deleteBtnAgain = await screen.findByRole('button', { name: /delete mailbox/i });
    fireEvent.click(deleteBtnAgain);

    const dialogAgain = await screen.findByRole('dialog');
    expect(dialogAgain).toBeInTheDocument();

    const confirmDeleteBtn = within(dialogAgain).getByRole('button', { name: /delete mailbox/i });
    expect(confirmDeleteBtn).toBeDisabled();

    // Type incorrect email - should still be disabled
    const confirmInput = within(dialogAgain).getByPlaceholderText('alice@acmecorp.com');
    fireEvent.change(confirmInput, { target: { value: 'wrong@acmecorp.com' } });
    expect(confirmDeleteBtn).toBeDisabled();

    // Type exact matching email address
    fireEvent.change(confirmInput, { target: { value: 'alice@acmecorp.com' } });
    expect(confirmDeleteBtn).not.toBeDisabled();

    fireEvent.click(confirmDeleteBtn);

    await waitFor(() => {
      expect(api.deleteMailbox).toHaveBeenCalledWith('mb-1');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('starts a safe migration first and only presents delete option after strict verification', async () => {
    vi.mocked(api.migrateMailbox).mockResolvedValueOnce({ jobId: 'job-1' });
    vi.mocked(api.getMigrationJobStatus).mockReturnValue(new Promise(() => {}));

    renderDashboard();
    await screen.findByText('Admin Overview');
    fireEvent.click(screen.getByText('View all mailboxes'));

    const actionButtons = await screen.findAllByRole('button', { name: /mailbox actions/i });
    fireEvent.click(actionButtons[0]);
    const deleteBtn = await screen.findByRole('button', { name: /delete mailbox/i });
    fireEvent.click(deleteBtn);

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('checkbox'));

    const destSelect = await within(dialog).findByLabelText(/move all mail into/i);
    await waitFor(() => expect(within(destSelect).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(destSelect, { target: { value: 'mb-2' } });

    // In stage 1, there is NO combined "Migrate & Delete" button!
    expect(within(dialog).queryByRole('button', { name: /migrate & delete/i })).not.toBeInTheDocument();

    const startBtn = within(dialog).getByRole('button', { name: /start migration/i });
    fireEvent.click(startBtn);

    await waitFor(() => expect(api.migrateMailbox).toHaveBeenCalledWith('mb-1', 'mb-2'));
    expect(api.deleteMailbox).not.toHaveBeenCalled();
    expect(await within(dialog).findByText(/migrating mail to/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/bob@acmecorp\.com/i)).toBeInTheDocument();
  });

  it('strictly verifies completed migration and allows user to delete the mailbox afterwards', async () => {
    vi.mocked(api.migrateMailbox).mockResolvedValueOnce({ jobId: 'job-verified-1' });
    vi.mocked(api.getMigrationJobStatus).mockResolvedValue({
      id: 'job-verified-1',
      status: 'completed',
      sourceAddress: 'alice@acmecorp.com',
      destinationAddress: 'bob@acmecorp.com',
      totalMessages: 15,
      migratedMessages: 15,
      failedCount: 0,
      deleteSourceAfter: false,
      error: null,
    });
    vi.mocked(api.deleteMailbox).mockResolvedValueOnce({ message: 'Mailbox deleted' });

    renderDashboard();
    await screen.findByText('Admin Overview');
    fireEvent.click(screen.getByText('View all mailboxes'));

    const actionButtons = await screen.findAllByRole('button', { name: /mailbox actions/i });
    fireEvent.click(actionButtons[0]);
    // Use the dedicated "Migrate Mail" action directly from menu
    const migrateMenuBtn = await screen.findByRole('button', { name: /migrate mail/i });
    fireEvent.click(migrateMenuBtn);

    const dialog = await screen.findByRole('dialog');
    const destSelect = await within(dialog).findByLabelText(/move all mail into/i);
    await waitFor(() => expect(within(destSelect).getAllByRole('option').length).toBeGreaterThan(1));
    fireEvent.change(destSelect, { target: { value: 'mb-2' } });

    fireEvent.click(within(dialog).getByRole('button', { name: /start migration/i }));

    expect(await within(dialog).findByText(/Migration Completed & Strictly Verified/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/have been verified and transferred to/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/100% Verified/i)).toBeInTheDocument();

    // Now delete option is unlocked
    const confirmInput = within(dialog).getByPlaceholderText('alice@acmecorp.com');
    fireEvent.change(confirmInput, { target: { value: 'alice@acmecorp.com' } });

    const deleteBtn = within(dialog).getByRole('button', { name: /delete mailbox/i });
    fireEvent.click(deleteBtn);

    await waitFor(() => expect(api.deleteMailbox).toHaveBeenCalledWith('mb-1'));
  });

  it('allows suspending an active mailbox via three-dots menu', async () => {
    vi.mocked(api.suspendMailbox).mockResolvedValue({
      message: 'Mailbox successfully suspended',
      mailbox: {
        id: 'mb-1',
        tenantId: 'tenant-123',
        domainId: 'dom-1',
        localPart: 'alice',
        address: 'alice@acmecorp.com',
        stalwartAccountId: 'acc-alice',
        status: 'suspended',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    });

    renderDashboard();
    await screen.findByText('Admin Overview');

    const mailboxesTab = screen.getByText('View all mailboxes');
    fireEvent.click(mailboxesTab);

    // Find three-dots actions button
    const actionButtons = await screen.findAllByRole('button', { name: /mailbox actions/i });
    fireEvent.click(actionButtons[0]);

    // Click Suspend Mailbox from menu
    const suspendBtn = await screen.findByRole('button', { name: /suspend mailbox/i });
    fireEvent.click(suspendBtn);

    // Dialog should appear
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /suspend mailbox/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/alice@acmecorp\.com/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/temporary access restriction/i)).toBeInTheDocument();

    // Confirm suspend
    const confirmSuspendBtn = within(dialog).getByRole('button', { name: /suspend mailbox/i });
    fireEvent.click(confirmSuspendBtn);

    await waitFor(() => {
      expect(api.suspendMailbox).toHaveBeenCalledWith('mb-1');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('allows reactivating a suspended mailbox via three-dots menu', async () => {
    vi.mocked(api.listMyMailboxes).mockResolvedValue({
      mailboxes: [
        {
          id: 'mb-1',
          tenantId: 'tenant-123',
          domainId: 'dom-1',
          localPart: 'alice',
          address: 'alice@acmecorp.com',
          stalwartAccountId: 'acc-alice',
          status: 'suspended',
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });

    vi.mocked(api.reactivateMailbox).mockResolvedValue({
      message: 'Mailbox successfully reactivated',
      mailbox: {
        id: 'mb-1',
        tenantId: 'tenant-123',
        domainId: 'dom-1',
        localPart: 'alice',
        address: 'alice@acmecorp.com',
        stalwartAccountId: 'acc-alice',
        status: 'active',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    });

    renderDashboard();
    await screen.findByText('Admin Overview');

    const mailboxesTab = screen.getByText('View all mailboxes');
    fireEvent.click(mailboxesTab);

    // Find three-dots actions button
    const actionButtons = await screen.findAllByRole('button', { name: /mailbox actions/i });
    fireEvent.click(actionButtons[0]);

    // Click Reactivate Mailbox from menu
    const reactivateBtn = await screen.findByRole('button', { name: /reactivate mailbox/i });
    fireEvent.click(reactivateBtn);

    // Dialog should appear
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: /reactivate mailbox/i })).toBeInTheDocument();
    expect(within(dialog).getByText(/alice@acmecorp\.com/i)).toBeInTheDocument();

    // Confirm reactivate
    const confirmReactivateBtn = within(dialog).getByRole('button', { name: /reactivate mailbox/i });
    fireEvent.click(confirmReactivateBtn);

    await waitFor(() => {
      expect(api.reactivateMailbox).toHaveBeenCalledWith('mb-1');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('displays onboarding empty state card on dashboard when tenant has 0 domains', async () => {
    vi.mocked(api.getTenantMe).mockResolvedValueOnce({
      tenant: {
        id: 'tenant-empty',
        name: 'New Company',
        status: 'active',
        mailboxLimit: 10,
        mailboxCount: 0,
        adminCount: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        domain: null,
        domains: [],
      },
    });
    vi.mocked(api.listTenantDomains).mockResolvedValueOnce({ domains: [] });

    renderDashboard();

    expect(await screen.findByText(/connect your first domain to get started/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add your first domain/i })).toBeInTheDocument();
    expect(screen.queryByText('Mailbox Allocation')).not.toBeInTheDocument();
    expect(screen.queryByText('Operational Health')).not.toBeInTheDocument();
    expect(screen.queryByText('Recently Added Mailboxes')).not.toBeInTheDocument();
  });

  it('navigates back to Tenant Home via the header brand and allows switching domains via the sidebar domain switcher', async () => {
    renderDashboard();
    await screen.findByText('Admin Overview');

    fireEvent.click(screen.getByRole('button', { name: /toowix admin/i }));
    expect(onNavigateHome).toHaveBeenCalledTimes(1);

    // Sidebar domain switcher opens dropdown list of domains
    const switcherTrigger = screen.getByRole('button', { name: /acmecorp\.com/i });
    fireEvent.click(switcherTrigger);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  describe('2FA Setup Removable Notification', () => {
    it('renders 2FA setup reminder notification when 2FA is not enabled', async () => {
      renderDashboard({ user: { ...mockUser, twoFactorEnabled: false } });

      expect(await screen.findByRole('region', { name: /Two-Factor Authentication Setup Notice/i })).toBeInTheDocument();
      expect(screen.getByText(/Enhance account security with Two-Factor Authentication/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Set up 2FA/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Remind me later/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Dismiss 2FA notification/i })).toBeInTheDocument();
    });

    it('dismisses 2FA reminder when X close button is clicked and records in sessionStorage', async () => {
      renderDashboard({ user: { ...mockUser, twoFactorEnabled: false } });

      const closeBtn = await screen.findByRole('button', { name: /Dismiss 2FA notification/i });
      fireEvent.click(closeBtn);

      await waitFor(() => {
        expect(screen.queryByRole('region', { name: /Two-Factor Authentication Setup Notice/i })).not.toBeInTheDocument();
      });
      expect(sessionStorage.getItem('toowix_dismissed_2fa_banner')).toBe('true');
    });

    it('dismisses 2FA reminder when Remind me later button is clicked', async () => {
      renderDashboard({ user: { ...mockUser, twoFactorEnabled: false } });

      const remindBtn = await screen.findByRole('button', { name: /Remind me later/i });
      fireEvent.click(remindBtn);

      await waitFor(() => {
        expect(screen.queryByRole('region', { name: /Two-Factor Authentication Setup Notice/i })).not.toBeInTheDocument();
      });
      expect(sessionStorage.getItem('toowix_dismissed_2fa_banner')).toBe('true');
    });

    it('clicking Set up 2FA navigates to Tenant Home (Security now lives there)', async () => {
      renderDashboard({ user: { ...mockUser, twoFactorEnabled: false } });

      const setupBtn = await screen.findByRole('button', { name: /Set up 2FA/i });
      fireEvent.click(setupBtn);

      expect(onNavigateHome).toHaveBeenCalled();
    });

    it('does not render 2FA setup notification when user has 2FA enabled', async () => {
      vi.mocked(api.getSecuritySettings).mockResolvedValue({
        email: 'admin@acmecorp.com',
        twoFactorEnabled: true,
        twoFactorMethod: 'totp',
      } as any);

      renderDashboard({ user: { ...mockUser, twoFactorEnabled: true } });

      expect(await screen.findByText('Admin Overview')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: /Two-Factor Authentication Setup Notice/i })).not.toBeInTheDocument();
    });

    it('does not render 2FA setup notification when already dismissed in sessionStorage', async () => {
      sessionStorage.setItem('toowix_dismissed_2fa_banner', 'true');

      renderDashboard({ user: { ...mockUser, twoFactorEnabled: false } });

      expect(await screen.findByText('Admin Overview')).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: /Two-Factor Authentication Setup Notice/i })).not.toBeInTheDocument();
    });

    it('clicking Storage in the sidebar switches navigation to the Storage view', async () => {
      renderDashboard();

      const storageNavBtn = await screen.findByRole('button', { name: /Storage/i });
      fireEvent.click(storageNavBtn);

      await waitFor(() => {
        expect(screen.getByText('Total Storage Used')).toBeInTheDocument();
        expect(screen.getByText('Average per Mailbox')).toBeInTheDocument();
      });
    });

    it('clicking Domains in the sidebar displays authoritative DNS zone file and status panel', async () => {
      renderDashboard();

      const domainsNavBtn = await screen.findByRole('button', { name: /domains & dns/i });
      fireEvent.click(domainsNavBtn);

      await waitFor(() => {
        expect(screen.getByText('Authoritative DNS Zone Configuration')).toBeInTheDocument();
        expect(screen.getByText(/Authoritative Zone file for acmecorp\.com/i)).toBeInTheDocument();
      });

      // Dummy hardcoded records should not exist
      expect(screen.queryByText('mail.123.com')).not.toBeInTheDocument();
      expect(screen.queryByText('v=spf1 mx include:relay.toowix.net ~all')).not.toBeInTheDocument();
    });

    it('does not display Security or Team tabs in the sidebar navigation', async () => {
      renderDashboard();

      await screen.findByRole('button', { name: /dashboard/i });
      expect(screen.queryByRole('button', { name: /^security$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^team$/i })).not.toBeInTheDocument();
    });

    it('gracefully falls back to first domain and does not crash when navigated with unknown domainId', async () => {
      const onSelectDomain = vi.fn();
      render(
        <TenantAdminDashboard
          domainId="unknown-non-existent-domain-id"
          user={mockUser}
          onLogout={onLogout}
          onNavigateHome={onNavigateHome}
          onSelectDomain={onSelectDomain}
        />
      );

      // Should load fallback domain (dom-1)
      expect(await screen.findByText('Admin Overview')).toBeInTheDocument();
      expect(onSelectDomain).toHaveBeenCalledWith('dom-1');

      // Click Domains & DNS - should render smoothly without blank screen or crash
      const domainsNavBtn = screen.getByRole('button', { name: /domains & dns/i });
      fireEvent.click(domainsNavBtn);

      await waitFor(() => {
        expect(screen.getByText('Authoritative DNS Zone Configuration')).toBeInTheDocument();
        expect(screen.getByText('Danger Zone')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete domain/i })).toBeInTheDocument();
      });
    });

    it('handles clicking Domains & DNS when no domain exists without throwing or blank screen', async () => {
      vi.mocked(api.getTenantMe).mockResolvedValueOnce({
        tenant: {
          id: 'tenant-empty',
          name: 'Empty Corp',
          status: 'active',
          mailboxLimit: 10,
          mailboxCount: 0,
          availableMailboxes: 10,
          adminCount: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          domains: [],
        } as any,
      });
      vi.mocked(api.listTenantDomains).mockResolvedValueOnce({ domains: [] });

      render(
        <TenantAdminDashboard
          domainId="empty-id"
          user={mockUser}
          onLogout={onLogout}
          onNavigateHome={onNavigateHome}
        />
      );

      expect(await screen.findByText('Admin Overview')).toBeInTheDocument();

      const domainsNavBtn = screen.getByRole('button', { name: /domains & dns/i });
      fireEvent.click(domainsNavBtn);

      await waitFor(() => {
        expect(screen.getByText('No Domains Configured')).toBeInTheDocument();
        expect(screen.getAllByRole('button', { name: /add domain/i }).length).toBeGreaterThanOrEqual(1);
      });
    });

    it('opens DomainSetupModal when clicking "+ Add Domain" button in Domains tab header', async () => {
      renderDashboard();

      expect(await screen.findByText('Admin Overview')).toBeInTheDocument();

      const domainsNavBtn = screen.getByRole('button', { name: /domains & dns/i });
      fireEvent.click(domainsNavBtn);

      await waitFor(() => {
        expect(screen.getByText('Domain Configuration')).toBeInTheDocument();
      });

      const addDomainBtn = screen.getByRole('button', { name: /add domain/i });
      expect(addDomainBtn).toBeInTheDocument();

      fireEvent.click(addDomainBtn);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        expect(screen.getByText(/Let's start with a name for your domain/i)).toBeInTheDocument();
      });
    });
  });

  describe('Tenant Moderator role restriction', () => {
    const mockModerator: UserContext = {
      id: 'moderator-user-1',
      email: 'mod@acmecorp.com',
      role: 'TENANT_MODERATOR',
      tenantId: 'tenant-123',
    };

    it('shows the Mailboxes and Security nav tabs for Moderator, hides Tenant-Admin-only tabs', async () => {
      renderDashboard({ user: mockModerator });

      await waitFor(() => expect(screen.getByRole('button', { name: /mailboxes/i })).toBeInTheDocument());
      expect(screen.getByRole('button', { name: /^security$/i })).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /^dashboard$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /storage/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /billing/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /domains & dns/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^team$/i })).not.toBeInTheDocument();
    });

    it('clicking Security in Moderator sidebar switches navigation to Security Center with Account Security and Domain Firewall subtabs', async () => {
      renderDashboard({ user: mockModerator });

      const securityNavBtn = await screen.findByRole('button', { name: /^security$/i });
      fireEvent.click(securityNavBtn);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /security center/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /account security & 2fa/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /domain firewall/i })).toBeInTheDocument();
      });
    });

    it('clicking Set up 2FA in banner switches Moderator to Security Center Account Security tab', async () => {
      renderDashboard({ user: mockModerator });

      const setup2faBtn = await screen.findByRole('button', { name: /set up 2fa/i });
      fireEvent.click(setup2faBtn);

      await waitFor(() => {
        expect(screen.getByRole('heading', { level: 1, name: /security center/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /account security & 2fa/i })).toBeInTheDocument();
      });
    });

    it('lands on the Mailboxes tab by default instead of Dashboard', async () => {
      renderDashboard({ user: mockModerator });

      await waitFor(() => expect(screen.getByText('alice@acmecorp.com')).toBeInTheDocument());
      expect(screen.queryByText('Admin Overview')).not.toBeInTheDocument();
    });

    it("hides the domain switcher's Add Domain button", async () => {
      renderDashboard({ user: mockModerator });

      await waitFor(() => expect(screen.getByRole('button', { name: /mailboxes/i })).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /add domain/i })).not.toBeInTheDocument();
    });

    it('with an empty domainId (App.tsx\'s Moderator landing redirect), resolves to the first domain from their own scoped list', async () => {
      renderDashboard({ user: mockModerator, domainId: '' });

      // acmecorp.com is dom-1, the only domain in the mocked (already server-scoped) list.
      await waitFor(() => expect(screen.getByText('acmecorp.com')).toBeInTheDocument());
      expect(screen.getByText('alice@acmecorp.com')).toBeInTheDocument();
    });

    it('does not render the Delete Mailbox option in mailbox row actions for Moderator', async () => {
      renderDashboard({ user: mockModerator });

      await waitFor(() => expect(screen.getByText('alice@acmecorp.com')).toBeInTheDocument());

      const actionButtons = await screen.findAllByRole('button', { name: /mailbox actions/i });
      expect(actionButtons.length).toBeGreaterThan(0);

      fireEvent.click(actionButtons[0]);

      // Actions available to moderator: Reset Password, Migrate Mail, Suspend Mailbox
      expect(await screen.findByRole('button', { name: /reset password/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /migrate mail/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /suspend mailbox/i })).toBeInTheDocument();

      // Delete Mailbox MUST NOT exist for moderator
      expect(screen.queryByRole('button', { name: /delete mailbox/i })).not.toBeInTheDocument();
    });

    it('renders the initial tab specified by activeNav prop and notifies onNavChange on click', async () => {
      const onNavChange = vi.fn();
      renderDashboard({ activeNav: 'security', onNavChange });

      // Direct mount on Security tab renders Security Center heading
      expect(await screen.findByRole('heading', { level: 1, name: /security center/i })).toBeInTheDocument();

      // Clicking mailboxes tab triggers onNavChange callback for routing
      const mailboxesNavBtn = screen.getByRole('button', { name: /mailboxes/i });
      fireEvent.click(mailboxesNavBtn);
      expect(onNavChange).toHaveBeenCalledWith('mailboxes');
    });
  });
});



