import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SuperAdminLoginView } from '../../src/components/SuperAdminLoginView';
import { api } from '../../src/api';

vi.mock('../../src/api', () => ({
  api: {
    superAdminLogin: vi.fn(),
    verify2Fa: vi.fn(),
    send2FaLoginOtp: vi.fn(),
  },
  setStoredToken: vi.fn(),
  getStoredToken: vi.fn(),
  clearStoredToken: vi.fn(),
}));

describe('SuperAdminLoginView Component', () => {
  const onSuccess = vi.fn();
  const onForgotPassword = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders login form elements (email, password, submit button)', () => {
    render(
      <SuperAdminLoginView
        onSuccess={onSuccess}
        onForgotPassword={onForgotPassword}
      />
    );

    expect(screen.getByPlaceholderText(/admin@toowix.com/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('validates empty inputs before calling login API', async () => {
    render(
      <SuperAdminLoginView
        onSuccess={onSuccess}
        onForgotPassword={onForgotPassword}
      />
    );

    const form = screen.getByRole('button', { name: /^sign in$/i }).closest('form')!;
    fireEvent.submit(form);

    expect(await screen.findByText(/please enter your email and password/i)).toBeInTheDocument();
    expect(api.superAdminLogin).not.toHaveBeenCalled();
  });

  it('handles role rejection or invalid credentials gracefully', async () => {
    vi.mocked(api.superAdminLogin).mockRejectedValueOnce(
      new Error('Access Denied: This account is not authorized for the Super Admin portal.')
    );

    render(
      <SuperAdminLoginView
        onSuccess={onSuccess}
        onForgotPassword={onForgotPassword}
      />
    );

    await userEvent.type(screen.getByPlaceholderText(/admin@toowix.com/i), 'tenant-user@domain.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'WrongPortalPass123!');

    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    expect(
      await screen.findByText(/Access Denied: This account is not authorized for the Super Admin portal/i)
    ).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('transitions to 2FA challenge and submits TOTP code successfully', async () => {
    vi.mocked(api.superAdminLogin).mockResolvedValueOnce({
      requires2FA: true,
      tempToken: 'temp-2fa-token-xyz',
      user: {
        id: 'super-1',
        email: 'root@toowix.com',
        role: 'SUPER_ADMIN',
      },
    });

    vi.mocked(api.verify2Fa).mockResolvedValueOnce({
      token: 'final-super-jwt-token',
      user: {
        id: 'super-1',
        email: 'root@toowix.com',
        role: 'SUPER_ADMIN',
      },
    });

    render(
      <SuperAdminLoginView
        onSuccess={onSuccess}
        onForgotPassword={onForgotPassword}
      />
    );

    await userEvent.type(screen.getByPlaceholderText(/admin@toowix.com/i), 'root@toowix.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'SuperMasterKey2026!');

    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    // 2FA challenge screen appears - Step 1: Choose method
    expect(await screen.findByText(/two-factor authentication/i)).toBeInTheDocument();
    expect(screen.getByText(/choose a verification method to complete sign in/i)).toBeInTheDocument();
    expect(screen.getByText('Authenticator app')).toBeInTheDocument();

    // Click Continue to proceed to Step 2
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2: Enter code screen
    expect(await screen.findByText(/6-digit authenticator code/i)).toBeInTheDocument();

    // Verify 6 digit inputs exist
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBe(6);

    // Type 6 digits: 1 2 3 4 5 6
    for (let i = 0; i < 6; i++) {
      fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
    }

    const verifyBtn = screen.getByRole('button', { name: /verify and sign in/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(api.verify2Fa).toHaveBeenCalledWith('temp-2fa-token-xyz', '123456', false, 'totp');
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'super-1',
          email: 'root@toowix.com',
          role: 'SUPER_ADMIN',
        })
      );
    });
  });

  it('allows bypassing 2FA with emergency backup code via "Use backup code"', async () => {
    vi.mocked(api.superAdminLogin).mockResolvedValueOnce({
      requires2FA: true,
      tempToken: 'super-temp-2fa-token-backup',
      hasBackupCodes: true,
      remainingBackupCodes: 10,
      user: {
        id: 'super-1',
        email: 'root@toowix.com',
        role: 'SUPER_ADMIN',
      },
    });

    vi.mocked(api.verify2Fa).mockResolvedValueOnce({
      token: 'valid-super-backup-token',
      user: {
        id: 'super-1',
        email: 'root@toowix.com',
        role: 'SUPER_ADMIN',
      },
    });

    render(
      <SuperAdminLoginView
        onSuccess={onSuccess}
        onForgotPassword={onForgotPassword}
      />
    );

    await userEvent.type(screen.getByPlaceholderText(/admin@toowix.com/i), 'root@toowix.com');
    await userEvent.type(screen.getByLabelText(/password/i), 'SuperMasterKey2026!');

    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));

    // In 2FA selection screen, click "Use backup code"
    const useBackupCodeBtn = await screen.findByRole('button', { name: /use backup code/i });
    expect(useBackupCodeBtn).toBeInTheDocument();
    fireEvent.click(useBackupCodeBtn);

    // Emergency backup code screen rendered
    expect(await screen.findByText(/Emergency backup code/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('XXXX-XXXX')).toBeInTheDocument();

    // Enter backup code
    const codeInput = screen.getByPlaceholderText('XXXX-XXXX');
    await userEvent.type(codeInput, 'ABCD-1234');

    const verifyBtn = screen.getByRole('button', { name: /verify and sign in/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(api.verify2Fa).toHaveBeenCalledWith('super-temp-2fa-token-backup', 'ABCD-1234', false, 'backup_code');
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'super-1',
          email: 'root@toowix.com',
          role: 'SUPER_ADMIN',
        })
      );
    });
  });
});

