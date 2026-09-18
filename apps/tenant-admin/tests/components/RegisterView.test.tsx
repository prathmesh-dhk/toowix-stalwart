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

  it('allows 1-character security question answers and calls publicRegister', async () => {
    vi.mocked(api.publicSendContactEmailOtp).mockResolvedValueOnce({
      success: true,
      message: 'Verification code sent',
      expiresMinutes: 10,
    });
    vi.mocked(api.publicVerifyContactEmailOtp).mockResolvedValueOnce({
      success: true,
      verificationToken: 'test-otp-token-xyz',
      message: 'Email verified',
    });
    vi.mocked(api.publicRegister).mockResolvedValueOnce({
      success: true,
      user: { id: 'user-1', email: 'admin@mycompany.com', role: 'TENANT_ADMIN' },
      message: 'Account created successfully',
    });

    render(<RegisterView onBackToLogin={onBackToLogin} />);

    // Step 1: Email
    await userEvent.type(screen.getByPlaceholderText(/abc@mail\.com/i), 'admin@mycompany.com');
    fireEvent.click(screen.getByRole('button', { name: /^next/i }));

    // Step 2: OTP
    await waitFor(() => expect(screen.getByText('Verify your email')).toBeInTheDocument());
    const digitInputs = screen.getAllByRole('textbox');
    for (let i = 0; i < 6; i++) {
      fireEvent.change(digitInputs[i], { target: { value: String(i + 1) } });
    }
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    // Step 3: Password
    await waitFor(() => expect(screen.getByText('Set your password')).toBeInTheDocument());
    const pwdInput = screen.getByLabelText(/^password$/i);
    const confirmPwdInput = screen.getByLabelText(/^confirm password$/i);
    await userEvent.type(pwdInput, 'Password123!');
    await userEvent.type(confirmPwdInput, 'Password123!');
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    // Step 4: Security questions - single character answers
    await waitFor(() => expect(screen.getByText('Security questions')).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText('Answer 1'), 'A');
    await userEvent.type(screen.getByPlaceholderText('Answer 2'), 'B');
    await userEvent.type(screen.getByPlaceholderText('Answer 3'), 'C');

    const submitBtn = screen.getByRole('button', { name: /complete registration/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.publicRegister).toHaveBeenCalledWith({
        email: 'admin@mycompany.com',
        emailVerificationToken: 'test-otp-token-xyz',
        password: 'Password123!',
        securityQuestions: [
          { question: expect.any(String), answer: 'A' },
          { question: expect.any(String), answer: 'B' },
          { question: expect.any(String), answer: 'C' },
        ],
      });
      expect(screen.getByText('Registration successful!')).toBeInTheDocument();
    });
  });
});
