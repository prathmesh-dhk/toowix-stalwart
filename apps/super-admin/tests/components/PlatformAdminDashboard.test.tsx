import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlatformAdminDashboard } from '../../src/components/PlatformAdminDashboard';
import { api } from '../../src/api';
import { UserContext } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getSystemStatus: vi.fn(),
    listTenants: vi.fn(),
    listApplications: vi.fn(),
    getDetailedSystemHealth: vi.fn(),
    getAuditLogs: vi.fn(),
    getAlertConfig: vi.fn(),
    listBackups: vi.fn(),
    getReconciliationReport: vi.fn(),
  },
  clearStoredToken: vi.fn(),
  getStoredToken: vi.fn(() => 'mock-super-token'),
}));

const mockUser: UserContext = {
  id: 'super-user-1',
  email: 'superadmin@toowix.com',
  role: 'SUPER_ADMIN',
  twoFactorEnabled: true,
};

describe('PlatformAdminDashboard Component', () => {
  const onLogout = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSystemStatus).mockResolvedValue({
      totalTenants: 12,
      activeTenants: 10,
      suspendedTenants: 1,
      totalMailboxes: 340,
      systemUptimeSeconds: 86400,
      cpuUsagePercent: 12.5,
      memoryUsagePercent: 44.2,
      stalwartConnected: true,
    } as any);

    vi.mocked(api.listTenants).mockResolvedValue({
      tenants: [
        {
          id: 't-1',
          name: 'Nexus Tech',
          status: 'active',
          mailboxLimit: 50,
          mailboxCount: 20,
          availableMailboxes: 30,
          adminCount: 2,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          domain: { id: 'd-1', domainName: 'nexus.tech', status: 'active' },
        },
      ],
    } as any);

    vi.mocked(api.listApplications).mockResolvedValue({ applications: [], pagination: { total: 0, limit: 10, skip: 0 } } as any);
    vi.mocked(api.getDetailedSystemHealth).mockResolvedValue({
      status: 'healthy',
      components: { database: 'connected', stalwart: 'connected' },
    } as any);
    vi.mocked(api.getAuditLogs).mockResolvedValue({ logs: [], limit: 50, offset: 0 });
    vi.mocked(api.getAlertConfig).mockResolvedValue({} as any);
    vi.mocked(api.listBackups).mockResolvedValue({ backups: [] });
    vi.mocked(api.getReconciliationReport).mockResolvedValue({ isClean: true, discrepancies: [] } as any);
  });

  const waitForDashboardReady = async () => {
    await waitFor(
      () => {
        expect(screen.queryByText(/Loading Super Admin platform console/i)).not.toBeInTheDocument();
      },
      { timeout: 10000 }
    );
  };

  it('renders navigation sidebar and platform branding after loading', async () => {
    render(<PlatformAdminDashboard user={mockUser} onLogout={onLogout} />);
    await waitForDashboardReady();

    expect(screen.getByText(/Platform Console/i)).toBeInTheDocument();
    expect(screen.getByText(/Tenant Applications/i)).toBeInTheDocument();
  });

  it('switches to Tenants tab when clicked in sidebar', async () => {
    render(<PlatformAdminDashboard user={mockUser} onLogout={onLogout} />);
    await waitForDashboardReady();

    // Click on "Tenants" navigation tab
    const tenantsTab = screen.getByRole('button', { name: /tenants/i });
    fireEvent.click(tenantsTab);

    // Should load the tenants view and display the tenant from api.listTenants
    expect(await screen.findByText('Nexus Tech')).toBeInTheDocument();
    expect(screen.getByText('nexus.tech')).toBeInTheDocument();
  });

  it('calls onLogout when clicking Sign Out button', async () => {
    render(<PlatformAdminDashboard user={mockUser} onLogout={onLogout} />);
    await waitForDashboardReady();

    const logoutBtn = screen.getByTitle(/sign out/i);
    fireEvent.click(logoutBtn);

    expect(onLogout).toHaveBeenCalled();
  });
});
