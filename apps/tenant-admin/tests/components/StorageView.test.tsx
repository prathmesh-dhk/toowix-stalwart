import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StorageView } from '../../src/components/StorageView';
import { api } from '../../src/api';
import { DomainItem, TenantStorageResponse } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getStorageUsage: vi.fn(),
  },
}));

const mockDomain: DomainItem = {
  id: 'dom-1',
  domainName: 'acmecorp.com',
  status: 'active',
  mailboxLimit: 10,
  employeeCount: 10,
  mailboxCount: 2,
  isPrimary: true,
};

const mockStorageData: TenantStorageResponse = {
  summary: {
    totalStorageBytes: 134217728, // 128 MB
    totalStorageFormatted: '128.0 MB',
    mailboxCount: 2,
    mailboxesWithData: 2,
  },
  mailboxes: [
    {
      id: 'mb-1',
      address: 'alice@acmecorp.com',
      localPart: 'alice',
      domainId: 'dom-1',
      domainName: 'acmecorp.com',
      storageBytes: 104857600, // 100 MB
      storageFormatted: '100.0 MB',
      percentage: 78.1,
      status: 'active',
      createdAt: '2026-09-01T10:00:00Z',
    },
    {
      id: 'mb-2',
      address: 'bob@acmecorp.com',
      localPart: 'bob',
      domainId: 'dom-1',
      domainName: 'acmecorp.com',
      storageBytes: 29360128, // 28 MB
      storageFormatted: '28.0 MB',
      percentage: 21.9,
      status: 'active',
      createdAt: '2026-09-02T10:00:00Z',
    },
  ],
};

describe('StorageView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders storage metrics cards and mailboxes correctly', async () => {
    vi.mocked(api.getStorageUsage).mockResolvedValue(mockStorageData);

    render(<StorageView activeDomain={mockDomain} />);

    // Header & Summary Cards
    expect(await screen.findByRole('heading', { name: 'Storage' })).toBeInTheDocument();
    expect(screen.getByText('Total Storage Used')).toBeInTheDocument();
    expect(screen.getByTestId('total-storage-val')).toHaveTextContent('128.0 MB');
    expect(screen.getByTestId('mailbox-count-val')).toHaveTextContent('2');

    // Mailboxes in table
    expect(screen.getByText('alice@acmecorp.com')).toBeInTheDocument();
    expect(screen.getByText('bob@acmecorp.com')).toBeInTheDocument();
    expect(screen.getByText('100.0 MB')).toBeInTheDocument();
    expect(screen.getByText('28.0 MB')).toBeInTheDocument();
  });

  it('filters mailboxes when typing in the search input', async () => {
    vi.mocked(api.getStorageUsage).mockResolvedValue(mockStorageData);

    render(<StorageView activeDomain={mockDomain} />);

    expect(await screen.findByText('alice@acmecorp.com')).toBeInTheDocument();
    expect(screen.getByText('bob@acmecorp.com')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search mailboxes by address or prefix/i);
    fireEvent.change(searchInput, { target: { value: 'alice' } });

    expect(screen.getByText('alice@acmecorp.com')).toBeInTheDocument();
    expect(screen.queryByText('bob@acmecorp.com')).not.toBeInTheDocument();
  });

  it('re-fetches data when clicking the Refresh button', async () => {
    vi.mocked(api.getStorageUsage).mockResolvedValue(mockStorageData);

    render(<StorageView activeDomain={mockDomain} />);

    const refreshBtn = await screen.findByRole('button', { name: /Refresh/i });
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(api.getStorageUsage).toHaveBeenCalledTimes(2);
    });
  });

  it('renders empty state when no mailboxes exist', async () => {
    vi.mocked(api.getStorageUsage).mockResolvedValue({
      summary: {
        totalStorageBytes: 0,
        totalStorageFormatted: '0 B',
        mailboxCount: 0,
        mailboxesWithData: 0,
      },
      mailboxes: [],
    });

    render(<StorageView activeDomain={mockDomain} />);

    expect(await screen.findByText('No mailboxes found')).toBeInTheDocument();
  });
});
