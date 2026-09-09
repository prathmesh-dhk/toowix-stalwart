import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TenantAdminLoginView } from '../../src/components/TenantAdminLoginView';
import { api } from '../../src/api';

vi.mock('../../src/api', () => ({
  api: {
    tenantAdminLogin: vi.fn(),
    verify2Fa: vi.fn(),
    send2FaLoginOtp: vi.fn(),
  },
  setStoredToken: vi.fn(),
  getStoredToken: vi.fn(),
  clearStoredToken: vi.fn(),
}));

describe('TenantAdminLoginView Component', () => {
  const onSuccess = vi.fn();
  const onGoToRegister = vi.fn();
  const onForgotPassword = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders login form with email, password, and register link', () => {
    render(
      <TenantAdminLoginView
        onSuccess={onSuccess}
        onGoToRegister={onGoToRegister}
        onForgotPassword={onForgotPassword}
      />
    );

    expect(screen.getByPlaceholderText(/admin@company\.com/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Password', { exact: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register an organization/i })).toBeInTheDocument();
  });

  it('navigates to register view when clicking register organization link', () => {
    render(
      <TenantAdminLoginView
        onSuccess={onSuccess}
        onGoToRegister={onGoToRegister}
        onForgotPassword={onForgotPassword}
      />
    );

    const registerBtn = screen.getByRole('button', { name: /register an organization/i });
    fireEvent.click(registerBtn);

    expect(onGoToRegister).toHaveBeenCalled();
  });

  it('validates empty inputs before submitting', async () => {
    render(
      <TenantAdminLoginView
        onSuccess={onSuccess}
        onGoToRegister={onGoToRegister}
        onForgotPassword={onForgotPassword}
      />
    );

    const form = screen.getByRole('button', { name: /^sign in$/i }).closest('form')!;
    fireEvent.submit(form);

    expect(await screen.findByText(/please enter your email and password/i)).toBeInTheDocument();
    expect(api.tenantAdminLogin).not.toHaveBeenCalled();
  });

  it('displays portal gating error when Super Admin account attempts tenant portal login', async () => {
    vi.mocked(api.tenantAdminLogin).mockRejectedValueOnce(
      new Error('Access Denied: This account is not authorized for the Tenant Admin portal.')
    );

    render(
      <TenantAdminLoginView
        onSuccess={onSuccess}
        onGoToRegister={onGoToRegister}
        onForgotPassword={onForgotPassword}
      />
    );

    await userEvent.type(screen.getByPlaceholderText(/admin@company\.com/i), 'super@toowix.com');
    await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'SuperAdminPass123!');

    const form = screen.getByRole('button', { name: /^sign in$/i }).closest('form')!;
    fireEvent.submit(form);

    expect(
      await screen.findByText(/Access Denied: This account is not authorized for the Tenant Admin portal/i)
    ).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('transitions to 2FA verification step and completes login with TOTP code', async () => {
    vi.mocked(api.tenantAdminLogin).mockResolvedValueOnce({
      requires2FA: true,
      tempToken: 'tenant-temp-2fa-token',
      user: {
        id: 'tenant-admin-1',
        email: 'admin@acme.com',
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-acme-id',
      },
    });

    vi.mocked(api.verify2Fa).mockResolvedValueOnce({
      token: 'tenant-jwt-token',
      user: {
        id: 'tenant-admin-1',
        email: 'admin@acme.com',
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-acme-id',
      },
    });

    render(
      <TenantAdminLoginView
        onSuccess={onSuccess}
        onGoToRegister={onGoToRegister}
        onForgotPassword={onForgotPassword}
      />
    );

    await userEvent.type(screen.getByPlaceholderText(/admin@company\.com/i), 'admin@acme.com');
    await userEvent.type(screen.getByLabelText('Password', { exact: true }), 'TenantAdminPass123!');

    const form = screen.getByRole('button', { name: /^sign in$/i }).closest('form')!;
    fireEvent.submit(form);

    // 2FA challenge screen appears
    expect(await screen.findByText(/two-factor authentication/i)).toBeInTheDocument();
    expect(screen.getByText('Authenticator code', { exact: true })).toBeInTheDocument();

    // Fill 6 digits
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBe(6);

    for (let i = 0; i < 6; i++) {
      fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
    }

    const verifyBtn = screen.getByRole('button', { name: /verify and sign in/i });
    fireEvent.click(verifyBtn);

    await waitFor(() => {
      expect(api.verify2Fa).toHaveBeenCalledWith('tenant-temp-2fa-token', '123456', false, 'totp');
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'tenant-admin-1',
          email: 'admin@acme.com',
          role: 'TENANT_ADMIN',
          tenantId: 'tenant-acme-id',
        })
      );
    });
  });
});
