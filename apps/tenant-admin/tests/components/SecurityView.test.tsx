import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecurityView } from '../../src/components/SecurityView';
import { BlockedIpsView } from '../../src/components/BlockedIpsView';
import { AllowedIpsView } from '../../src/components/AllowedIpsView';
import { api } from '../../src/api';
import { UserContext, SecuritySettings } from '../../src/types';

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

const initialSettings: SecuritySettings = {
  email: 'admin@acmecorp.com',
  recoveryEmail: 'recovery@personal.org',
  twoFactorEnabled: true,
  twoFactorMethod: 'totp',
  hasTotpConfigured: true,
};

describe('SecurityView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSecuritySettings).mockResolvedValue(initialSettings);
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

  it('renders sub-tab buttons and defaults to Account Security', async () => {
    render(<SecurityView user={mockUser} />);

    expect(screen.getByText('Security & Firewall Settings')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Account Security/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Blocked IPs/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Allowed IPs/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Two-Factor Authentication (2FA) Methods')).toBeInTheDocument();
    });
  });

  it('switches to Blocked IPs sub-tab and displays search diagnostic card', async () => {
    const user = userEvent.setup();
    render(<SecurityView user={mockUser} />);

    const blockedTabBtn = screen.getByRole('button', { name: /Blocked IPs/i });
    await user.click(blockedTabBtn);

    await waitFor(() => {
      expect(screen.getByText('Check & Unblock IP Address')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Enter IP address/i)).toBeInTheDocument();
    });
  });

  it('switches to Allowed IPs sub-tab and displays whitelisted entries', async () => {
    const user = userEvent.setup();
    render(<SecurityView user={mockUser} />);

    const allowedTabBtn = screen.getByRole('button', { name: /Allowed IPs/i });
    await user.click(allowedTabBtn);

    await waitFor(() => {
      expect(screen.getByText('Allowed IPs (Firewall Whitelist)')).toBeInTheDocument();
      expect(screen.getByText('198.51.100.0/24')).toBeInTheDocument();
      expect(screen.getByText('Branch Office')).toBeInTheDocument();
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

    expect(screen.getByText('Check & Unblock IP Address')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Enter IP address/i);
    await user.type(searchInput, '192.0.2.42');

    const checkBtn = screen.getByRole('button', { name: /Check IP/i });
    await user.click(checkBtn);

    await waitFor(() => {
      expect(screen.getByText('CURRENTLY BLOCKED')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Unblock IP Now/i })).toBeInTheDocument();
    });
  });

  it('triggers automated unblock when Unblock IP Now is clicked', async () => {
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
      message: 'IP address 192.0.2.42 has been unblocked and Stalwart firewall rules reloaded.',
    });

    render(<BlockedIpsView />);

    const searchInput = screen.getByPlaceholderText(/Enter IP address/i);
    await user.type(searchInput, '192.0.2.42');

    const checkBtn = screen.getByRole('button', { name: /Check IP/i });
    await user.click(checkBtn);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Unblock IP Now/i })).toBeInTheDocument();
    });

    const unblockBtn = screen.getByRole('button', { name: /Unblock IP Now/i });
    await user.click(unblockBtn);

    await waitFor(() => {
      expect(api.unblockIp).toHaveBeenCalledWith({ id: 'blk-42', address: '192.0.2.42' });
      expect(screen.getByText(/unblocked and Stalwart firewall rules reloaded/i)).toBeInTheDocument();
      expect(screen.getByText('NOT BLOCKED')).toBeInTheDocument();
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

  it('allows adding an IP to whitelist', async () => {
    const user = userEvent.setup();
    vi.mocked(api.addAllowedIp).mockResolvedValue({
      success: true,
      message: 'Whitelisted successfully',
      item: {
        id: 'alw-new',
        address: '203.0.113.100',
        reason: 'Office static IP',
        createdAt: '2026-09-15T12:00:00Z',
      },
    });

    render(<AllowedIpsView />);

    await waitFor(() => {
      expect(screen.getByText('10.50.0.1')).toBeInTheDocument();
    });

    const openAddBtn = screen.getByRole('button', { name: /Add Whitelisted IP/i });
    await user.click(openAddBtn);

    expect(screen.getByText('Whitelist an IP Address or CIDR')).toBeInTheDocument();

    const ipInput = screen.getByPlaceholderText(/e\.g\. 203\.0\.113\.15/i);
    await user.type(ipInput, '203.0.113.100');

    const submitBtn = screen.getByRole('button', { name: /^Add to Whitelist$/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(api.addAllowedIp).toHaveBeenCalledWith({
        address: '203.0.113.100',
        reason: 'Whitelisted by administrator',
      });
    });
  });
});
