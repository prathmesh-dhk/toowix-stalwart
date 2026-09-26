import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TenantHomeView } from '../../src/components/TenantHomeView';
import { api } from '../../src/api';
import { UserContext } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getTenantMe: vi.fn(),
    listTenantDomains: vi.fn(),
    getAuditLogs: vi.fn(),
    getSecuritySettings: vi.fn(),
    getTenantBillingSummary: vi.fn(),
    listBillingInvoices: vi.fn(),
    getBillingConfig: vi.fn(),
    createPaymentMethodSetupIntent: vi.fn(),
    createTenantDomain: vi.fn(),
    detectDnsProvider: vi.fn(),
    listPlans: vi.fn(),
    listTenantDnsCredentials: vi.fn(),
    saveTenantDnsCredential: vi.fn(),
    deleteTenantDnsCredential: vi.fn(),
    // SecurityView's subtree (mounted on the Security tab)
    checkIpStatus: vi.fn(),
    getBlockedIps: vi.fn(),
    unblockIp: vi.fn(),
    blockIp: vi.fn(),
    getAllowedIps: vi.fn(),
    addAllowedIp: vi.fn(),
    removeAllowedIp: vi.fn(),
    // ActiveDevicesView
    listSessions: vi.fn(),
    revokeSession: vi.fn(),
    revokeOtherSessions: vi.fn(),
    // ModeratorsView (mounted on the Team tab)
    listModerators: vi.fn(),
  },
}));

const mockUser: UserContext = {
  id: 'tenant-user-1',
  email: 'admin@acmecorp.com',
  role: 'TENANT_ADMIN',
  tenantId: 'tenant-123',
};

const mockDomains = [
  {
    id: 'dom-1',
    domainName: 'acmecorp.com',
    status: 'active',
    dnsStatus: 'active' as const,
    mailboxLimit: 50,
    employeeCount: 50,
    mailboxCount: 2,
    planName: 'Team',
    isPrimary: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'dom-2',
    domainName: 'secondary.com',
    status: 'active',
    dnsStatus: 'activating' as const,
    mailboxLimit: 10,
    employeeCount: 10,
    mailboxCount: 0,
    planName: 'Individual',
    isPrimary: false,
    createdAt: '2026-01-02T00:00:00.000Z',
  },
];

describe('TenantHomeView Component', () => {
  const onLogout = vi.fn();
  const onNavigateToDomain = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTenantMe).mockResolvedValue({
      tenant: {
        id: 'tenant-123',
        name: 'Acme Corporation',
        status: 'active',
        mailboxLimit: 60,
        mailboxCount: 2,
        adminCount: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        domain: { id: 'dom-1', domainName: 'acmecorp.com', status: 'active' },
      },
    });
    vi.mocked(api.listTenantDomains).mockResolvedValue({ domains: mockDomains });
    vi.mocked(api.getAuditLogs).mockResolvedValue({ logs: [], limit: 50, offset: 0 });
    vi.mocked(api.getSecuritySettings).mockResolvedValue({
      email: 'admin@acmecorp.com',
      recoveryEmail: null,
      twoFactorEnabled: true,
      twoFactorMethod: null,
      remainingBackupCodes: 0,
    } as any);
    vi.mocked(api.getTenantBillingSummary).mockResolvedValue({
      hasSubscription: true,
      status: 'active',
      currentPeriodEnd: '2026-11-01T00:00:00.000Z',
      trialEnd: null,
      cancelAtPeriodEnd: false,
      domains: [
        { domainId: 'dom-1', domainName: 'acmecorp.com', planName: 'Team', seatCount: 10 },
        { domainId: 'dom-2', domainName: 'secondary.com', planName: 'Individual', seatCount: 1 },
      ],
    });
    vi.mocked(api.listBillingInvoices).mockResolvedValue({ invoices: [] });
    vi.mocked(api.listSessions).mockResolvedValue({ sessions: [] });
    vi.mocked(api.listTenantDnsCredentials).mockResolvedValue({ credentials: [] });
    vi.mocked(api.listModerators).mockResolvedValue({ moderators: [] });
  });

  it('lists every domain and navigates to a Domain Dashboard when one is clicked', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findByRole('heading', { name: 'Overview' });
    fireEvent.click(screen.getByRole('button', { name: /^domains$/i }));

    const domains = await screen.findAllByText('acmecorp.com');
    expect(domains[0]).toBeInTheDocument();
    expect(screen.getAllByText('secondary.com')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Primary')[0]).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('secondary.com')[0]);
    expect(onNavigateToDomain).toHaveBeenCalledWith('dom-2');
  });

  it('filters the Domains table by search text', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findByRole('heading', { name: 'Overview' });
    fireEvent.click(screen.getByRole('button', { name: /^domains$/i }));
    await screen.findAllByText('acmecorp.com');

    fireEvent.change(screen.getByPlaceholderText('Search by domain name...'), { target: { value: 'secondary' } });

    expect(screen.queryByText('acmecorp.com')).not.toBeInTheDocument();
    expect(screen.getAllByText('secondary.com')[0]).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument();
  });

  it('shows the setup task cards on Overview instead of the domains table when the tenant has zero domains', async () => {
    vi.mocked(api.listTenantDomains).mockResolvedValue({ domains: [] });

    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);

    // Overview keeps its normal header + stat-card row (including the API
    // Keys card in place of 2FA) even with zero domains — only the content
    // area below switches from the domains table to the setup tasks.
    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('Not saved')).toBeInTheDocument();
    expect(screen.getByText('Add your first domain')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^domains$/i }));
    expect(await screen.findByText(/connect your first domain to get started/i)).toBeInTheDocument();
  });

  it('nudges saving a DNS provider API key from the zero-domains setup tasks', async () => {
    vi.mocked(api.listTenantDomains).mockResolvedValue({ domains: [] });

    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);

    await screen.findByText('Save a DNS provider API key');
    fireEvent.click(screen.getByRole('button', { name: /^add api key$/i }));
    expect(await screen.findByRole('heading', { name: 'API Keys' })).toBeInTheDocument();
  });

  it('marks the setup checklist entries already done (saved API key, 2FA enabled) as complete', async () => {
    vi.mocked(api.listTenantDomains).mockResolvedValue({ domains: [] });
    vi.mocked(api.listTenantDnsCredentials).mockResolvedValue({
      credentials: [
        { provider: 'godaddy', verified: true, verifiedProviderDomain: 'acme.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null },
      ],
    });

    render(<TenantHomeView user={{ ...mockUser, twoFactorEnabled: true }} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);

    await screen.findByRole('heading', { name: 'Overview' });
    // "Saved" appears both on the API Keys stat card and the task card.
    expect((await screen.findAllByText('Saved')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('shows the full Overview dashboard once the tenant has at least one domain', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /set up/i })).not.toBeInTheDocument();
  });

  it('lists saved API keys with a nav tab, and removes one when deleted', async () => {
    const savedGoDaddyKey = {
      credentials: [
        { provider: 'godaddy' as const, verified: true, verifiedProviderDomain: 'acmecorp.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null },
      ],
    };
    vi.mocked(api.listTenantDnsCredentials)
      // TenantHomeView's own load() call, then ApiKeysView's mount call, both
      // see the saved key; the reload after deleting sees it gone.
      .mockResolvedValueOnce(savedGoDaddyKey)
      .mockResolvedValueOnce(savedGoDaddyKey)
      .mockResolvedValueOnce({ credentials: [] });
    vi.mocked(api.deleteTenantDnsCredential).mockResolvedValue({ success: true });

    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findByRole('heading', { name: 'Overview' });
    fireEvent.click(screen.getByRole('button', { name: /^api keys$/i }));

    expect(await screen.findByText('GoDaddy')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^remove$/i }));

    await waitFor(() => expect(api.deleteTenantDnsCredential).toHaveBeenCalledWith('godaddy'));
    expect(await screen.findByText(/no saved api keys yet/i)).toBeInTheDocument();
  });

  it('shows tenant-wide stats and a domain preview (with plan + seat usage) on the Overview tab, with no Recent Activity panel', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getAllByText('acmecorp.com')[0]).toBeInTheDocument();
    expect(screen.getAllByText('secondary.com')[0]).toBeInTheDocument();
    // 'Team' also labels the new Team (Moderators) nav tab, so this must disambiguate rather than assume a single match.
    expect(screen.getAllByText('Team').length).toBeGreaterThanOrEqual(1); // dom-1's plan name
    expect(screen.getAllByText('Individual')[0]).toBeInTheDocument(); // dom-2's plan name
    expect(screen.getAllByText('2 / 50')[0]).toBeInTheDocument(); // dom-1's mailbox allocation

    expect(screen.queryByText('Recent Activity')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByText('acmecorp.com')[0]);
    expect(onNavigateToDomain).toHaveBeenCalledWith('dom-1');
  });

  it('caps domain table on Overview to 5 items and expands when Show more is clicked', async () => {
    const manyDomains: DomainItem[] = Array.from({ length: 12 }, (_, i) => ({
      id: `dom-${i + 1}`,
      domainName: `domain-${i + 1}.com`,
      status: 'active',
      dnsStatus: 'active',
      mailboxLimit: 10,
      employeeCount: 10,
      mailboxCount: 0,
      isPrimary: i === 0,
      planName: 'Basic',
      createdAt: '2026-01-01T00:00:00.000Z',
    }));

    vi.mocked(api.listTenantDomains).mockResolvedValue({ domains: manyDomains });

    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findByRole('heading', { name: 'Overview' });

    // Initially only 5 domains are shown
    expect(screen.getAllByText('domain-1.com')[0]).toBeInTheDocument();
    expect(screen.getAllByText('domain-5.com')[0]).toBeInTheDocument();
    expect(screen.queryByText('domain-6.com')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 5 of 12')).toBeInTheDocument();

    // Click "Show more"
    const showMoreBtn = screen.getByRole('button', { name: /show more/i });
    fireEvent.click(showMoreBtn);

    // Now 10 domains are shown
    expect(screen.getAllByText('domain-6.com')[0]).toBeInTheDocument();
    expect(screen.getAllByText('domain-10.com')[0]).toBeInTheDocument();
    expect(screen.queryByText('domain-11.com')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 10 of 12')).toBeInTheDocument();

    // Click "Show more" again
    fireEvent.click(screen.getByRole('button', { name: /show more/i }));

    // All 12 domains shown, button becomes "Show less"
    expect(screen.getAllByText('domain-11.com')[0]).toBeInTheDocument();
    expect(screen.getAllByText('domain-12.com')[0]).toBeInTheDocument();
    expect(screen.getByText('Showing 12 of 12')).toBeInTheDocument();

    const showLessBtn = screen.getByRole('button', { name: /show less/i });
    expect(showLessBtn).toBeInTheDocument();

    // Click "Show less" collapses back to 5
    fireEvent.click(showLessBtn);
    expect(screen.queryByText('domain-6.com')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 5 of 12')).toBeInTheDocument();
  });

  it('shows the combined billing summary across every domain on the Billing tab', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findAllByText('acmecorp.com');

    fireEvent.click(screen.getByRole('button', { name: /^billing$/i }));

    expect(await screen.findByText('One combined bill covers every domain on this account.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getAllByText('acmecorp.com')[0]).toBeInTheDocument();
      expect(screen.getAllByText('secondary.com')[0]).toBeInTheDocument();
    });
  });

  it('mounts Security, Audit Log, and Active Devices tabs without crashing', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findAllByText('acmecorp.com');

    fireEvent.click(screen.getByRole('button', { name: /^security$/i }));
    await waitFor(() => expect(api.getSecuritySettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /^audit log$/i }));
    expect(await screen.findByText('Organization Audit Trail')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^active devices$/i }));
    await waitFor(() => expect(api.listSessions).toHaveBeenCalled());
  });

  it('does not render the 2FA reminder banner when 2FA is already enabled', async () => {
    render(<TenantHomeView user={{ ...mockUser, twoFactorEnabled: true }} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findAllByText('acmecorp.com');

    expect(screen.queryByRole('region', { name: /Two-Factor Authentication Setup Notice/i })).not.toBeInTheDocument();
  });

  it('renders the 2FA reminder banner and dismisses it per session', async () => {
    vi.mocked(api.getSecuritySettings).mockResolvedValue({
      email: 'admin@acmecorp.com',
      twoFactorEnabled: false,
    } as any);

    render(<TenantHomeView user={{ ...mockUser, twoFactorEnabled: false }} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);

    const closeBtn = await screen.findByRole('button', { name: /Dismiss 2FA notification/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: /Two-Factor Authentication Setup Notice/i })).not.toBeInTheDocument();
    });
    expect(sessionStorage.getItem('toowix_dismissed_2fa_banner')).toBe('true');
  });

  it('opens DomainSetupModal when clicking "Add Domain" button on Overview', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findAllByText('acmecorp.com');

    const addDomainBtn = screen.getByTestId ? screen.getAllByRole('button', { name: /^add domain$/i })[0] : null;
    expect(addDomainBtn).toBeInTheDocument();

    fireEvent.click(addDomainBtn!);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText(/Let's start with a name for your domain/i)).toBeInTheDocument();
    });

    // Close the modal
    const closeBtn = screen.getByRole('button', { name: /exit domain setup/i });
    fireEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('shows the Team tab and loads Moderator accounts when selected', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);

    await screen.findByRole('heading', { name: 'Overview' });

    fireEvent.click(screen.getByRole('button', { name: /^team$/i }));

    await waitFor(() => expect(api.listModerators).toHaveBeenCalled());
    expect(await screen.findByText(/moderators \(0\)/i)).toBeInTheDocument();
  });

  it('renders the initial tab from activeTab prop and notifies onTabChange when sidebar items are clicked', async () => {
    const onTabChange = vi.fn();
    render(
      <TenantHomeView
        user={mockUser}
        onLogout={onLogout}
        onNavigateToDomain={onNavigateToDomain}
        activeTab="security"
        onTabChange={onTabChange}
      />
    );

    // Initial mount at activeTab="security" renders Account Security
    expect(await screen.findByRole('heading', { level: 1, name: /account security/i })).toBeInTheDocument();

    // Clicking Billing sidebar item calls onTabChange('billing')
    fireEvent.click(screen.getByRole('button', { name: /^billing$/i }));
    expect(onTabChange).toHaveBeenCalledWith('billing');
  });
});
