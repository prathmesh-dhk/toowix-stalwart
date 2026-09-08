import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TenantApplicationsView } from '../../src/components/views/TenantApplicationsView';
import { RegistrationApplication } from '../../src/types';

const mockApplications: RegistrationApplication[] = [
  {
    id: 'app-1',
    companyName: 'NextGen AI Inc',
    requestedDomain: 'nextgenai.tech',
    applicantName: 'Sarah Connor',
    contactEmail: 'sarah@nextgenai.tech',
    employeeCount: '10 – 99',
    region: 'United States (us-central1)',
    notes: 'Urgent onboarding',
    status: 'PENDING_REVIEW',
    submittedAt: '2026-03-01T10:00:00.000Z',
  },
  {
    id: 'app-2',
    companyName: 'Cyberdyne Systems',
    requestedDomain: 'cyberdyne.net',
    applicantName: 'Miles Dyson',
    contactEmail: 'miles@cyberdyne.net',
    employeeCount: '100 – 499',
    region: 'United States (us-central1)',
    notes: 'Defense contractor',
    status: 'APPROVED',
    submittedAt: '2026-02-15T12:00:00.000Z',
  },
];

describe('TenantApplicationsView Component', () => {
  const defaultProps = {
    applications: mockApplications,
    loading: false,
    onRefresh: vi.fn(),
    onReviewApplication: vi.fn(),
  };

  it('renders pending applications by default', () => {
    render(<TenantApplicationsView {...defaultProps} />);

    expect(screen.getByText('NextGen AI Inc')).toBeInTheDocument();
    expect(screen.getByText('nextgenai.tech')).toBeInTheDocument();
    expect(screen.getByText('Sarah Connor')).toBeInTheDocument();

    // Cyberdyne is APPROVED, so not visible under PENDING_REVIEW filter
    expect(screen.queryByText('Cyberdyne Systems')).not.toBeInTheDocument();
  });

  it('switches tabs to show approved applications', () => {
    render(<TenantApplicationsView {...defaultProps} />);

    const approvedTab = screen.getByRole('button', { name: /approved/i });
    fireEvent.click(approvedTab);

    expect(screen.getByText('Cyberdyne Systems')).toBeInTheDocument();
    expect(screen.queryByText('NextGen AI Inc')).not.toBeInTheDocument();
  });

  it('triggers onReviewApplication when clicking review action', () => {
    render(<TenantApplicationsView {...defaultProps} />);

    const reviewBtn = screen.getByRole('button', { name: /review application/i });
    fireEvent.click(reviewBtn);

    expect(defaultProps.onReviewApplication).toHaveBeenCalledWith(mockApplications[0]);
  });
});
