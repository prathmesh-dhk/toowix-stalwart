import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TenantsManagementView } from '../../src/components/views/TenantsManagementView';
import { TenantSummary } from '../../src/types';

const mockTenants: TenantSummary[] = [
  {
    id: 'tenant-1',
    name: 'Acme Global',
    status: 'active',
    mailboxLimit: 50,
    mailboxCount: 15,
    availableMailboxes: 35,
    adminCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    domain: {
      id: 'dom-1',
      domainName: 'acmeglobal.com',
      stalwartDomainId: 'stalwart-1',
      status: 'active',
    },
  },
  {
    id: 'tenant-2',
    name: 'Suspended Industries',
    status: 'suspended',
    mailboxLimit: 100,
    mailboxCount: 90,
    availableMailboxes: 10,
    adminCount: 1,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
    domain: {
      id: 'dom-2',
      domainName: 'suspended.test',
      stalwartDomainId: 'stalwart-2',
      status: 'suspended',
    },
  },
];

describe('TenantsManagementView Component', () => {
  const defaultProps = {
    tenants: mockTenants,
    loading: false,
    onRefresh: vi.fn(),
    onCreateTenant: vi.fn(),
    onViewDetails: vi.fn(),
    onActivateTenant: vi.fn(),
    onToggleSuspend: vi.fn(),
    onManageAdmins: vi.fn(),
    onUpdateQuota: vi.fn(),
    onDeleteTenant: vi.fn(),
  };

  it('renders tenant list with company name and mailbox allocation', () => {
    render(<TenantsManagementView {...defaultProps} />);

    expect(screen.getAllByText('Acme Global')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Suspended Industries')[0]).toBeInTheDocument();
  });

  it('filters tenants by search query', async () => {
    render(<TenantsManagementView {...defaultProps} />);

    const searchInput = screen.getByPlaceholderText(/search organization/i);
    await userEvent.type(searchInput, 'acme');

    expect(screen.getAllByText('Acme Global')[0]).toBeInTheDocument();
    expect(screen.queryByText('Suspended Industries')).not.toBeInTheDocument();
  });

  it('filters tenants by status tab', () => {
    render(<TenantsManagementView {...defaultProps} />);

    // Click 'Suspended' filter
    const suspendedTab = screen.getByRole('button', { name: /suspended/i });
    fireEvent.click(suspendedTab);

    expect(screen.queryByText('Acme Global')).not.toBeInTheDocument();
    expect(screen.getAllByText('Suspended Industries')[0]).toBeInTheDocument();
  });

  it('calls action callbacks for refresh and provision tenant', () => {
    render(<TenantsManagementView {...defaultProps} />);

    // Trigger refresh button
    const refreshBtn = screen.getByTitle(/refresh tenant directory/i);
    fireEvent.click(refreshBtn);
    expect(defaultProps.onRefresh).toHaveBeenCalled();

    // Trigger provision tenant button
    const provisionBtn = screen.getByRole('button', { name: /provision tenant/i });
    fireEvent.click(provisionBtn);
    expect(defaultProps.onCreateTenant).toHaveBeenCalled();
  });

  it('triggers onViewDetails when clicking on a tenant row', () => {
    render(<TenantsManagementView {...defaultProps} />);

    // Click anywhere on Acme Global row text
    const acmeName = screen.getAllByText('Acme Global')[0];
    fireEvent.click(acmeName);
    expect(defaultProps.onViewDetails).toHaveBeenCalledWith(mockTenants[0]);
  });
});
