import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CouponsManagementView } from '../../src/components/views/CouponsManagementView';
import { api } from '../../src/api';
import { CouponItem } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    listCoupons: vi.fn(),
    createCoupon: vi.fn(),
    createBatchCoupons: vi.fn(),
    revokeCoupon: vi.fn(),
    deleteCoupon: vi.fn(),
  },
}));

const mockCoupons: CouponItem[] = [
  {
    id: 'coupon-1',
    code: 'STARTUP60',
    extraTrialDays: 60,
    maxUses: 1,
    usedCount: 0,
    status: 'active',
    expiresAt: null,
    description: 'Y Combinator batch promo',
    createdByEmail: 'admin@toowix.com',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    redemptions: [],
  },
  {
    id: 'coupon-2',
    code: 'VIP30',
    extraTrialDays: 30,
    maxUses: 1,
    usedCount: 1,
    status: 'used',
    expiresAt: null,
    description: '+30 days for Nexus Tech',
    createdByEmail: 'admin@toowix.com',
    createdAt: '2026-01-02T00:00:00.000Z',
    updatedAt: '2026-01-03T00:00:00.000Z',
    redemptions: [
      {
        tenantId: 'tenant-1',
        tenantName: 'Nexus Tech',
        domainId: 'domain-1',
        redeemedAt: '2026-01-03T00:00:00.000Z',
        extraTrialDays: 30,
      },
    ],
  },
];

describe('CouponsManagementView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listCoupons).mockResolvedValue({
      coupons: mockCoupons,
      total: 2,
      activeCount: 1,
      usedCount: 1,
    });
  });

  it('renders metric cards, coupon codes, and benefit descriptions', async () => {
    render(<CouponsManagementView />);

    const startupCodes = await screen.findAllByText('STARTUP60');
    expect(startupCodes[0]).toBeInTheDocument();
    expect(screen.getAllByText('VIP30')[0]).toBeInTheDocument();
    expect(screen.getAllByText('+60 Days Free Trial')[0]).toBeInTheDocument();
    expect(screen.getAllByText('+30 Days Free Trial')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Nexus Tech')[0]).toBeInTheDocument();

    // Metric cards
    expect(screen.getByText('Total Codes')).toBeInTheDocument();
    expect(screen.getByText('Active (Unredeemed)')).toBeInTheDocument();
  });

  it('opens the Create Coupon modal when clicking Generate Coupon', async () => {
    render(<CouponsManagementView />);
    await screen.findAllByText('STARTUP60');

    fireEvent.click(screen.getByRole('button', { name: /generate coupon/i }));

    expect(await screen.findByText('Create coupon')).toBeInTheDocument();
    expect(screen.getByText('Single code')).toBeInTheDocument();
    expect(screen.getByText('Batch')).toBeInTheDocument();
  });

  it('allows filtering by status', async () => {
    render(<CouponsManagementView />);
    await screen.findAllByText('STARTUP60');

    fireEvent.click(screen.getByRole('button', { name: /^redeemed$/i }));

    await waitFor(() => {
      expect(api.listCoupons).toHaveBeenCalledWith(expect.objectContaining({ status: 'used' }));
    });
  });

  it('allows searching by text', async () => {
    render(<CouponsManagementView />);
    await screen.findAllByText('STARTUP60');

    const searchInput = screen.getByPlaceholderText('Search code or description...');
    fireEvent.change(searchInput, { target: { value: 'STARTUP' } });

    await waitFor(() => {
      expect(api.listCoupons).toHaveBeenCalledWith(expect.objectContaining({ search: 'STARTUP' }));
    });
  });

  it('calls revokeCoupon when clicking the revoke button on an active coupon', async () => {
    vi.mocked(api.revokeCoupon).mockResolvedValue({ success: true, message: 'Revoked' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CouponsManagementView />);
    await screen.findAllByText('STARTUP60');

    const revokeBtn = screen.getAllByTitle('Revoke coupon')[0];
    fireEvent.click(revokeBtn);

    await waitFor(() => {
      expect(api.revokeCoupon).toHaveBeenCalledWith('coupon-1');
    });
  });

  it('calls deleteCoupon when clicking the delete button on an unused coupon', async () => {
    vi.mocked(api.deleteCoupon).mockResolvedValue({ success: true, message: 'Deleted' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<CouponsManagementView />);
    await screen.findAllByText('STARTUP60');

    const deleteBtn = screen.getAllByTitle('Delete unused coupon')[0];
    fireEvent.click(deleteBtn);

    await waitFor(() => {
      expect(api.deleteCoupon).toHaveBeenCalledWith('coupon-1');
    });
  });
});
