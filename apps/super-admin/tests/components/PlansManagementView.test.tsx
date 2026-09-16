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

    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Default')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();

    expect(screen.getByText('Archived Tier')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
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

    fireEvent.click(screen.getByTitle('Deactivate (hide from pickers)'));
    expect(defaultProps.onToggleActive).toHaveBeenCalledWith(mockPlans[0]);

    fireEvent.click(screen.getByTitle('Activate (show in pickers)'));
    expect(defaultProps.onToggleActive).toHaveBeenCalledWith(mockPlans[1]);
  });

  it('shows an empty state when there are no plans', () => {
    render(<PlansManagementView {...defaultProps} plans={[]} />);
    expect(screen.getByText('No Plans Configured')).toBeInTheDocument();
  });
});
