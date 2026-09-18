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
  });

  it('lists every domain and navigates to a Domain Dashboard when one is clicked', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findByRole('heading', { name: 'Overview' });
    fireEvent.click(screen.getByRole('button', { name: /^domains$/i }));

    expect(await screen.findByText('acmecorp.com')).toBeInTheDocument();
    expect(screen.getByText('secondary.com')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();

    fireEvent.click(screen.getByText('secondary.com'));
    expect(onNavigateToDomain).toHaveBeenCalledWith('dom-2');
  });

  it('filters the Domains table by search text', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findByRole('heading', { name: 'Overview' });
    fireEvent.click(screen.getByRole('button', { name: /^domains$/i }));
    await screen.findByText('acmecorp.com');

    fireEvent.change(screen.getByPlaceholderText('Search by domain name...'), { target: { value: 'secondary' } });

    expect(screen.queryByText('acmecorp.com')).not.toBeInTheDocument();
    expect(screen.getByText('secondary.com')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2')).toBeInTheDocument();
  });

  it('shows the "connect your first domain" onboarding state when the tenant has zero domains', async () => {
    vi.mocked(api.listTenantDomains).mockResolvedValue({ domains: [] });

    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findByRole('heading', { name: 'Overview' });
    fireEvent.click(screen.getByRole('button', { name: /^domains$/i }));

    expect(await screen.findByText(/connect your first domain to get started/i)).toBeInTheDocument();
  });

  it('nudges saving a DNS provider API key on the Overview landing page when the tenant has zero domains', async () => {
    vi.mocked(api.listTenantDomains).mockResolvedValue({ domains: [] });

    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findByRole('heading', { name: 'Overview' });

    expect(await screen.findByText(/add your first domain to start provisioning mailboxes/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /or save a dns provider api key first/i }));
    expect(await screen.findByRole('heading', { name: 'API Keys' })).toBeInTheDocument();
  });

  it('lists saved API keys with a nav tab, and removes one when deleted', async () => {
    vi.mocked(api.listTenantDnsCredentials)
      .mockResolvedValueOnce({
        credentials: [
          { provider: 'godaddy', verified: true, verifiedProviderDomain: 'acmecorp.com', connectedAt: '2026-01-01T00:00:00.000Z', lastUsedAt: null },
        ],
      })
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
    expect(screen.getByText('acmecorp.com')).toBeInTheDocument();
    expect(screen.getByText('secondary.com')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument(); // dom-1's plan name
    expect(screen.getByText('Individual')).toBeInTheDocument(); // dom-2's plan name
    expect(screen.getByText('2 / 50')).toBeInTheDocument(); // dom-1's mailbox allocation

    expect(screen.queryByText('Recent Activity')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('acmecorp.com'));
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
    expect(screen.getByText('domain-1.com')).toBeInTheDocument();
    expect(screen.getByText('domain-5.com')).toBeInTheDocument();
    expect(screen.queryByText('domain-6.com')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 5 of 12')).toBeInTheDocument();

    // Click "Show more"
    const showMoreBtn = screen.getByRole('button', { name: /show more/i });
    fireEvent.click(showMoreBtn);

    // Now 10 domains are shown
    expect(screen.getByText('domain-6.com')).toBeInTheDocument();
    expect(screen.getByText('domain-10.com')).toBeInTheDocument();
    expect(screen.queryByText('domain-11.com')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 10 of 12')).toBeInTheDocument();

    // Click "Show more" again
    fireEvent.click(screen.getByRole('button', { name: /show more/i }));

    // All 12 domains shown, button becomes "Show less"
    expect(screen.getByText('domain-11.com')).toBeInTheDocument();
    expect(screen.getByText('domain-12.com')).toBeInTheDocument();
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
    await screen.findByText('acmecorp.com');

    fireEvent.click(screen.getByRole('button', { name: /^billing$/i }));

    expect(await screen.findByText('One combined bill covers every domain on this account.')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('acmecorp.com')).toBeInTheDocument();
      expect(screen.getByText('secondary.com')).toBeInTheDocument();
    });
  });

  it('mounts Security, Audit Log, and Active Devices tabs without crashing', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findByText('acmecorp.com');

    fireEvent.click(screen.getByRole('button', { name: /^security$/i }));
    await waitFor(() => expect(api.getSecuritySettings).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /^audit log$/i }));
    expect(await screen.findByText('Organization Audit Trail')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^active devices$/i }));
    await waitFor(() => expect(api.listSessions).toHaveBeenCalled());
  });

  it('does not render the 2FA reminder banner when 2FA is already enabled', async () => {
    render(<TenantHomeView user={{ ...mockUser, twoFactorEnabled: true }} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findByText('acmecorp.com');

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
});
