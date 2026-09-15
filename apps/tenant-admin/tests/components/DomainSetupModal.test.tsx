import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DomainSetupModal } from '../../src/components/DomainSetupModal';
import { api } from '../../src/api';

vi.mock('../../src/api', () => ({
  api: {
    createTenantDomain: vi.fn(),
    connectDnsProviderCredential: vi.fn(),
  },
}));

describe('DomainSetupModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    // Enter domain name
    const input = screen.getByPlaceholderText(/acme-tech\.com/i);
    await userEvent.type(input, 'newbrand.io');

    // Select 25 Seats
    await userEvent.click(screen.getByText('25 Seats'));

    // Submit wizard
    const submitBtn = screen.getByRole('button', { name: /create domain/i });
    await userEvent.click(submitBtn);

    expect(api.createTenantDomain).toHaveBeenCalledWith({
      domainName: 'newbrand.io',
      employeeTier: 25,
    });

    // Step 2: Connect DNS Provider — domain is not yet provisioned, GoDaddy selected by default
    expect(await screen.findByText('Connect DNS Provider')).toBeInTheDocument();
    expect(screen.getByText(/not yet activated/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/GoDaddy API Key/i), 'test-key');
    await userEvent.type(screen.getByLabelText(/GoDaddy API Secret/i), 'test-secret');
    await userEvent.click(screen.getByRole('button', { name: /verify & connect/i }));

    expect(api.connectDnsProviderCredential).toHaveBeenCalledWith('dom-new-1', {
      provider: 'godaddy',
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });
    expect(await screen.findByText(/GoDaddy connected and verified/i)).toBeInTheDocument();

    // Complete setup
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
    const onClose = vi.fn();
    const onDomainAdded = vi.fn();

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

    render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={onDomainAdded} />);

    await userEvent.type(screen.getByPlaceholderText(/acme-tech\.com/i), 'otherbrand.io');
    await userEvent.click(screen.getByRole('button', { name: /create domain/i }));

    expect(await screen.findByText('Connect DNS Provider')).toBeInTheDocument();
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
    const onClose = vi.fn();
    const onDomainAdded = vi.fn();

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

    render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={onDomainAdded} />);

    await userEvent.type(screen.getByPlaceholderText(/acme-tech\.com/i), 'thirdbrand.dev');
    await userEvent.click(screen.getByRole('button', { name: /create domain/i }));

    expect(await screen.findByText('Connect DNS Provider')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^cloudflare$/i }));

    await userEvent.type(screen.getByLabelText(/Cloudflare API Token/i), 'cf-tok');
    await userEvent.click(screen.getByRole('button', { name: /verify & connect/i }));

    expect(api.connectDnsProviderCredential).toHaveBeenCalledWith('dom-new-3', {
      provider: 'cloudflare',
      token: 'cf-tok',
    });
    expect(await screen.findByText(/Cloudflare connected and verified/i)).toBeInTheDocument();
  });
});
