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
    verifyForgotPasswordBackupCode: vi.fn(),
    verifyForgotPasswordQuestions: vi.fn(),
    resetPassword: vi.fn(),
  },
}));

import { api } from '../../src/api';

describe('ForgotPasswordView Component in Super Admin', () => {
  const onBackToLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Stage 1 with email input and continue button', () => {
    render(<ForgotPasswordView onBackToLogin={onBackToLogin} />);

    expect(screen.getByText('Reset your password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/admin@toowix\.com/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
  });

  it('directly opens email verification method without modes of recovery screen when continue is clicked', async () => {
    vi.mocked(api.initiateForgotPassword).mockResolvedValueOnce({
      email: 'superadmin@toowix.internal',
      maskedCurrentEmail: 'su***al',
      hasRecoveryEmail: true,
      maskedRecoveryEmail: 're***al',
      hasTotp: true,
      hasBackupCodes: true,
      securityQuestions: ['Q1', 'Q2', 'Q3'],
    });
    vi.mocked(api.sendForgotPasswordOtp).mockResolvedValueOnce({
      success: true,
      target: 'current',
    });

    render(<ForgotPasswordView onBackToLogin={onBackToLogin} />);

    const emailInput = screen.getByPlaceholderText(/admin@toowix\.com/i);
    await userEvent.type(emailInput, 'superadmin@toowix.internal');

    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Verify it directly opens the email verification method without intermediate modes screen
    await waitFor(() => {
      expect(api.initiateForgotPassword).toHaveBeenCalledWith('superadmin@toowix.internal');
    });
    await waitFor(() => {
      expect(api.sendForgotPasswordOtp).toHaveBeenCalledWith('superadmin@toowix.internal', 'current');
    });
    await waitFor(() => {
      expect(screen.getByText('Verify email code')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByText('6-digit verification code')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /verify code/i })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /try another way/i })).toBeInTheDocument();
    });

    // Ensure old "Modes of recovery" grid was never displayed
    expect(screen.queryByText('Modes of recovery')).not.toBeInTheDocument();
  });

  it('shows available options when "Try another way" is clicked and supports switching to backup code', async () => {
    vi.mocked(api.initiateForgotPassword).mockResolvedValueOnce({
      email: 'superadmin@toowix.internal',
      maskedCurrentEmail: 'su***al',
      hasRecoveryEmail: true,
      maskedRecoveryEmail: 're***al',
      hasTotp: true,
      hasBackupCodes: true,
      securityQuestions: ['Q1', 'Q2', 'Q3'],
    });
    vi.mocked(api.sendForgotPasswordOtp).mockResolvedValueOnce({
      success: true,
      target: 'current',
    });
    vi.mocked(api.verifyForgotPasswordBackupCode).mockResolvedValueOnce({
      success: true,
      resetToken: 'reset_token_super_123',
      message: 'Verified',
    });

    render(<ForgotPasswordView onBackToLogin={onBackToLogin} />);

    const emailInput = screen.getByPlaceholderText(/admin@toowix\.com/i);
    await userEvent.type(emailInput, 'superadmin@toowix.internal');
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /try another way/i })).toBeInTheDocument();
    });

    // Click "Try another way"
    fireEvent.click(screen.getByRole('button', { name: /try another way/i }));

    // Verify available recovery options list
    await waitFor(() => {
      expect(screen.getByText('Try another way')).toBeInTheDocument();
      expect(screen.getByText('Authenticator app')).toBeInTheDocument();
      expect(screen.getByText('Recovery email')).toBeInTheDocument();
      expect(screen.getByText('Security questions')).toBeInTheDocument();
      expect(screen.getByText('Backup code')).toBeInTheDocument();
    });

    // Click "Backup code" option
    fireEvent.click(screen.getByText('Backup code'));

    // Verify backup code form appears
    await waitFor(() => {
      expect(screen.getByText('Verify backup code')).toBeInTheDocument();
      expect(screen.getByLabelText(/emergency backup code/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /verify backup code/i })).toBeInTheDocument();
    });

    // Enter backup code and submit
    const backupInput = screen.getByLabelText(/emergency backup code/i);
    await userEvent.type(backupInput, 'SUPR-CODE');
    fireEvent.click(screen.getByRole('button', { name: /verify backup code/i }));

    // Advances to Stage 3: Set new password
    await waitFor(() => {
      expect(api.verifyForgotPasswordBackupCode).toHaveBeenCalledWith('superadmin@toowix.internal', 'SUPR-CODE');
      expect(screen.getByText('Set new password')).toBeInTheDocument();
    });
  });
});
