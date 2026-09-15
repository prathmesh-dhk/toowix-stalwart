import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DomainActivationModal } from '../../src/components/modals/DomainActivationModal';
import { api } from '../../src/api';
import { TenantSummary, TenantDomainSummary } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getDomainDnsStatus: vi.fn(),
    activateDomainDns: vi.fn(),
    retryVerifyDomainDns: vi.fn(),
  },
}));

const mockTenant: TenantSummary = {
  id: 'tenant-1',
  name: 'Acme Corp',
  status: 'active',
  mailboxLimit: 50,
  mailboxCount: 2,
  availableMailboxes: 48,
  adminCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  domain: { id: 'dom-1', domainName: 'acme.com', stalwartDomainId: null, status: 'active' },
};

const mockDomain: TenantDomainSummary = {
  id: 'dom-1',
  domainName: 'acme.com',
  status: 'active',
  isPrimary: true,
  dnsStatus: 'not_started',
};

describe('DomainActivationModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
  });

  it('shows the manual zone file section with Copy and Export buttons once Stalwart has provisioned the domain', async () => {
    vi.mocked(api.getDomainDnsStatus).mockResolvedValue({
      dnsStatus: 'activating',
      dnsRecords: [{ type: 'MX', name: '@', value: 'mail.toowix.com', priority: 10, ttl: 3600, purpose: 'Primary Mail Routing Exchange' }],
      dnsConflicts: [],
      dnsZoneFile: 'acme.com. IN MX 10 mail.toowix.com.\nacme.com. IN TXT "v=spf1 mx ~all"',
    });

    render(
      <DomainActivationModal tenant={mockTenant} domain={mockDomain} isOpen={true} onClose={vi.fn()} />
    );

    expect(await screen.findByText('Manual Setup — Raw DNS Zone File')).toBeInTheDocument();
    expect(screen.getAllByText(/mail\.toowix\.com/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /^copy$/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /export \.txt/i })).toBeInTheDocument();
  });

  it('copies the zone file text to the clipboard when Copy is clicked', async () => {
    vi.mocked(api.getDomainDnsStatus).mockResolvedValue({
      dnsStatus: 'activating',
      dnsRecords: [],
      dnsConflicts: [],
      dnsZoneFile: 'acme.com. IN MX 10 mail.toowix.com.',
    });

    render(
      <DomainActivationModal tenant={mockTenant} domain={mockDomain} isOpen={true} onClose={vi.fn()} />
    );

    await screen.findByText('Manual Setup — Raw DNS Zone File');
    await userEvent.click(screen.getByRole('button', { name: /^copy$/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('acme.com. IN MX 10 mail.toowix.com.');
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('does not render the manual zone file section before Stalwart has provisioned the domain', async () => {
    vi.mocked(api.getDomainDnsStatus).mockResolvedValue({
      dnsStatus: 'not_started',
      dnsRecords: [],
      dnsConflicts: [],
      dnsZoneFile: null,
    });

    render(
      <DomainActivationModal tenant={mockTenant} domain={mockDomain} isOpen={true} onClose={vi.fn()} />
    );

    await waitFor(() => expect(api.getDomainDnsStatus).toHaveBeenCalled());
    expect(screen.queryByText('Manual Setup — Raw DNS Zone File')).not.toBeInTheDocument();
  });

  it('allows activating a domain with no DNS provider connected (manual mode) without an error', async () => {
    vi.mocked(api.getDomainDnsStatus).mockResolvedValue({
      dnsStatus: 'not_started',
      dnsRecords: [],
      dnsConflicts: [],
      dnsZoneFile: null,
    });
    vi.mocked(api.activateDomainDns).mockResolvedValue({
      success: true,
      dnsStatus: 'activating',
      dnsRecords: [{ type: 'MX', name: '@', value: 'mail.toowix.com', priority: 10, ttl: 3600, purpose: 'MX' }],
      dnsConflicts: [],
      dnsZoneFile: 'acme.com. IN MX 10 mail.toowix.com.',
    });

    render(
      <DomainActivationModal tenant={mockTenant} domain={mockDomain} isOpen={true} onClose={vi.fn()} />
    );

    await waitFor(() => expect(api.getDomainDnsStatus).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /activate domain/i }));

    await waitFor(() => expect(api.activateDomainDns).toHaveBeenCalledWith('tenant-1', 'dom-1'));
    expect(await screen.findByText('Manual Setup — Raw DNS Zone File')).toBeInTheDocument();
  });
});
