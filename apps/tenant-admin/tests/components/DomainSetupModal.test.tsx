import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DomainSetupModal } from '../../src/components/DomainSetupModal';
import { api } from '../../src/api';

vi.mock('../../src/api', () => ({
  api: {
    createTenantDomain: vi.fn(),
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

  it('provisions domain with selected tier and transitions to DNS records screen', async () => {
    const onClose = vi.fn();
    const onDomainAdded = vi.fn();

    vi.mocked(api.createTenantDomain).mockResolvedValueOnce({
      success: true,
      domain: {
        id: 'dom-new-1',
        domainName: 'newbrand.io',
        status: 'active',
        mailboxLimit: 25,
        employeeCount: 25,
        mailboxCount: 0,
        isPrimary: false,
      },
      dnsRecords: [
        {
          type: 'MX',
          name: '@',
          target: 'mail.newbrand.io',
          priority: '10',
          desc: 'Primary Mail Routing Exchange',
        },
        {
          type: 'TXT',
          name: '@',
          target: 'v=spf1 mx include:relay.toowix.net ~all',
          priority: 'TTL 3600',
          desc: 'Sender Policy Framework (SPF)',
        },
      ],
    });

    render(<DomainSetupModal isOpen={true} onClose={onClose} onDomainAdded={onDomainAdded} />);

    // Enter domain name
    const input = screen.getByPlaceholderText(/acme-tech\.com/i);
    await userEvent.type(input, 'newbrand.io');

    // Select 25 Seats
    await userEvent.click(screen.getByText('25 Seats'));

    // Submit wizard
    const submitBtn = screen.getByRole('button', { name: /create & get dns records/i });
    await userEvent.click(submitBtn);

    expect(api.createTenantDomain).toHaveBeenCalledWith({
      domainName: 'newbrand.io',
      employeeTier: 25,
    });

    // Step 2: DNS Records screen
    expect(await screen.findByText('Domain DNS Configuration')).toBeInTheDocument();
    expect(screen.getByText('mail.newbrand.io')).toBeInTheDocument();
    expect(screen.getByText('v=spf1 mx include:relay.toowix.net ~all')).toBeInTheDocument();

    // Complete setup
    const completeBtn = screen.getByRole('button', { name: /complete setup & switch to domain/i });
    await userEvent.click(completeBtn);

    expect(onDomainAdded).toHaveBeenCalledWith(
      expect.objectContaining({
        domainName: 'newbrand.io',
        mailboxLimit: 25,
      })
    );
    expect(onClose).toHaveBeenCalled();
  });
});
