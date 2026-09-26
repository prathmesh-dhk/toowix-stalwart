import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnalyticsView } from '../../src/components/views/AnalyticsView';
import { PlatformAnalytics } from '../../src/types';

const mockAnalytics: PlatformAnalytics = {
  generatedAt: new Date().toISOString(),
  stalwartReachable: true,
  snapshot: {
    totalMailboxes: 10,
    activeMailboxes: 10,
    suspendedMailboxes: 0,
    totalTenants: 8,
    activeTenants: 7,
    suspendedTenants: 1,
    totalDomains: 8,
    platform: {
      totalStorageBytes: 258888000,
      avgStoragePerMailboxBytes: 25888800,
      totalEmailsSent: 15,
      totalEmailsInbox: 45,
      totalEmails: 60,
    },
  },
  perTenant: [
    {
      tenantId: 'tenant-1',
      tenantName: 'Apple',
      domainName: 'xyz.com',
      status: 'active',
      mailboxCount: 2,
      mailboxLimit: 10,
      utilizationPct: 20,
      storageBytes: 129444000,
      emailsSent: 10,
      emailsInbox: 20,
      totalEmails: 30,
      topMailboxes: [{ address: 'demo@xyz.com', storageBytes: 129444000, emailsSent: 10 }],
    },
    {
      tenantId: 'tenant-2',
      tenantName: 'Acme Global Inc.',
      domainName: 'mail.com',
      status: 'active',
      mailboxCount: 3,
      mailboxLimit: 50,
      utilizationPct: 6,
      storageBytes: 4000,
      emailsSent: 5,
      emailsInbox: 25,
      totalEmails: 30,
      topMailboxes: [{ address: 'mm@mail.com', storageBytes: 4000, emailsSent: 5 }],
    },
  ],
  topStorageConsumers: [
    {
      address: 'demo@xyz.com',
      tenantName: 'Apple',
      storageBytes: 129444000,
      emailsSent: 10,
    },
  ],
  auditSummary: {
    last30Days: {
      total: 100,
      logins: 50,
      mailboxEvents: 30,
      tenantLifecycle: 10,
      securityEvents: 10,
    },
  },
};

describe('AnalyticsView Component', () => {
  it('renders clean page title and 3 core summary metrics without AI slop', () => {
    render(<AnalyticsView data={mockAnalytics} loading={false} onRefresh={vi.fn()} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Analytics' })).toBeInTheDocument();
    expect(screen.getByText('Total Storage Used')).toBeInTheDocument();
    expect(screen.getByText('Active Mailboxes')).toBeInTheDocument();
    expect(screen.getByText('Active Organizations')).toBeInTheDocument();

    // Verify values appear
    expect(screen.getByText('10 total accounts provisioned')).toBeInTheDocument();
  });

  it('renders tenant usage table and filters by search term', () => {
    render(<AnalyticsView data={mockAnalytics} loading={false} onRefresh={vi.fn()} />);

    expect(screen.getByText('Tenant Usage & Quotas')).toBeInTheDocument();
    expect(screen.getAllByText('Apple').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Acme Global Inc.')[0]).toBeInTheDocument();

    // Search for "Apple"
    const searchInput = screen.getByPlaceholderText('Search tenants or domains...');
    fireEvent.change(searchInput, { target: { value: 'Apple' } });

    expect(screen.getAllByText('Apple').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('Acme Global Inc.')).not.toBeInTheDocument();
  });

  it('triggers onRefresh when clicking the Refresh button', () => {
    const onRefresh = vi.fn();
    render(<AnalyticsView data={mockAnalytics} loading={false} onRefresh={onRefresh} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders the Top Mailboxes table when top consumers exist', () => {
    render(<AnalyticsView data={mockAnalytics} loading={false} onRefresh={vi.fn()} />);

    expect(screen.getByText('Top Mailboxes by Storage')).toBeInTheDocument();
    expect(screen.getAllByText('demo@xyz.com')[0]).toBeInTheDocument();
  });
});
