import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PlanFormModal } from '../../src/components/modals/PlanFormModal';
import { api } from '../../src/api';
import { Plan } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: { createPlan: vi.fn().mockResolvedValue({}), updatePlan: vi.fn().mockResolvedValue({}) },
}));

const plan: Plan = {
  id: 'plan-1',
  name: 'Team',
  seatCount: 25,
  displayOrder: 1,
  isActive: true,
  isDefault: false,
  monthlyPriceInPaise: 9900,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('PlanFormModal', () => {
  beforeEach(() => vi.clearAllMocks());

  it('has one per-Active-User price and an Active User limit, with no billing mode choice', () => {
    render(<PlanFormModal isOpen plan={null} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByLabelText('Price per Active User / month (₹)')).toBeInTheDocument();
    expect(screen.getByLabelText('User limit (most Active Users per domain)')).toBeInTheDocument();
    expect(screen.queryByText(/billing mode/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/fixed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/seat/i)).not.toBeInTheDocument();
  });

  it('editing keeps the Plan\'s price and limit and sends no billing mode', async () => {
    render(<PlanFormModal isOpen plan={plan} onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(screen.getByLabelText('Price per Active User / month (₹)')).toHaveValue(99);
    expect(screen.getByLabelText('User limit (most Active Users per domain)')).toHaveValue(25);

    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => expect(api.updatePlan).toHaveBeenCalled());
    const body = vi.mocked(api.updatePlan).mock.calls[0][1];
    expect(body).toMatchObject({ seatCount: 25, monthlyPriceInPaise: 9900 });
    expect(body).not.toHaveProperty('billingMode');
  });
});
