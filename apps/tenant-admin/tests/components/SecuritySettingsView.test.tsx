import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecuritySettingsView } from '../../src/components/SecuritySettingsView';
import { api } from '../../src/api';
import { SecuritySettings, UserContext } from '../../src/types';

vi.mock('../../src/api', () => ({
  api: {
    getSecuritySettings: vi.fn(),
    sendRecoveryEmailOtp: vi.fn(),
    verifyRecoveryEmailOtp: vi.fn(),
    removeRecoveryEmail: vi.fn(),
    update2FaMode: vi.fn(),
    setupTotp2Fa: vi.fn(),
    confirmTotp2Fa: vi.fn(),
  },
}));

const mockUser: UserContext = {
  id: 'admin-1',
  email: 'admin@acmecorp.com',
  role: 'TENANT_ADMIN',
  tenantId: 'tenant-1',
};

const initialSettings: SecuritySettings = {
  email: 'admin@acmecorp.com',
  recoveryEmail: 'recovery@personal.org',
  twoFactorEnabled: true,
  twoFactorMethod: 'totp',
  hasTotpConfigured: true,
};

describe('SecuritySettingsView Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getSecuritySettings).mockResolvedValue(initialSettings);
  });

  it('renders initial security settings, active 2FA badge, and verified recovery email', async () => {
    render(<SecuritySettingsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('Account Security')).toBeInTheDocument();
      expect(screen.getAllByText('recovery@personal.org').length).toBeGreaterThan(0);
      expect(screen.getByText('Authenticator App (TOTP)')).toBeInTheDocument();
    });

    expect(screen.getByText('Two-Factor Authentication (2FA) Methods')).toBeInTheDocument();
    expect(screen.getByText('Recovery Email Address')).toBeInTheDocument();
  });

  it('allows switching 2FA mode to Email OTP', async () => {
    const user = userEvent.setup();
    vi.mocked(api.update2FaMode).mockResolvedValue({
      success: true,
      message: 'Updated to email',
      twoFactorEnabled: true,
      twoFactorMethod: 'email',
    });

    render(<SecuritySettingsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('Switch to Email 2FA')).toBeInTheDocument();
    });

    const switchBtn = screen.getByText('Switch to Email 2FA');
    await user.click(switchBtn);

    expect(api.update2FaMode).toHaveBeenCalledWith('email');
    await waitFor(() => {
      expect(screen.getByText(/Two-Factor Authentication updated to Email OTP/i)).toBeInTheDocument();
    });
  });

  it('allows initiating Authenticator App setup in a 2-step popup modal with QR code and confirmation code', async () => {
    const user = userEvent.setup();
    vi.mocked(api.setupTotp2Fa).mockResolvedValue({
      secret: 'JBSWY3DPEHPK3PXP',
      qrCodeDataUrl: 'data:image/png;base64,mockqr',
    });
    vi.mocked(api.confirmTotp2Fa).mockResolvedValue({
      success: true,
      message: 'TOTP confirmed',
    });

    render(<SecuritySettingsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('Reconfigure App')).toBeInTheDocument();
    });

    // Open Authenticator Modal
    await user.click(screen.getByText('Reconfigure App'));

    expect(api.setupTotp2Fa).toHaveBeenCalled();

    // Step 1: Scan QR Code
    await waitFor(() => {
      expect(screen.getByText('Scan QR Code')).toBeInTheDocument();
      expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
      expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    });

    // Advance to Step 2
    const nextBtn = screen.getByText(/Next: Enter Code/i);
    await user.click(nextBtn);

    // Step 2: Verify Code
    await waitFor(() => {
      expect(screen.getByText('Verify Code')).toBeInTheDocument();
      expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
    });

    const codeInput = screen.getByPlaceholderText('000000');
    await user.type(codeInput, '654321');

    const confirmBtn = screen.getByRole('button', { name: /Verify & Activate/i });
    await user.click(confirmBtn);

    expect(api.confirmTotp2Fa).toHaveBeenCalledWith('654321');
    await waitFor(() => {
      expect(screen.getByText(/Authenticator App 2FA successfully configured and activated/i)).toBeInTheDocument();
    });
  });

  it('allows adding and verifying a new recovery email via 2-step popup modal and 6-digit OTP', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getSecuritySettings).mockResolvedValue({
      ...initialSettings,
      recoveryEmail: null,
    });
    vi.mocked(api.sendRecoveryEmailOtp).mockResolvedValue({
      success: true,
      message: 'OTP sent',
      expiresMinutes: 10,
    });
    vi.mocked(api.verifyRecoveryEmailOtp).mockResolvedValue({
      success: true,
      message: 'Verified',
      recoveryEmail: 'new-recovery@gmail.com',
    });

    render(<SecuritySettingsView user={mockUser} />);

    // Page initially shows clean empty state
    await waitFor(() => {
      expect(screen.getByText('No recovery email configured')).toBeInTheDocument();
      expect(screen.getByText('Add Recovery Email')).toBeInTheDocument();
    });

    // Open Recovery Email Modal
    await user.click(screen.getByText('Add Recovery Email'));

    // Step 1: Enter Email
    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('e.g. backup@gmail.com')).toBeInTheDocument();
    });

    const emailInput = screen.getByPlaceholderText('e.g. backup@gmail.com');
    await user.type(emailInput, 'new-recovery@gmail.com');

    const continueBtn = screen.getByRole('button', { name: /Continue/i });
    await user.click(continueBtn);

    expect(api.sendRecoveryEmailOtp).toHaveBeenCalledWith('new-recovery@gmail.com');

    // Step 2: Verify OTP in Modal
    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('123456')).toBeInTheDocument();
    });

    const otpInput = screen.getByPlaceholderText('123456');
    await user.type(otpInput, '123456');

    const verifyBtn = screen.getByRole('button', { name: /Verify & Save/i });
    await user.click(verifyBtn);

    expect(api.verifyRecoveryEmailOtp).toHaveBeenCalledWith('123456');

    await waitFor(() => {
      expect(screen.getByText(/Recovery email verified and updated successfully/i)).toBeInTheDocument();
      expect(screen.getAllByText('new-recovery@gmail.com').length).toBeGreaterThan(0);
    });
  });

  it('allows removing an existing recovery email with confirmation dialog', async () => {
    const user = userEvent.setup();
    vi.mocked(api.removeRecoveryEmail).mockResolvedValue({
      success: true,
      message: 'Recovery email removed',
    });

    render(<SecuritySettingsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Remove recovery email')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Remove recovery email'));

    expect(screen.getByText('Remove Recovery Email?')).toBeInTheDocument();

    await user.click(screen.getByText('Yes, Remove'));

    expect(api.removeRecoveryEmail).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText('Recovery email removed.')).toBeInTheDocument();
    });
  });

  it('prompts confirmation modal before disabling 2FA', async () => {
    const user = userEvent.setup();
    vi.mocked(api.update2FaMode).mockResolvedValue({
      success: true,
      message: '2FA disabled',
      twoFactorEnabled: false,
      twoFactorMethod: null,
    });

    render(<SecuritySettingsView user={mockUser} />);

    await waitFor(() => {
      expect(screen.getByText('Disable 2FA')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Disable 2FA'));

    expect(screen.getByText('Disable 2FA?')).toBeInTheDocument();

    await user.click(screen.getByText('Yes, Disable 2FA'));

    expect(api.update2FaMode).toHaveBeenCalledWith('disabled');

    await waitFor(() => {
      expect(screen.getByText(/Two-Factor Authentication has been disabled/i)).toBeInTheDocument();
    });
  });
});
