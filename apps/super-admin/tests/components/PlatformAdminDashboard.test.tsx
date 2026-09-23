import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { PlatformAdminDashboard } from '../../src/components/PlatformAdminDashboard';
import { api } from '../../src/api';
import { UserContext } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getSystemStatus: vi.fn(),
    listTenants: vi.fn(),
    getDetailedSystemHealth: vi.fn(),
    getAuditLogs: vi.fn(),
    getAlertConfig: vi.fn(),
    listBackups: vi.fn(),
    getReconciliationReport: vi.fn(),
    getAnalytics: vi.fn().mockResolvedValue(null),
    setup2Fa: vi.fn().mockResolvedValue({ secret: 'MOCKSECRET', qrCodeDataUrl: 'data:image/png;base64,mock' }),
    confirm2Fa: vi.fn().mockResolvedValue({ success: true, backupCodes: [] }),
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

    vi.mocked(api.getDetailedSystemHealth).mockResolvedValue({
      status: 'healthy',
      components: { database: 'connected', stalwart: 'connected' },
    } as any);
    vi.mocked(api.getAuditLogs).mockResolvedValue({ logs: [], limit: 50, offset: 0 });
    vi.mocked(api.getAlertConfig).mockResolvedValue({} as any);
    vi.mocked(api.listBackups).mockResolvedValue({ backups: [] });
    vi.mocked(api.getReconciliationReport).mockResolvedValue({ isClean: true, discrepancies: [] } as any);
    sessionStorage.clear();
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
    expect(screen.queryByText(/Domain Applications/i)).not.toBeInTheDocument();
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

  describe('2FA Setup Removable Notification', () => {
    it('renders 2FA setup reminder notification when user 2FA is disabled', async () => {
      render(<PlatformAdminDashboard user={{ ...mockUser, twoFactorEnabled: false }} onLogout={onLogout} />);
      await waitForDashboardReady();

      const banner = screen.getByRole('region', { name: /Two-Factor Authentication Setup Notice/i });
      expect(banner).toBeInTheDocument();
      expect(within(banner).getByText(/Enhance account security with Two-Factor Authentication/i)).toBeInTheDocument();
      expect(within(banner).getByRole('button', { name: /Set up 2FA/i })).toBeInTheDocument();
      expect(within(banner).getByRole('button', { name: /Remind me later/i })).toBeInTheDocument();
      expect(within(banner).getByRole('button', { name: /Dismiss 2FA notification/i })).toBeInTheDocument();
    });

    it('dismisses 2FA reminder when X close button is clicked and records in sessionStorage', async () => {
      render(<PlatformAdminDashboard user={{ ...mockUser, twoFactorEnabled: false }} onLogout={onLogout} />);
      await waitForDashboardReady();

      const banner = screen.getByRole('region', { name: /Two-Factor Authentication Setup Notice/i });
      const closeBtn = within(banner).getByRole('button', { name: /Dismiss 2FA notification/i });
      fireEvent.click(closeBtn);

      expect(screen.queryByRole('region', { name: /Two-Factor Authentication Setup Notice/i })).not.toBeInTheDocument();
      expect(sessionStorage.getItem('toowix_dismissed_2fa_banner')).toBe('true');
    });

    it('dismisses 2FA reminder when Remind me later button is clicked', async () => {
      render(<PlatformAdminDashboard user={{ ...mockUser, twoFactorEnabled: false }} onLogout={onLogout} />);
      await waitForDashboardReady();

      const banner = screen.getByRole('region', { name: /Two-Factor Authentication Setup Notice/i });
      const remindBtn = within(banner).getByRole('button', { name: /Remind me later/i });
      fireEvent.click(remindBtn);

      expect(screen.queryByRole('region', { name: /Two-Factor Authentication Setup Notice/i })).not.toBeInTheDocument();
      expect(sessionStorage.getItem('toowix_dismissed_2fa_banner')).toBe('true');
    });

    it('clicking Set up 2FA opens the 2FA setup modal', async () => {
      render(<PlatformAdminDashboard user={{ ...mockUser, twoFactorEnabled: false }} onLogout={onLogout} />);
      await waitForDashboardReady();

      const banner = screen.getByRole('region', { name: /Two-Factor Authentication Setup Notice/i });
      const setupBtn = within(banner).getByRole('button', { name: /Set up 2FA/i });
      fireEvent.click(setupBtn);

      await waitFor(() => {
        expect(api.setup2Fa).toHaveBeenCalled();
        expect(screen.getByText('Enhance operator security')).toBeInTheDocument();
      });
    });

    it('does not render 2FA setup notification when user has 2FA enabled', async () => {
      render(<PlatformAdminDashboard user={{ ...mockUser, twoFactorEnabled: true }} onLogout={onLogout} />);
      await waitForDashboardReady();

      expect(screen.queryByRole('region', { name: /Two-Factor Authentication Setup Notice/i })).not.toBeInTheDocument();
    });

    it('does not render 2FA setup notification when already dismissed in sessionStorage', async () => {
      sessionStorage.setItem('toowix_dismissed_2fa_banner', 'true');

      render(<PlatformAdminDashboard user={{ ...mockUser, twoFactorEnabled: false }} onLogout={onLogout} />);
      await waitForDashboardReady();

      expect(screen.queryByRole('region', { name: /Two-Factor Authentication Setup Notice/i })).not.toBeInTheDocument();
    });
  });
});
