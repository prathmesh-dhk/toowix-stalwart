import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApplicationReviewModal } from '../../src/components/modals/ApplicationReviewModal';
import { api } from '../../src/api';
import { RegistrationApplication } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getRegistrationApplication: vi.fn(),
    getDomainDnsStatus: vi.fn(),
    checkDomainDnsLive: vi.fn(),
    activateDomainDns: vi.fn(),
    retryVerifyDomainDns: vi.fn(),
  },
}));

const mockApp: RegistrationApplication = {
  _id: 'app-12345678',
  companyName: 'Acme Corp',
  requestedDomain: 'acme.com',
  applicantName: 'Alice Admin',
  contactEmail: 'alice@acme.com',
  status: 'PENDING_REVIEW',
  tenantId: 'tenant-123',
  domainId: 'domain-123',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('ApplicationReviewModal Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn() },
        configurable: true,
        writable: true,
      });
    } else {
      vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined as any);
    }
    vi.mocked(api.getRegistrationApplication).mockResolvedValue({ application: mockApp });
    vi.mocked(api.getDomainDnsStatus).mockResolvedValue({
      dnsStatus: 'not_started',
      dnsRecords: [],
      dnsConflicts: [],
      dnsZoneFile: 'acme.com. 3600 IN MX 10 mail.toowix.com.\nacme.com. 3600 IN TXT "v=spf1 mx ~all"',
    });
    vi.mocked(api.checkDomainDnsLive).mockResolvedValue({
      allFound: false,
      checkedAt: '2026-01-01T00:00:00.000Z',
      results: [
        { type: 'MX', name: '@', purpose: 'Mail Routing', expectedValue: '10 mail.toowix.com', found: false },
        { type: 'TXT', name: '@', purpose: 'SPF', expectedValue: 'v=spf1 mx ~all', found: false },
      ],
    });
  });

  it('renders application details and shows DNS readiness section for existing organisation domain', async () => {
    render(
      <ApplicationReviewModal
        application={mockApp}
        isOpen={true}
        onClose={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByText('Review Domain Application')).toBeInTheDocument();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('acme.com')).toBeInTheDocument();
    expect(screen.getByText('Existing Organisation')).toBeInTheDocument();

    await waitFor(() => {
      expect(api.getDomainDnsStatus).toHaveBeenCalledWith('tenant-123', 'domain-123');
      expect(api.checkDomainDnsLive).toHaveBeenCalledWith('tenant-123', 'domain-123');
    });

    expect(await screen.findByText('Tenant DNS Readiness')).toBeInTheDocument();
    expect(screen.getByText(/2 of 2 required records not detected yet/i)).toBeInTheDocument();
    expect(screen.getByText('Manual Setup — Raw DNS Zone File')).toBeInTheDocument();
  });

  it('copies raw DNS zone file to clipboard when Copy button is clicked', async () => {
    render(
      <ApplicationReviewModal
        application={mockApp}
        isOpen={true}
        onClose={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    await screen.findByText('Manual Setup — Raw DNS Zone File');
    await userEvent.click(screen.getByRole('button', { name: /^copy$/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('acme.com. 3600 IN MX 10 mail.toowix.com.')
    );
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('calls onApprove when Approve Application button is clicked', async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <ApplicationReviewModal
        application={mockApp}
        isOpen={true}
        onClose={onClose}
        onApprove={onApprove}
        onReject={vi.fn()}
      />
    );

    const approveBtn = screen.getByRole('button', { name: /approve application/i });
    await user.click(approveBtn);

    expect(onApprove).toHaveBeenCalledWith('app-12345678');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('handles reject workflow requiring a reason', async () => {
    const onReject = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <ApplicationReviewModal
        application={mockApp}
        isOpen={true}
        onClose={onClose}
        onApprove={vi.fn()}
        onReject={onReject}
      />
    );

    const rejectBtn = screen.getByRole('button', { name: /^reject$/i });
    await user.click(rejectBtn);

    expect(screen.getByLabelText(/reason for rejection/i)).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText(/state the reason for rejection/i);
    await user.type(textarea, 'Invalid verification documents provided');

    const confirmBtn = screen.getByRole('button', { name: /confirm rejection/i });
    await user.click(confirmBtn);

    expect(onReject).toHaveBeenCalledWith('app-12345678', 'Invalid verification documents provided');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('enables Activate Domain button when domain is approved and records are ready', async () => {
    const approvedApp: RegistrationApplication = {
      ...mockApp,
      status: 'APPROVED',
    };

    vi.mocked(api.getRegistrationApplication).mockResolvedValue({ application: approvedApp });
    vi.mocked(api.checkDomainDnsLive).mockResolvedValue({
      allFound: true,
      checkedAt: '2026-01-01T00:00:00.000Z',
      results: [],
    });
    vi.mocked(api.activateDomainDns).mockResolvedValue({
      dnsStatus: 'active',
      dnsRecords: [],
      dnsConflicts: [],
    });

    const user = userEvent.setup();

    render(
      <ApplicationReviewModal
        application={approvedApp}
        isOpen={true}
        onClose={vi.fn()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    await waitFor(() => expect(screen.getByText('All required DNS records are live publicly — ready to activate.')).toBeInTheDocument());

    const activateBtn = screen.getByRole('button', { name: /activate domain/i });
    expect(activateBtn).not.toBeDisabled();

    await user.click(activateBtn);
    expect(api.activateDomainDns).toHaveBeenCalledWith('tenant-123', 'domain-123');
  });
});
