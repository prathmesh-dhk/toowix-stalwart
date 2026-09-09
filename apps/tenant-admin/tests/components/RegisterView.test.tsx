import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterView } from '../../src/components/RegisterView';

vi.mock('../../src/api', () => ({
  api: {
    publicRegisterTenant: vi.fn(),
  },
}));

describe('RegisterView Component', () => {
  const onBackToLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Step 1 (Organization Details) and employee count choices', () => {
    render(<RegisterView onBackToLogin={onBackToLogin} />);

    expect(screen.getByText('Company')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/e\.g\. Acme Global Inc\./i)).toBeInTheDocument();
    expect(screen.getByText('Just you (1)')).toBeInTheDocument();
    expect(screen.getByText('10 – 99')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('calls onBackToLogin when clicking top Sign In button', () => {
    render(<RegisterView onBackToLogin={onBackToLogin} />);

    const signInBtn = screen.getByRole('button', { name: /^sign in$/i });
    fireEvent.click(signInBtn);

    expect(onBackToLogin).toHaveBeenCalled();
  });

  it('advances to Step 2 (Administrator Contact) after filling business name', async () => {
    render(<RegisterView onBackToLogin={onBackToLogin} />);

    const businessNameInput = screen.getByPlaceholderText(/e\.g\. Acme Global Inc\./i);
    await userEvent.type(businessNameInput, 'Wayne Enterprises');

    // Click Continue
    const continueBtn = screen.getByRole('button', { name: /continue/i });
    fireEvent.click(continueBtn);

    // Step 2 is mounted
    expect(await screen.findByText('Admin')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Alex')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Morgan')).toBeInTheDocument();
  });
});
