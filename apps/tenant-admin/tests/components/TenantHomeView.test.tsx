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

  it('shows the "connect your first domain" onboarding state when the tenant has zero domains', async () => {
    vi.mocked(api.listTenantDomains).mockResolvedValue({ domains: [] });

    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);
    await screen.findByRole('heading', { name: 'Overview' });
    fireEvent.click(screen.getByRole('button', { name: /^domains$/i }));

    expect(await screen.findByText(/connect your first domain to get started/i)).toBeInTheDocument();
  });

  it('shows tenant-wide stats and a domain preview (with plan + seat usage) on the Overview tab, with no Recent Activity panel', async () => {
    render(<TenantHomeView user={mockUser} onLogout={onLogout} onNavigateToDomain={onNavigateToDomain} />);

    expect(await screen.findByRole('heading', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByText('acmecorp.com')).toBeInTheDocument();
    expect(screen.getByText('secondary.com')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument(); // dom-1's plan name
    expect(screen.getByText('Individual')).toBeInTheDocument(); // dom-2's plan name
    expect(screen.getByText('2 / 50')).toBeInTheDocument(); // dom-1's seat usage

    expect(screen.queryByText('Recent Activity')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('acmecorp.com'));
    expect(onNavigateToDomain).toHaveBeenCalledWith('dom-1');
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
