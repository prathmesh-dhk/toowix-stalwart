import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegisterView } from '../../src/components/RegisterView';

vi.mock('../../src/api', () => ({
  api: {
    checkUsernameAvailability: vi.fn(),
    publicSendRecoveryEmailOtp: vi.fn(),
    publicVerifyRecoveryEmailOtp: vi.fn(),
    publicRegister: vi.fn(),
    tenantAdminLogin: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'prathmesh@dhkmail.com', role: 'TENANT_ADMIN' }, token: 'mock-token' }),
  },
  setStoredToken: vi.fn(),
  getStoredToken: vi.fn(),
  clearStoredToken: vi.fn(),
}));

import { api } from '../../src/api';

describe('RegisterView Component', () => {
  const onBackToLogin = vi.fn();
  const onSuccess = vi.fn();

  const orgInput = () => screen.getByPlaceholderText(/e\.g\. Acme Corporation/i);
  const usernameInput = () => screen.getByPlaceholderText(/yourname/i);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.checkUsernameAvailability).mockResolvedValue({ available: true, address: 'prathmesh@dhkmail.com' });
  });

  /** Steps 1-2: org + username, then password. Leaves the wizard on the recovery-email step. */
  const fillUsernameAndPassword = async (orgName = 'Wayne Enterprises') => {
    await userEvent.type(orgInput(), orgName);
    await userEvent.type(usernameInput(), 'prathmesh');
    await waitFor(() => expect(screen.getByText(/prathmesh@dhkmail\.com is available/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    await waitFor(() => expect(screen.getByText('Set your password')).toBeInTheDocument());
    await userEvent.type(screen.getByLabelText(/^password$/i), 'Password123!');
    await userEvent.type(screen.getByLabelText(/^confirm password$/i), 'Password123!');
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    await waitFor(() => expect(screen.getByText('Add a recovery email')).toBeInTheDocument());
  };

  it('renders Step 1 with organization name and username inputs', () => {
    render(<RegisterView onBackToLogin={onBackToLogin} />);

    expect(screen.getByText('Create your account')).toBeInTheDocument();
    expect(orgInput()).toBeInTheDocument();
    expect(usernameInput()).toBeInTheDocument();
    // The address they are about to claim is shown next to the field.
    expect(screen.getByText('@dhkmail.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^next$/i })).toBeInTheDocument();
  });

  it('calls onBackToLogin when clicking Sign in link', () => {
    render(<RegisterView onBackToLogin={onBackToLogin} />);
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(onBackToLogin).toHaveBeenCalled();
  });

  it('validates organization name before checking anything else', async () => {
    render(<RegisterView onBackToLogin={onBackToLogin} />);

    const form = screen.getByRole('button', { name: /^next$/i }).closest('form')!;
    fireEvent.submit(form);
    expect(screen.getByText(/please enter your organization name/i)).toBeInTheDocument();

    await userEvent.type(orgInput(), 'A');
    fireEvent.submit(form);
    expect(screen.getByText(/organization name must be at least 2 characters/i)).toBeInTheDocument();
  });

  it('shows a taken username and refuses to advance', async () => {
    vi.mocked(api.checkUsernameAvailability).mockResolvedValue({
      available: false,
      reason: 'That username is already taken.',
    });

    render(<RegisterView onBackToLogin={onBackToLogin} />);
    await userEvent.type(orgInput(), 'Wayne Enterprises');
    await userEvent.type(usernameInput(), 'postmaster');

    await waitFor(() => expect(screen.getByText(/already taken/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    // Still on step 1 — the password step never appears.
    expect(screen.queryByText('Set your password')).not.toBeInTheDocument();
  });

  describe('password step', () => {
    /** Gets to the password screen without typing a password. */
    const gotoPasswordStep = async () => {
      render(<RegisterView onBackToLogin={onBackToLogin} />);
      await userEvent.type(orgInput(), 'Wayne Enterprises');
      await userEvent.type(usernameInput(), 'prathmesh');
      await waitFor(() => expect(screen.getByText(/prathmesh@dhkmail\.com is available/i)).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
      await waitFor(() => expect(screen.getByText('Set your password')).toBeInTheDocument());
    };

    const nextBtn = () => screen.getByRole('button', { name: /^next$/i });
    const rule = (label: RegExp) => screen.getByText(label).closest('li')!;

    it('shows which rules are met as the user types, and blocks Next until all are', async () => {
      await gotoPasswordStep();
      const pwd = screen.getByLabelText(/^password$/i);
      const confirm = screen.getByLabelText(/^confirm password$/i);

      await userEvent.type(pwd, 'abcdefgh');
      expect(rule(/lowercase letter/i)).toHaveAttribute('data-met', 'true');
      expect(rule(/at least 8 characters/i)).toHaveAttribute('data-met', 'true');
      expect(rule(/uppercase letter/i)).toHaveAttribute('data-met', 'false');
      expect(rule(/a number/i)).toHaveAttribute('data-met', 'false');
      expect(rule(/special character/i)).toHaveAttribute('data-met', 'false');

      await userEvent.type(confirm, 'abcdefgh');
      expect(nextBtn()).toBeDisabled(); // matches, but still weak

      await userEvent.clear(pwd);
      await userEvent.clear(confirm);
      await userEvent.type(pwd, 'Password123!');
      await userEvent.type(confirm, 'Password123!');
      for (const label of [/lowercase/i, /uppercase/i, /a number/i, /special character/i, /at least 8/i]) {
        expect(rule(label)).toHaveAttribute('data-met', 'true');
      }
      expect(nextBtn()).not.toBeDisabled();
    });

    it('generates a strong password, fills both fields with it, and shows it', async () => {
      await gotoPasswordStep();

      fireEvent.click(screen.getByRole('button', { name: /generate strong password/i }));

      const pwd = screen.getByLabelText(/^password$/i) as HTMLInputElement;
      const confirm = screen.getByLabelText(/^confirm password$/i) as HTMLInputElement;
      const first = pwd.value; // a string copy — `pwd` is a live element and changes on the next click
      expect(pwd.value.length).toBeGreaterThanOrEqual(16);
      expect(confirm.value).toBe(pwd.value);
      // Shown as plain text, otherwise the user has no way to save what was generated.
      expect(pwd.type).toBe('text');

      expect(pwd.value).toMatch(/[a-z]/);
      expect(pwd.value).toMatch(/[A-Z]/);
      expect(pwd.value).toMatch(/[0-9]/);
      expect(pwd.value).toMatch(/[^A-Za-z0-9]/);
      expect(nextBtn()).not.toBeDisabled();

      // Two clicks give two different passwords.
      fireEvent.click(screen.getByRole('button', { name: /generate strong password/i }));
      expect((screen.getByLabelText(/^password$/i) as HTMLInputElement).value).not.toBe(first);
    });

    it('sends the user back here, with the message, if the mail server still rejects the password', async () => {
      vi.mocked(api.publicSendRecoveryEmailOtp).mockResolvedValueOnce({ success: true, message: 'sent', expiresMinutes: 10 });
      vi.mocked(api.publicVerifyRecoveryEmailOtp).mockResolvedValueOnce({ success: true, verificationToken: 't', message: 'ok' });
      vi.mocked(api.publicRegister).mockRejectedValueOnce(
        Object.assign(new Error('That password was rejected as too weak or too common. Please choose a stronger one.'), {
          code: 'PASSWORD_TOO_WEAK',
        })
      );

      render(<RegisterView onBackToLogin={onBackToLogin} />);
      await fillUsernameAndPassword();
      await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'personal@gmail.com');
      fireEvent.click(screen.getByRole('button', { name: /send verification code/i }));
      await waitFor(() => expect(screen.getByText('Verify your email')).toBeInTheDocument());
      const digits = screen.getAllByRole('textbox');
      for (let i = 0; i < 6; i++) fireEvent.change(digits[i], { target: { value: String(i + 1) } });
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
      await waitFor(() => expect(screen.getByText('Security questions')).toBeInTheDocument());
      await userEvent.type(screen.getByPlaceholderText('Answer 1'), 'A');
      await userEvent.type(screen.getByPlaceholderText('Answer 2'), 'B');
      await userEvent.type(screen.getByPlaceholderText('Answer 3'), 'C');
      fireEvent.click(screen.getByRole('button', { name: /complete registration/i }));

      // Not stranded on the questions screen: back on the password step, message shown there.
      await waitFor(() => expect(screen.getByText('Set your password')).toBeInTheDocument());
      expect(screen.getByText(/rejected as too weak or too common/i)).toBeInTheDocument();
      expect(screen.queryByText('Security questions')).not.toBeInTheDocument();
    });
  });

  it('every Back link returns to the step before it', async () => {
    vi.mocked(api.publicSendRecoveryEmailOtp).mockResolvedValue({ success: true, message: 'sent', expiresMinutes: 10 });

    render(<RegisterView onBackToLogin={onBackToLogin} />);
    await fillUsernameAndPassword(); // now on the recovery-email step

    // Recovery email -> Password
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByText('Set your password')).toBeInTheDocument());

    // Password -> Organization + username (the link that used to point at itself)
    fireEvent.click(screen.getByRole('button', { name: /← back/i }));
    await waitFor(() => expect(screen.getByText('Create your account')).toBeInTheDocument());

    // Forward again, then OTP -> back to the recovery-email step
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    await waitFor(() => expect(screen.getByText('Set your password')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));
    await waitFor(() => expect(screen.getByText('Add a recovery email')).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'personal@gmail.com');
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }));
    await waitFor(() => expect(screen.getByText('Verify your email')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /change email/i }));
    await waitFor(() => expect(screen.getByText('Add a recovery email')).toBeInTheDocument());
  });

  it('sends the verification code to the recovery email, not the new address', async () => {
    vi.mocked(api.publicSendRecoveryEmailOtp).mockResolvedValueOnce({
      success: true,
      message: 'sent',
      expiresMinutes: 10,
    });

    render(<RegisterView onBackToLogin={onBackToLogin} />);
    await fillUsernameAndPassword();

    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'personal@gmail.com');
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }));

    await waitFor(() => {
      expect(api.publicSendRecoveryEmailOtp).toHaveBeenCalledWith('personal@gmail.com');
      expect(screen.getByText('personal@gmail.com')).toBeInTheDocument();
    });
  });

  it('walks the whole wizard and registers with the username and verified recovery email', async () => {
    vi.mocked(api.publicSendRecoveryEmailOtp).mockResolvedValueOnce({ success: true, message: 'sent', expiresMinutes: 10 });
    vi.mocked(api.publicVerifyRecoveryEmailOtp).mockResolvedValueOnce({
      success: true,
      verificationToken: 'recovery-token-xyz',
      message: 'verified',
    });
    vi.mocked(api.publicRegister).mockResolvedValueOnce({
      success: true,
      user: { id: 'user-1', email: 'prathmesh@dhkmail.com' },
      message: 'Account created successfully',
    } as any);

    render(<RegisterView onBackToLogin={onBackToLogin} onSuccess={onSuccess} />);
    await fillUsernameAndPassword();

    // Step 3 -> 4: recovery email
    await userEvent.type(screen.getByPlaceholderText(/you@example\.com/i), 'personal@gmail.com');
    fireEvent.click(screen.getByRole('button', { name: /send verification code/i }));

    // Step 4: the 6-digit code
    await waitFor(() => expect(screen.getByText('Verify your email')).toBeInTheDocument());
    const digits = screen.getAllByRole('textbox');
    for (let i = 0; i < 6; i++) {
      fireEvent.change(digits[i], { target: { value: String(i + 1) } });
    }
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    await waitFor(() => expect(api.publicVerifyRecoveryEmailOtp).toHaveBeenCalledWith('personal@gmail.com', '123456'));

    // Step 5: security questions (single-character answers are allowed)
    await waitFor(() => expect(screen.getByText('Security questions')).toBeInTheDocument());
    await userEvent.type(screen.getByPlaceholderText('Answer 1'), 'A');
    await userEvent.type(screen.getByPlaceholderText('Answer 2'), 'B');
    await userEvent.type(screen.getByPlaceholderText('Answer 3'), 'C');
    fireEvent.click(screen.getByRole('button', { name: /complete registration/i }));

    await waitFor(() => {
      expect(api.publicRegister).toHaveBeenCalledWith({
        username: 'prathmesh',
        password: 'Password123!',
        recoveryEmail: 'personal@gmail.com',
        recoveryEmailVerificationToken: 'recovery-token-xyz',
        organizationName: 'Wayne Enterprises',
        securityQuestions: [
          { question: expect.any(String), answer: 'A' },
          { question: expect.any(String), answer: 'B' },
          { question: expect.any(String), answer: 'C' },
        ],
      });
      expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ email: 'prathmesh@dhkmail.com' }));
    });
  });
});
