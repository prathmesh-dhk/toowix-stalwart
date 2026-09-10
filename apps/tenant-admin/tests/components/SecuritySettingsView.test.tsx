import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  it('allows initiating Authenticator App setup with QR code and confirmation code', async () => {
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

    await user.click(screen.getByText('Reconfigure App'));

    expect(api.setupTotp2Fa).toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByText('Configure Authenticator App')).toBeInTheDocument();
      expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeInTheDocument();
    });

    const codeInput = screen.getByPlaceholderText('000000');
    await user.type(codeInput, '654321');

    const confirmBtn = screen.getByText('Confirm & Activate TOTP');
    await user.click(confirmBtn);

    expect(api.confirmTotp2Fa).toHaveBeenCalledWith('654321');
    await waitFor(() => {
      expect(screen.getByText(/Authenticator App 2FA successfully configured and activated/i)).toBeInTheDocument();
    });
  });

  it('allows adding and verifying a new recovery email via 6-digit OTP', async () => {
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

    await waitFor(() => {
      expect(screen.getByPlaceholderText('e.g. backup@gmail.com')).toBeInTheDocument();
    });

    const emailInput = screen.getByPlaceholderText('e.g. backup@gmail.com');
    await user.type(emailInput, 'new-recovery@gmail.com');

    const sendBtn = screen.getByText('Send Verification Code');
    await user.click(sendBtn);

    expect(api.sendRecoveryEmailOtp).toHaveBeenCalledWith('new-recovery@gmail.com');

    await waitFor(() => {
      expect(screen.getByPlaceholderText('123456')).toBeInTheDocument();
    });

    const otpInput = screen.getByPlaceholderText('123456');
    await user.type(otpInput, '123456');

    const verifyBtn = screen.getByText('Verify & Save Email');
    await user.click(verifyBtn);

    expect(api.verifyRecoveryEmailOtp).toHaveBeenCalledWith('123456');

    await waitFor(() => {
      expect(screen.getByText(/Recovery email verified and updated successfully/i)).toBeInTheDocument();
      expect(screen.getAllByText('new-recovery@gmail.com').length).toBeGreaterThan(0);
    });
  });

  it('allows removing an existing recovery email', async () => {
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

  it('prompts confirmation before disabling 2FA', async () => {
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

    expect(screen.getByText('Are you sure you want to disable 2FA?')).toBeInTheDocument();

    await user.click(screen.getByText('Yes, Disable 2FA'));

    expect(api.update2FaMode).toHaveBeenCalledWith('disabled');

    await waitFor(() => {
      expect(screen.getByText(/Two-Factor Authentication has been disabled/i)).toBeInTheDocument();
    });
  });
});
