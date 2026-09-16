import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { UpdateQuotaModal } from '../../src/components/modals/UpdateQuotaModal';
import { api } from '../../src/api';
import { TenantSummary } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    updateMailboxLimit: vi.fn().mockResolvedValue({ success: true }),
    listPlans: vi.fn().mockResolvedValue({ plans: [] }),
  },
}));

const mockTenant: TenantSummary = {
  id: 'tenant-apple',
  name: 'Apple',
  status: 'active',
  mailboxLimit: 50,
  mailboxCount: 2,
  availableMailboxes: 48,
  adminCount: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  domain: {
    id: 'dom-apple',
    domainName: 'xyz.com',
    stalwartDomainId: 'stalwart-xyz',
    status: 'active',
  },
};

describe('UpdateQuotaModal Component', () => {
  const defaultProps = {
    isOpen: true,
    tenant: mockTenant,
    onClose: vi.fn(),
    onQuotaUpdated: vi.fn(),
  };

  it('renders selectable buttons styled like the registration page', () => {
    render(<UpdateQuotaModal {...defaultProps} />);

    expect(screen.getByText('Adjust Mailbox Quota')).toBeInTheDocument();
    expect(screen.getByText(/Apple · xyz.com/)).toBeInTheDocument();

    // Verify all selectable preset buttons
    expect(screen.getByRole('button', { name: /just you \(1\)/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2 – 9/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /10 – 99/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /100 – 299/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /300\+ enterprise tier/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /custom/i })).toBeInTheDocument();
  });

  it('disables presets below current active mailboxes (2 active mailboxes)', () => {
    render(<UpdateQuotaModal {...defaultProps} />);

    // "Just you (1)" has value 1, which is < 2 active mailboxes
    const justYouBtn = screen.getByRole('button', { name: /just you \(1\)/i });
    expect(justYouBtn).toBeDisabled();

    // "2 – 9" (value 10) is >= 2, so it should be enabled
    const smallBtn = screen.getByRole('button', { name: /2 – 9/i });
    expect(smallBtn).not.toBeDisabled();
  });

  it('updates selected limit when clicking a different tier button and submits to api', async () => {
    render(<UpdateQuotaModal {...defaultProps} />);

    // Click "100 – 299" (value 100)
    const midTierBtn = screen.getByRole('button', { name: /100 – 299/i });
    fireEvent.click(midTierBtn);

    // Verify selected count is 100
    expect(screen.getByText(/selected:/i)).toBeInTheDocument();

    // Click Save Quota
    const saveBtn = screen.getByRole('button', { name: /save quota/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(api.updateMailboxLimit).toHaveBeenCalledWith('tenant-apple', 100);
      expect(defaultProps.onQuotaUpdated).toHaveBeenCalled();
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('shows custom numeric input when Custom button is clicked', () => {
    render(<UpdateQuotaModal {...defaultProps} />);

    const customBtn = screen.getByRole('button', { name: /custom/i });
    fireEvent.click(customBtn);

    const customInput = screen.getByPlaceholderText(/enter quota/i);
    expect(customInput).toBeInTheDocument();

    fireEvent.change(customInput, { target: { value: '75' } });
    expect(screen.getByText('75')).toBeInTheDocument();
  });
});
