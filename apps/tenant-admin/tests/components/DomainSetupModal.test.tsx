import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DomainSetupModal } from '../../src/components/DomainSetupModal';
import { api } from '../../src/api';

vi.mock('../../src/api', () => ({
  api: {
    createTenantDomain: vi.fn(),
    connectGoDaddyCredential: vi.fn(),
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

  it('creates an unprovisioned domain, then connects GoDaddy before finishing', async () => {
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
    vi.mocked(api.connectGoDaddyCredential).mockResolvedValueOnce({
      success: true,
      verifiedGoDaddyDomain: 'newbrand.io',
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

    // Step 2: Connect GoDaddy — domain is not yet provisioned
    expect(await screen.findByText('Connect GoDaddy')).toBeInTheDocument();
    expect(screen.getByText(/not yet activated/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/GoDaddy API Key/i), 'test-key');
    await userEvent.type(screen.getByLabelText(/GoDaddy API Secret/i), 'test-secret');
    await userEvent.click(screen.getByRole('button', { name: /verify & connect/i }));

    expect(api.connectGoDaddyCredential).toHaveBeenCalledWith('dom-new-1', 'test-key', 'test-secret');
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
});
