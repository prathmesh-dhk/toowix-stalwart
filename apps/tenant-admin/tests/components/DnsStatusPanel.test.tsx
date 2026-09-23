import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DnsStatusPanel } from '../../src/components/DnsStatusPanel';
import { DomainDnsStatus } from '../../src/types';

describe('DnsStatusPanel Component', () => {
  const defaultProps = {
    domainName: 'example.com',
    status: null,
    loading: false,
    onRefresh: vi.fn(),
  };

  it('renders not_started state without referencing Super Admin', () => {
    render(<DnsStatusPanel {...defaultProps} status={{ dnsStatus: 'not_started', dnsRecords: [], dnsConflicts: [] }} />);

    expect(screen.getByText('Not Started')).toBeInTheDocument();
    expect(screen.getByText(/Mailbox creation unlocks when DNS activation completes/i)).toBeInTheDocument();
    expect(screen.queryByText(/super admin/i)).not.toBeInTheDocument();
  });

  it('renders activating state and does not mention Super Admin', () => {
    render(<DnsStatusPanel {...defaultProps} status={{ dnsStatus: 'activating', dnsRecords: [], dnsConflicts: [] }} />);

    expect(screen.getByText('Activating')).toBeInTheDocument();
    expect(screen.getByText(/propagation is checked automatically/i)).toBeInTheDocument();
    expect(screen.queryByText(/super admin/i)).not.toBeInTheDocument();
  });

  it('renders conflict state with Retry / Verify button and calls onRetryVerification', () => {
    const onRetry = vi.fn();
    const status: DomainDnsStatus = {
      dnsStatus: 'conflict',
      dnsRecords: [],
      dnsConflicts: [{ type: 'MX', name: 'example.com', foundValue: 'mail.oldserver.com' }],
    };

    render(<DnsStatusPanel {...defaultProps} status={status} onRetryVerification={onRetry} />);

    expect(screen.getByText('Conflict')).toBeInTheDocument();
    expect(screen.getByText(/Existing conflicting DNS records found/i)).toBeInTheDocument();
    expect(screen.queryByText(/super admin/i)).not.toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry \/ verify/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders activation_failed state with Retry / Verify button', () => {
    const onRetry = vi.fn();
    const status: DomainDnsStatus = {
      dnsStatus: 'activation_failed',
      dnsRecords: [],
      dnsConflicts: [],
    };

    render(<DnsStatusPanel {...defaultProps} status={status} onRetryVerification={onRetry} />);

    expect(screen.getByText('Activation Failed')).toBeInTheDocument();
    expect(screen.getByText(/DNS propagation did not complete within the allowed window/i)).toBeInTheDocument();
    expect(screen.queryByText(/super admin/i)).not.toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry \/ verify/i });
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders active state successfully', () => {
    const status: DomainDnsStatus = {
      dnsStatus: 'active',
      dnsRecords: [],
      dnsConflicts: [],
    };

    render(<DnsStatusPanel {...defaultProps} status={status} />);

    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/Domain is fully active\. Mail service is live\./i)).toBeInTheDocument();
  });

  it('omits active status banner in manual DNS setup mode and renders missing records view', () => {
    const status: DomainDnsStatus = {
      dnsStatus: 'active',
      dnsRecords: [
        { type: 'MX', name: '@', value: 'mail.toowix.com', priority: 10, purpose: 'Mail routing' },
        { type: 'TXT', name: '@', value: 'v=spf1 include:mail.toowix.com ~all', purpose: 'SPF verification' },
      ],
      dnsConflicts: [],
    };

    const liveCheck = {
      allFound: false,
      checkedAt: new Date().toISOString(),
      results: [
        { type: 'MX', name: '@', expectedValue: 'mail.toowix.com', purpose: 'Mail routing', found: true },
        { type: 'TXT', name: '@', expectedValue: 'v=spf1 include:mail.toowix.com ~all', purpose: 'SPF verification', found: false },
      ],
    };

    const onCheck = vi.fn();

    render(
      <DnsStatusPanel
        {...defaultProps}
        status={status}
        liveCheck={liveCheck}
        onCheckRecords={onCheck}
        isManualSetup={true}
      />
    );

    // Should NOT show the premature "Domain is fully active" box in manual setup
    expect(screen.queryByText(/Domain is fully active\. Mail service is live\./i)).not.toBeInTheDocument();
    expect(screen.getByText('DNS Activation Status')).toBeInTheDocument();

    // Should clearly show the missing records
    expect(screen.getByText(/1 Missing DNS Record Detected/i)).toBeInTheDocument();
    expect(screen.getByText('Missing')).toBeInTheDocument();
    expect(screen.getByText('Detected')).toBeInTheDocument();
    expect(screen.getByText('Re-scan DNS')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Re-scan DNS'));
    expect(onCheck).toHaveBeenCalled();
  });
});
