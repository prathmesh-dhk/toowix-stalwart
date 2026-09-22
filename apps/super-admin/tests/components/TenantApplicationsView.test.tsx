import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TenantApplicationsView } from '../../src/components/views/TenantApplicationsView';
import { RegistrationApplication } from '../../src/types';

const mockApplications: RegistrationApplication[] = [
  {
    _id: 'app-1',
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
    createdAt: '2026-03-01T10:00:00.000Z',
    updatedAt: '2026-03-01T10:00:00.000Z',
  },
  {
    _id: 'app-2',
    id: 'app-2',
    companyName: 'Cyberdyne Systems',
    requestedDomain: 'cyberdyne.net',
    applicantName: 'Miles Dyson',
    contactEmail: 'miles@cyberdyne.net',
    employeeCount: '100 – 499',
    region: 'United States (us-central1)',
    notes: 'Defense contractor',
    status: 'REJECTED',
    submittedAt: '2026-02-15T12:00:00.000Z',
    createdAt: '2026-02-15T12:00:00.000Z',
    updatedAt: '2026-02-15T12:00:00.000Z',
  },
  {
    _id: 'app-3',
    id: 'app-3',
    companyName: 'Wayne Enterprises',
    requestedDomain: 'waynecorp.com',
    applicantName: 'Bruce Wayne',
    contactEmail: 'bruce@waynecorp.com',
    status: 'APPROVED',
    tenantId: 'tenant-wayne-1',
    submittedAt: '2026-03-05T10:00:00.000Z',
    createdAt: '2026-03-05T10:00:00.000Z',
    updatedAt: '2026-03-05T10:00:00.000Z',
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
    expect(screen.getByText('sarah@nextgenai.tech')).toBeInTheDocument();

    // Cyberdyne is REJECTED, so not visible under PENDING_REVIEW filter
    expect(screen.queryByText('Cyberdyne Systems')).not.toBeInTheDocument();
  });

  it('switches tabs to show approved applications without Existing Org tag', () => {
    render(<TenantApplicationsView {...defaultProps} />);

    const approvedTab = screen.getByRole('button', { name: /approved/i });
    fireEvent.click(approvedTab);

    expect(screen.getByText('Wayne Enterprises')).toBeInTheDocument();
    expect(screen.getByText('waynecorp.com')).toBeInTheDocument();
    expect(screen.getByText('bruce@waynecorp.com')).toBeInTheDocument();
    expect(screen.queryByText('Existing Org')).not.toBeInTheDocument();
    expect(screen.queryByText('NextGen AI Inc')).not.toBeInTheDocument();
  });

  it('switches tabs to show rejected applications', () => {
    render(<TenantApplicationsView {...defaultProps} />);

    const rejectedTab = screen.getByRole('button', { name: /rejected/i });
    fireEvent.click(rejectedTab);

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
