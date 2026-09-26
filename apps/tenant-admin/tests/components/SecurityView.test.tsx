import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecurityView } from '../../src/components/SecurityView';
import { DomainSecurityView } from '../../src/components/DomainSecurityView';
import { BlockedIpsView } from '../../src/components/BlockedIpsView';
import { AllowedIpsView } from '../../src/components/AllowedIpsView';
import { api } from '../../src/api';
import { UserContext, SecuritySettings, DomainItem } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getSecuritySettings: vi.fn(),
    checkIpStatus: vi.fn(),
    getBlockedIps: vi.fn(),
    unblockIp: vi.fn(),
    blockIp: vi.fn(),
    getAllowedIps: vi.fn(),
    addAllowedIp: vi.fn(),
    removeAllowedIp: vi.fn(),
  },
}));

const mockUser: UserContext = {
  id: 'admin-1',
  email: 'admin@acmecorp.com',
  role: 'TENANT_ADMIN',
  tenantId: 'tenant-1',
};

const mockDomain: DomainItem = {
  id: 'dom-1',
  domainName: 'acmecorp.com',
  status: 'active',
  mailboxCount: 2,
  mailboxLimit: 10,
  dnsStatus: 'active',
};

const initialSettings: SecuritySettings = {
  email: 'admin@acmecorp.com',
  recoveryEmail: 'recovery@personal.org',
  twoFactorEnabled: true,
  twoFactorMethod: 'totp',
  hasTotpConfigured: true,
};

describe('SecurityView Component (Global Account Security)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSecuritySettings).mockResolvedValue(initialSettings);
  });

  it('renders Account Security directly without IP sub-tabs', async () => {
    render(<SecurityView user={mockUser} />);

    // Should display Account Security header and 2FA options
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Account Security' })).toBeInTheDocument();
      expect(screen.getByText('Two-Factor Authentication (2FA) Methods')).toBeInTheDocument();
    });

    // Should NOT have Blocked IPs or Allowed IPs subtabs on this page
    expect(screen.queryByRole('button', { name: /Blocked IPs/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Allowed IPs/i })).not.toBeInTheDocument();
  });
});

describe('DomainSecurityView Component (Per-Domain IP Security)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getBlockedIps).mockResolvedValue({
      list: [
        {
          id: 'blk-1',
          address: '203.0.113.55',
          reason: 'manual',
          createdAt: '2026-09-15T10:00:00Z',
          expiresAt: null,
        },
      ],
    });
    vi.mocked(api.getAllowedIps).mockResolvedValue({
      list: [
        {
          id: 'alw-1',
          address: '198.51.100.0/24',
          reason: 'Branch Office',
          createdAt: '2026-09-15T08:00:00Z',
          expiresAt: null,
        },
      ],
    });
  });

  it('renders domain badge, sub-tabs, and defaults to Blocked IPs', async () => {
    render(<DomainSecurityView activeDomain={mockDomain} />);

    expect(screen.getByRole('heading', { level: 1, name: /Domain Security/i })).toBeInTheDocument();
    expect(screen.getByText('@acmecorp.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Blocked IPs/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Allowed IPs/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Check Blocked IP')).toBeInTheDocument();
    });
  });

  it('switches to Allowed IPs sub-tab and displays whitelisted entries for domain', async () => {
    const user = userEvent.setup();
    render(<DomainSecurityView activeDomain={mockDomain} />);

    const allowedTabBtn = screen.getByRole('button', { name: /Allowed IPs/i });
    await user.click(allowedTabBtn);

    await waitFor(() => {
      expect(screen.getByText(/Allowed IPs \(1\)/i)).toBeInTheDocument();
      expect(screen.getAllByText('198.51.100.0/24')[0]).toBeInTheDocument();
      expect(screen.getAllByText('Branch Office')[0]).toBeInTheDocument();
    });
  });
});

describe('BlockedIpsView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('performs diagnostic search and displays Unblock button when IP is blocked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.checkIpStatus).mockResolvedValue({
      ip: '192.0.2.42',
      isBlocked: true,
      blockedEntry: {
        id: 'blk-42',
        address: '192.0.2.42',
        reason: 'brute-force auto-ban',
      },
      isAllowed: false,
      allowedEntry: null,
    });

    render(<BlockedIpsView />);

    expect(screen.getByText('Check Blocked IP')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Enter IP address/i);
    await user.type(searchInput, '192.0.2.42');

    const checkBtn = screen.getByRole('button', { name: /Check IP/i });
    await user.click(checkBtn);

    await waitFor(() => {
      expect(screen.getByText('Blocked')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Unblock IP/i })).toBeInTheDocument();
    });
  });

  it('triggers automated unblock when Unblock IP is clicked', async () => {
    const user = userEvent.setup();
    vi.mocked(api.checkIpStatus).mockResolvedValue({
      ip: '192.0.2.42',
      isBlocked: true,
      blockedEntry: {
        id: 'blk-42',
        address: '192.0.2.42',
        reason: 'brute-force auto-ban',
      },
      isAllowed: false,
      allowedEntry: null,
    });
    vi.mocked(api.unblockIp).mockResolvedValue({
      success: true,
      unblockedCount: 1,
      message: 'IP address 192.0.2.42 has been unblocked.',
    });

    render(<BlockedIpsView />);

    const searchInput = screen.getByPlaceholderText(/Enter IP address/i);
    await user.type(searchInput, '192.0.2.42');

    const checkBtn = screen.getByRole('button', { name: /Check IP/i });
    await user.click(checkBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Unblock IP/i })).toBeInTheDocument();
    });

    const unblockBtn = screen.getByRole('button', { name: /Unblock IP/i });
    await user.click(unblockBtn);

    await waitFor(() => {
      expect(api.unblockIp).toHaveBeenCalledWith({ id: 'blk-42', address: '192.0.2.42' });
      expect(screen.getByText(/has been unblocked/i)).toBeInTheDocument();
      expect(screen.getByText('Not Blocked')).toBeInTheDocument();
    });
  });
});

describe('AllowedIpsView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getAllowedIps).mockResolvedValue({
      list: [
        {
          id: 'alw-10',
          address: '10.50.0.1',
          reason: 'VPN Gateway',
          createdAt: '2026-09-15T07:00:00Z',
          expiresAt: null,
        },
      ],
    });
  });

  it('allows adding an IP to allowed list', async () => {
    const user = userEvent.setup();
    vi.mocked(api.addAllowedIp).mockResolvedValue({
      success: true,
      message: 'Added successfully',
      item: {
        id: 'alw-new',
        address: '203.0.113.100',
        reason: 'Office static IP',
        createdAt: '2026-09-15T12:00:00Z',
      },
    });

    render(<AllowedIpsView />);

    await waitFor(() => {
      expect(screen.getAllByText('10.50.0.1')[0]).toBeInTheDocument();
    });

    const openAddBtn = screen.getAllByRole('button', { name: /Add IP/i })[0];
    await user.click(openAddBtn);

    expect(screen.getByText('Add Allowed IP')).toBeInTheDocument();

    const ipInput = screen.getByPlaceholderText(/e\.g\. 198\.51\.100\.1/i);
    await user.type(ipInput, '203.0.113.100');

    const submitBtn = screen.getAllByRole('button', { name: /Add IP/i }).find((b) => b.getAttribute('type') === 'submit')!;
    await user.click(submitBtn);

    await waitFor(() => {
      expect(api.addAllowedIp).toHaveBeenCalledWith({
        address: '203.0.113.100',
        reason: 'Allowed IP',
      });
    });
  });
});
