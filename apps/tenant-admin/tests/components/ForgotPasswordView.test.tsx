import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ForgotPasswordView } from '../../src/components/ForgotPasswordView';

vi.mock('../../src/api', () => ({
  api: {
    getDefaultForgotPasswordAccount: vi.fn().mockResolvedValue({ email: '' }),
    initiateForgotPassword: vi.fn(),
    sendForgotPasswordOtp: vi.fn(),
    verifyForgotPasswordOtp: vi.fn(),
    verifyForgotPasswordTotp: vi.fn(),
    verifyForgotPasswordQuestions: vi.fn(),
    resetForgotPassword: vi.fn(),
  },
}));

import { api } from '../../src/api';

describe('ForgotPasswordView Component', () => {
  const onBackToLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Stage 1 with email input and continue button', () => {
    render(<ForgotPasswordView onBackToLogin={onBackToLogin} />);

    expect(screen.getByText('Reset your password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/admin@company\.com/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });

  it('advances to Stage 2 with clean cards (no green labels) and requires clicking Next before entering OTP', async () => {
    vi.mocked(api.initiateForgotPassword).mockResolvedValueOnce({
      email: 'admin@acme.com',
      maskedCurrentEmail: 'ad***me.com',
      hasRecoveryEmail: true,
      maskedRecoveryEmail: 're***me.com',
      hasTotp: true,
      securityQuestions: ['Q1', 'Q2', 'Q3'],
    });
    vi.mocked(api.sendForgotPasswordOtp).mockResolvedValueOnce({
      success: true,
      target: 'current',
    });

    render(<ForgotPasswordView onBackToLogin={onBackToLogin} />);

    const emailInput = screen.getByPlaceholderText(/admin@company\.com/i);
    await userEvent.type(emailInput, 'admin@acme.com');

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Verify Stage 2 selection step
    await waitFor(() => {
      expect(screen.getByText('Modes of recovery')).toBeInTheDocument();
      expect(screen.getByText('1. Current Email')).toBeInTheDocument();
      expect(screen.getByText('2. Recovery Email')).toBeInTheDocument();
      expect(screen.getByText('3. Authenticator OTP')).toBeInTheDocument();
      expect(screen.getByText('4. Questions')).toBeInTheDocument();
    });

    // Ensure NO green status labels exist in the DOM
    expect(screen.queryByText(/^Ready$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^2FA$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/3 Setup/i)).not.toBeInTheDocument();

    // At first, they just select an option and click Next (OTP inputs must NOT be visible yet)
    expect(screen.queryByText(/Enter 6-digit verification code/i)).not.toBeInTheDocument();
    const nextBtn = screen.getByRole('button', { name: /^Next$/i });
    expect(nextBtn).toBeInTheDocument();

    // Now click Next to proceed to enter OTP
    fireEvent.click(nextBtn);

    await waitFor(() => {
      expect(api.sendForgotPasswordOtp).toHaveBeenCalledWith('admin@acme.com', 'current');
      expect(screen.getByText(/Enter 6-digit verification code/i)).toBeInTheDocument();
      expect(screen.getByText(/Verify Code/i)).toBeInTheDocument();
      expect(screen.getByText(/Choose another recovery method/i)).toBeInTheDocument();
    });

    // Clicking "Choose another recovery method" returns to mode selection
    fireEvent.click(screen.getByText(/Choose another recovery method/i));

    await waitFor(() => {
      expect(screen.getByText('Modes of recovery')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Next$/i })).toBeInTheDocument();
      expect(screen.queryByText(/Enter 6-digit verification code/i)).not.toBeInTheDocument();
    });
  });
});
