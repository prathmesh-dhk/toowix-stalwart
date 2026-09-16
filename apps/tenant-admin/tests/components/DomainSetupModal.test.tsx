import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DomainSetupModal } from '../../src/components/DomainSetupModal';
import { api } from '../../src/api';

vi.mock('../../src/api', () => ({
  api: {
    createTenantDomain: vi.fn(),
    connectDnsProviderCredential: vi.fn(),
    getDomainDnsStatus: vi.fn(),
  },
}));

describe('DomainSetupModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText: vi.fn() } });
    vi.mocked(api.getDomainDnsStatus).mockResolvedValue({
      dnsStatus: 'not_started',
      dnsRecords: [],
      dnsConflicts: [],
      dnsZoneFile: null,
    });
  });

  it('renders domain input and discrete employee tiers (1, 10, 25, 50, 75, 100)', () => {
    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    expect(screen.getByText('Add New Domain')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/acme-tech\.com/i)).toBeInTheDocument();

    // Verify all 6 discrete employee tiers
    expect(screen.getByText('1 Seat')).toBeInTheDocument();
    expect(screen.getByText('10 Seats')).toBeInTheDocument();
    expect(screen.getByText('25 Seats')).toBeInTheDocument();
    expect(screen.getByText('50 Seats')).toBeInTheDocument();
    expect(screen.getByText('75 Seats')).toBeInTheDocument();
    expect(screen.getByText('100 Seats')).toBeInTheDocument();
  });

  it('creates an unprovisioned domain, then connects GoDaddy (default provider) before finishing', async () => {
    const onClose = vi.fn();
    const onDomainAdded = vi.fn();

    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-new-1',
        domainName: 'newbrand.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 25,
        employeeCount: 25,
        mailboxCount: 0,
        isPrimary: false,
      },
    });
    vi.mocked(api.connectDnsProviderCredential).mockResolvedValueOnce({
      success: true,
      verifiedProviderDomain: 'newbrand.io',
      connectedAt: new Date().toISOString(),
    });

    render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={onDomainAdded} />);

    // Step 1: domain details
    const input = screen.getByPlaceholderText(/acme-tech\.com/i);
    await userEvent.type(input, 'newbrand.io');
    await userEvent.click(screen.getByText('25 Seats'));
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(api.createTenantDomain).toHaveBeenCalledWith({
      domainName: 'newbrand.io',
      employeeTier: 25,
    });

    // Step 2: choose setup method
    expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Connect a DNS Provider'));

    // Step 3: GoDaddy selected by default
    expect(await screen.findByText(/^Connect GoDaddy$/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/GoDaddy API Key/i), 'test-key');
    await userEvent.type(screen.getByLabelText(/GoDaddy API Secret/i), 'test-secret');
    await userEvent.click(screen.getByRole('button', { name: /verify & connect/i }));

    expect(api.connectDnsProviderCredential).toHaveBeenCalledWith('dom-new-1', {
      provider: 'godaddy',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });
    expect(await screen.findByText(/GoDaddy connected and verified/i)).toBeInTheDocument();

    // Step 4: status
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));
    expect(await screen.findByText('DNS Setup — newbrand.io')).toBeInTheDocument();

    const completeBtn = screen.getByRole('button', { name: /^done$/i });
    await userEvent.click(completeBtn);

    expect(onDomainAdded).toHaveBeenCalledWith(
      expect.objectContaining({
        domainName: 'newbrand.io',
        mailboxLimit: 25,
        dnsStatus: 'not_started',
      })
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('switches to Hostinger and connects with a single API token', async () => {
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-new-2',
        domainName: 'otherbrand.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 10,
        employeeCount: 10,
        mailboxCount: 0,
        isPrimary: false,
      },
    });
    vi.mocked(api.connectDnsProviderCredential).mockResolvedValueOnce({
      success: true,
      verifiedProviderDomain: 'otherbrand.io',
      connectedAt: new Date().toISOString(),
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/acme-tech\.com/i), 'otherbrand.io');
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Connect a DNS Provider'));

    await userEvent.click(screen.getByRole('button', { name: /^hostinger$/i }));
    await userEvent.type(screen.getByLabelText(/Hostinger API Token/i), 'hostinger-tok');
    await userEvent.click(screen.getByRole('button', { name: /verify & connect/i }));

    expect(api.connectDnsProviderCredential).toHaveBeenCalledWith('dom-new-2', {
      provider: 'hostinger',
      token: 'hostinger-tok',
    });
    expect(await screen.findByText(/Hostinger connected and verified/i)).toBeInTheDocument();
  });

  it('switches to Cloudflare and connects with a single API token', async () => {
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-new-3',
        domainName: 'thirdbrand.dev',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 10,
        employeeCount: 10,
        mailboxCount: 0,
        isPrimary: false,
      },
    });
    vi.mocked(api.connectDnsProviderCredential).mockResolvedValueOnce({
      success: true,
      verifiedProviderDomain: 'thirdbrand.dev',
      connectedAt: new Date().toISOString(),
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/acme-tech\.com/i), 'thirdbrand.dev');
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Connect a DNS Provider'));

    await userEvent.click(screen.getByRole('button', { name: /^cloudflare$/i }));
    await userEvent.type(screen.getByLabelText(/Cloudflare API Token/i), 'cf-tok');
    await userEvent.click(screen.getByRole('button', { name: /verify & connect/i }));

    expect(api.connectDnsProviderCredential).toHaveBeenCalledWith('dom-new-3', {
      provider: 'cloudflare',
      token: 'cf-tok',
    });
    expect(await screen.findByText(/Cloudflare connected and verified/i)).toBeInTheDocument();
  });

  it('supports the manual DNS setup path with no credential, showing records and zone file', async () => {
    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-new-4',
        domainName: 'manualbrand.io',
        status: 'active',
        dnsStatus: 'not_started',
        mailboxLimit: 10,
        employeeCount: 10,
        mailboxCount: 0,
        isPrimary: false,
      },
    });
    vi.mocked(api.getDomainDnsStatus).mockResolvedValue({
      dnsStatus: 'activating',
      dnsRecords: [{ type: 'MX', name: '@', value: 'mail.toowix.com', priority: 10, ttl: 3600, purpose: 'MX' }],
      dnsConflicts: [],
      dnsZoneFile: 'manualbrand.io. IN MX 10 mail.toowix.com.',
    });

    render(<DomainSetupModal isOpen={true} onClose={vi.fn()} onDomainAdded={vi.fn()} />);

    await userEvent.type(screen.getByPlaceholderText(/acme-tech\.com/i), 'manualbrand.io');
    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(await screen.findByText('How do you want to set up DNS?')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Manual DNS Setup'));

    expect(await screen.findByText('No credential required')).toBeInTheDocument();
    expect(api.connectDnsProviderCredential).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /^continue$/i }));

    expect(await screen.findByText('DNS Setup — manualbrand.io')).toBeInTheDocument();
    expect(await screen.findByText('Required Records')).toBeInTheDocument();
    expect(screen.getByText('Zone File')).toBeInTheDocument();
  });
});
