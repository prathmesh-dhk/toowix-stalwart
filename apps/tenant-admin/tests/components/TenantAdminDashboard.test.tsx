import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
    deleteMailbox: vi.fn(),
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

    vi.mocked(api.getAuditLogs).mockResolvedValue({ logs: [], limit: 50, offset: 0 });
  });

  it('renders tenant overview with domain, quota stats, and mailbox count', async () => {
    render(<TenantAdminDashboard user={mockUser} onLogout={onLogout} />);

    expect(await screen.findByText('Admin Overview')).toBeInTheDocument();
    expect(screen.getAllByText(/@acmecorp\.com/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/48 available for assignment/i)).toBeInTheDocument();
    expect(screen.getByText('Operational Health')).toBeInTheDocument();
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

    render(<TenantAdminDashboard user={mockUser} onLogout={onLogout} />);

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

    render(<TenantAdminDashboard user={mockUser} onLogout={onLogout} />);
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

  it('displays quota exceeded error when mailbox limit reached', async () => {
    vi.mocked(api.createMailbox).mockRejectedValueOnce(
      new Error('Mailbox limit of 50 reached for tenant')
    );

    render(<TenantAdminDashboard user={mockUser} onLogout={onLogout} />);
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
});
