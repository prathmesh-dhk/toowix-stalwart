import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterView } from '../../src/components/RegisterView';

vi.mock('../../src/api', () => ({
  api: {
    publicSendContactEmailOtp: vi.fn(),
    publicVerifyContactEmailOtp: vi.fn(),
    publicRegister: vi.fn(),
  },
}));

import { api } from '../../src/api';

describe('RegisterView Component', () => {
  const onBackToLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Step 1 (Create your account) matching Sign In theme', () => {
    render(<RegisterView onBackToLogin={onBackToLogin} />);

    expect(screen.getByText('Create your account')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/abc@mail\.com/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('calls onBackToLogin when clicking Sign in link', () => {
    render(<RegisterView onBackToLogin={onBackToLogin} />);

    const signInBtn = screen.getByRole('button', { name: /^sign in$/i });
    fireEvent.click(signInBtn);

    expect(onBackToLogin).toHaveBeenCalled();
  });

  it('advances to Step 2 (Verify your email) after entering email and clicking Next', async () => {
    vi.mocked(api.publicSendContactEmailOtp).mockResolvedValueOnce({
      success: true,
      message: 'Verification code sent',
      expiresMinutes: 10,
    });

    render(<RegisterView onBackToLogin={onBackToLogin} />);

    const emailInput = screen.getByPlaceholderText(/abc@mail\.com/i);
    await userEvent.type(emailInput, 'admin@mycompany.com');

    const nextBtn = screen.getByRole('button', { name: /^next/i });
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(api.publicSendContactEmailOtp).toHaveBeenCalledWith('admin@mycompany.com');
      expect(screen.getByText('Verify your email')).toBeInTheDocument();
      expect(screen.getByText('admin@mycompany.com')).toBeInTheDocument();
    });
  });
});
