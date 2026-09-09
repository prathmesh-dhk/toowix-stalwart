import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivateTenantView } from '../../src/components/ActivateTenantView';
import { api } from '../../src/api';

vi.mock('../../src/api', () => ({
  api: {
    validateActivationToken: vi.fn(),
    completeActivation: vi.fn(),
  },
  setStoredToken: vi.fn(),
}));

describe('ActivateTenantView Component', () => {
  const onSuccess = vi.fn();
  const onBackToLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.validateActivationToken).mockResolvedValue({
      valid: true,
      tenant: { id: 'tenant-test-123', name: 'Stark Industries', status: 'approved_pending_setup' },
      domain: 'starkindustries.test',
      contactEmail: 'tony@starkindustries.test',
      totpSecret: 'MOCKTOTPSECRET123',
      qrCodeDataUrl: 'data:image/png;base64,mockqr',
    });
  });

  it('validates activation token and renders tenant info', async () => {
    render(
      <ActivateTenantView
        onSuccess={onSuccess}
        onBackToLogin={onBackToLogin}
      />
    );

    // Initial stage transitions to Stage 2 after validation
    expect(await screen.findByText('Stark Industries')).toBeInTheDocument();
    expect(screen.getAllByText('starkindustries.test').length).toBeGreaterThan(0);
    expect(screen.getByText('tony@starkindustries.test')).toBeInTheDocument();
  });

  it('advances through credentials verification to 2FA enrollment', async () => {
    render(
      <ActivateTenantView
        onSuccess={onSuccess}
        onBackToLogin={onBackToLogin}
      />
    );

    // Wait for stage 2 to mount
    await screen.findByText('Stark Industries');

    // Enter administrator password
    const passwordInput = screen.getByPlaceholderText('Enter your registration password');
    await userEvent.type(passwordInput, 'StarkMaster2026!');

    const proceedBtn = screen.getByRole('button', { name: /continue to 2fa setup/i });
    fireEvent.click(proceedBtn);

    // Should transition to Stage 3: 2FA Enrollment
    expect(await screen.findByText(/set up two-factor authentication/i)).toBeInTheDocument();
    expect(screen.getByText(/scan the qr code/i)).toBeInTheDocument();
  });

  it('completes activation with 2FA code and transitions to success screen', async () => {
    vi.mocked(api.completeActivation).mockResolvedValueOnce({
      success: true,
      message: 'Tenant activated',
      token: 'final-jwt-active-token',
      user: {
        id: 'user-tony',
        email: 'tony@starkindustries.test',
        role: 'TENANT_ADMIN',
        tenantId: 'tenant-test-123',
      },
    });

    render(
      <ActivateTenantView
        onSuccess={onSuccess}
        onBackToLogin={onBackToLogin}
      />
    );

    await screen.findByText('Stark Industries');

    // Stage 2
    const passwordInput = screen.getByPlaceholderText('Enter your registration password');
    await userEvent.type(passwordInput, 'StarkMaster2026!');

    const proceedBtn = screen.getByRole('button', { name: /continue to 2fa setup/i });
    fireEvent.click(proceedBtn);

    // Stage 3
    await screen.findByText(/set up two-factor authentication/i);

    // Fill 6 digits
    const inputs = screen.getAllByRole('textbox');
    for (let i = 0; i < 6; i++) {
      fireEvent.change(inputs[i], { target: { value: String(i + 1) } });
    }

    const activateBtn = screen.getByRole('button', { name: /complete activation/i });
    fireEvent.click(activateBtn);

    // Should transition to Stage 4: Congratulations
    expect(await screen.findByText(/account activated/i)).toBeInTheDocument();

    const dashboardBtn = screen.getByRole('button', { name: /go to admin dashboard/i });
    fireEvent.click(dashboardBtn);

    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'user-tony',
        email: 'tony@starkindustries.test',
      })
    );
  });
});
