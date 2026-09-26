import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlansManagementView } from '../../src/components/views/PlansManagementView';
import { Plan } from '../../src/types';

const mockPlans: Plan[] = [
  {
    id: 'plan-1',
    name: 'Team',
    badge: 'Standard',
    description: 'Standard team tier',
    seatCount: 10,
    displayOrder: 1,
    isActive: true,
    isDefault: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'plan-2',
    name: 'Archived Tier',
    badge: null,
    description: null,
    seatCount: 5,
    displayOrder: 2,
    isActive: false,
    isDefault: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('PlansManagementView Component', () => {
  const defaultProps = {
    plans: mockPlans,
    loading: false,
    onRefresh: vi.fn(),
    onCreatePlan: vi.fn(),
    onEditPlan: vi.fn(),
    onToggleActive: vi.fn(),
  };

  it('renders plan rows with seat count, badge, default and active status', () => {
    render(<PlansManagementView {...defaultProps} />);

    expect(screen.getAllByText('Team')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Standard')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Default')[0]).toBeInTheDocument();
    expect(screen.getAllByText('10')[0]).toBeInTheDocument();

    expect(screen.getAllByText('Archived Tier')[0]).toBeInTheDocument();
    expect(screen.getAllByText('Inactive')[0]).toBeInTheDocument();
  });

  it('calls onCreatePlan when "New Plan" is clicked', () => {
    render(<PlansManagementView {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /new plan/i }));
    expect(defaultProps.onCreatePlan).toHaveBeenCalled();
  });

  it('calls onEditPlan with the right plan when its edit button is clicked', () => {
    render(<PlansManagementView {...defaultProps} />);
    const editBtns = screen.getAllByTitle('Edit plan');
    fireEvent.click(editBtns[0]);
    expect(defaultProps.onEditPlan).toHaveBeenCalledWith(mockPlans[0]);
  });

  it('calls onToggleActive to deactivate an active plan and activate an inactive one', () => {
    render(<PlansManagementView {...defaultProps} />);

    fireEvent.click(screen.getAllByTitle('Deactivate (hide from pickers)')[0]);
    expect(defaultProps.onToggleActive).toHaveBeenCalledWith(mockPlans[0]);

    fireEvent.click(screen.getAllByTitle('Activate (show in pickers)')[0]);
    expect(defaultProps.onToggleActive).toHaveBeenCalledWith(mockPlans[1]);
  });

  it('shows an empty state when there are no plans', () => {
    render(<PlansManagementView {...defaultProps} plans={[]} />);
    expect(screen.getByText('No Plans Configured')).toBeInTheDocument();
  });
});
