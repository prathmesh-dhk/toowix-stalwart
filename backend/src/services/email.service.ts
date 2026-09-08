import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';

export interface TenantActivationEmailParams {
  to: string;
  companyName: string;
  applicantName: string;
  domainName: string;
  activationLink: string;
  expiresHours?: number;
}

export interface PasswordResetOtpEmailParams {
  to: string;
  recipientName?: string;
  otpCode: string;
  expiresMinutes?: number;
}

export interface OtpEmailParams {
  to: string;
  recipientName?: string;
  otpCode: string;
  expiresMinutes?: number;
}

export interface EmailDispatchResult {
  success: boolean;
  activationLink: string;
  messageId?: string;
  error?: string;
}

export class EmailService {
  private transporter: Transporter | null = null;

  private getTransporter(): Transporter {
    if (!this.transporter) {
      if (process.env.VITEST === 'true' || config.nodeEnv === 'test') {
        this.transporter = nodemailer.createTransport({
          jsonTransport: true,
        });
        return this.transporter;
      }

      const transportOptions: any = {
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 5000,
        tls: {
          rejectUnauthorized: false,
        },
      } as any;

      if (config.smtp.user && config.smtp.password) {
        (transportOptions as any).auth = {
          user: config.smtp.user,
          pass: config.smtp.password,
        };
      }

      this.transporter = nodemailer.createTransport(transportOptions);
    }
    return this.transporter;
  }

  /**
   * Generates a modern, responsive HTML email template for tenant onboarding.
   */
  private buildActivationEmailHtml(params: TenantActivationEmailParams): string {
    const { companyName, applicantName, domainName, activationLink, expiresHours = 48 } = params;

    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Activate your Toowix Mail Platform account</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #0b1120;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #e2e8f0;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 12px;
      overflow: hidden;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .header {
      background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
      padding: 32px;
      text-align: center;
      border-bottom: 1px solid #1e293b;
    }
    .logo-text {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #38bdf8;
      margin: 0;
    }
    .logo-sub {
      font-size: 13px;
      color: #94a3b8;
      margin-top: 4px;
    }
    .content {
      padding: 32px;
    }
    h1 {
      font-size: 20px;
      color: #f8fafc;
      margin-top: 0;
      margin-bottom: 16px;
    }
    p {
      font-size: 15px;
      line-height: 1.6;
      color: #cbd5e1;
      margin-top: 0;
      margin-bottom: 20px;
    }
    .info-card {
      background: #1e293b;
      border-left: 4px solid #38bdf8;
      border-radius: 6px;
      padding: 16px;
      margin-bottom: 28px;
    }
    .info-row {
      display: flex;
      margin-bottom: 8px;
      font-size: 14px;
    }
    .info-row:last-child {
      margin-bottom: 0;
    }
    .info-label {
      color: #94a3b8;
      width: 140px;
      font-weight: 500;
    }
    .info-val {
      color: #f1f5f9;
      font-weight: 600;
    }
    .btn-container {
      text-align: center;
      margin: 32px 0;
    }
    .btn {
      display: inline-block;
      background: linear-gradient(135deg, #0284c7 0%, #0369a1 100%);
      color: #ffffff !important;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      padding: 14px 32px;
      border-radius: 8px;
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);
    }
    .notice {
      background: rgba(234, 179, 8, 0.1);
      border: 1px solid rgba(234, 179, 8, 0.2);
      border-radius: 6px;
      padding: 14px;
      font-size: 13px;
      color: #facc15;
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .link-fallback {
      font-size: 12px;
      color: #64748b;
      word-break: break-all;
      background: #090d16;
      padding: 12px;
      border-radius: 6px;
      border: 1px solid #1e293b;
    }
    .footer {
      padding: 24px 32px;
      text-align: center;
      border-top: 1px solid #1e293b;
      font-size: 12px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-text">TOOWIX MAIL PLATFORM</div>
      <div class="logo-sub">Enterprise Multi-Tenant Mail Infrastructure</div>
    </div>
    <div class="content">
      <h1>Application Approved!</h1>
      <p>Hello <strong>${applicantName}</strong>,</p>
      <p>Great news! Your organization's registration application for <strong>${companyName}</strong> has been reviewed and approved by the platform administrator.</p>
      
      <div class="info-card">
        <div class="info-row">
          <span class="info-label">Organization:</span>
          <span class="info-val">${companyName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Dedicated Domain:</span>
          <span class="info-val">${domainName}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Contact Email:</span>
          <span class="info-val">${params.to}</span>
        </div>
      </div>

      <p>To finalize your onboarding and activate your Tenant Administrator account, please click the link below to set your password and configure mandatory Two-Factor Authentication (2FA):</p>

      <div class="btn-container">
        <a href="${activationLink}" class="btn" target="_blank">Activate Your Organization Account</a>
      </div>

      <div class="notice">
        <strong>⚠️ Important Security Note:</strong> This activation link is single-use and will expire in <strong>${expiresHours} hours</strong>. If you did not request this account, please ignore this message.
      </div>

      <p style="font-size: 13px; color: #94a3b8; margin-bottom: 8px;">If the button above does not work, copy and paste this link into your browser:</p>
      <div class="link-fallback">${activationLink}</div>
    </div>
    <div class="footer">
      &copy; ${new Date().getFullYear()} Toowix Mail Platform. All rights reserved.
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Generates a plain-text version of the activation email for clients without HTML support.
   */
  private buildActivationEmailText(params: TenantActivationEmailParams): string {
    const { companyName, applicantName, domainName, activationLink, expiresHours = 48 } = params;

    return `
TOOWIX MAIL PLATFORM - ACCOUNT ACTIVATION

Hello ${applicantName},

Your application to register ${companyName} on the Toowix Mail Platform has been approved!

Organization: ${companyName}
Dedicated Domain: ${domainName}
Contact Email: ${params.to}

To complete your setup and activate your Tenant Administrator account, visit the activation link below:
${activationLink}

IMPORTANT:
- This single-use link will expire in ${expiresHours} hours.
- You will be required to create your password and set up 2-Factor Authentication (2FA).

If you did not request this, please disregard this email.
    `.trim();
  }

  /**
   * Sends the tenant activation email via configured SMTP transport.
   * If SMTP delivery fails or is unreachable in dev/test, logs the details cleanly and returns fallback metadata.
   */
  async sendTenantActivationEmail(params: TenantActivationEmailParams): Promise<EmailDispatchResult> {
    const subject = `Activate your Toowix Mail Platform account — ${params.companyName}`;
    const html = this.buildActivationEmailHtml(params);
    const text = this.buildActivationEmailText(params);

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: config.smtp.from,
        to: params.to,
        subject,
        text,
        html,
      });

      console.log(`\n============================================================`);
      console.log(`[EMAIL DISPATCH: SUCCESS] Tenant Activation Email`);
      console.log(`To: ${params.to} (${params.applicantName})`);
      console.log(`Organization: ${params.companyName} (${params.domainName})`);
      console.log(`Message ID: ${info.messageId}`);
      console.log(`Activation Link: ${params.activationLink}`);
      console.log(`============================================================\n`);

      return {
        success: true,
        activationLink: params.activationLink,
        messageId: info.messageId,
      };
    } catch (err: any) {
      console.warn(`\n============================================================`);
      console.warn(`[EMAIL DISPATCH: SMTP OFFLINE / FALLBACK]`);
      console.warn(`Could not deliver email to ${params.to} via SMTP (${err.message}).`);
      console.warn(`To: ${params.to} (${params.applicantName})`);
      console.warn(`Organization: ${params.companyName} (${params.domainName})`);
      console.warn(`Activation Link: ${params.activationLink}`);
      console.warn(`Valid for: ${params.expiresHours || 48} hours`);
      console.warn(`============================================================\n`);

      return {
        success: false,
        activationLink: params.activationLink,
        error: err.message,
      };
    }
  }

  /**
   * Dispatches a 6-digit one-time password (OTP) to the administrator's recovery email.
   */
  async sendPasswordResetOtpEmail(params: PasswordResetOtpEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const expiresMinutes = params.expiresMinutes || 10;
    const subject = `Toowix Security: Your Password Reset Code is ${params.otpCode}`;
    const text = `
Hello ${params.recipientName || 'Administrator'},

You requested a password reset for your Toowix Mail Platform administrator account.

Your single-use 6-digit verification code is:

${params.otpCode}

This code will expire in ${expiresMinutes} minutes. If you did not request a password reset, please secure your account immediately.

— The Toowix Security Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 32px; color: #f8fafc;">
  <div style="max-width: 540px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px; border: 1px solid #334155;">
    <div style="display: flex; align-items: center; margin-bottom: 24px;">
      <div style="background: #4f46e5; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; color: #ffffff;">T</div>
      <span style="font-size: 1.1rem; font-weight: 700; color: #ffffff; margin-left: 12px; letter-spacing: 0.5px;">Toowix Mail Platform</span>
    </div>
    <h2 style="color: #ffffff; margin-top: 0; font-size: 1.4rem;">Password Reset Verification</h2>
    <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.6;">
      Hello ${params.recipientName || 'Administrator'},<br/>
      We received a request to reset the password for your Toowix administrator account. Use the one-time security code below to complete your verification:
    </p>
    <div style="background: #0f172a; border: 1px solid #4f46e5; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
      <span style="font-family: monospace; font-size: 2.2rem; font-weight: 800; letter-spacing: 8px; color: #818cf8;">${params.otpCode}</span>
    </div>
    <p style="color: #cbd5e1; font-size: 0.85rem; line-height: 1.5;">
      ⚠️ This code expires in <strong>${expiresMinutes} minutes</strong> and can only be used once.<br/>
      If you did not request this verification code, please ignore this email or contact platform security.
    </p>
  </div>
</body>
</html>
    `.trim();

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: config.smtp.from,
        to: params.to,
        subject,
        text,
        html,
      });

      console.log(`\n============================================================`);
      console.log(`[EMAIL DISPATCH: SUCCESS] Password Reset OTP Code`);
      console.log(`To: ${params.to}`);
      console.log(`OTP Code: ${params.otpCode} (Expires in ${expiresMinutes} min)`);
      console.log(`Message ID: ${info.messageId}`);
      console.log(`============================================================\n`);

      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      console.warn(`\n============================================================`);
      console.warn(`[EMAIL DISPATCH: OTP FALLBACK / LOGGED]`);
      console.warn(`Could not deliver OTP to ${params.to} via SMTP: ${err.message}`);
      console.warn(`OTP Code: ${params.otpCode}`);
      console.warn(`============================================================\n`);

      return { success: false, error: err.message };
    }
  }

  /**
   * Dispatches a 6-digit one-time code to verify a recovery email during tenant registration.
   */
  async sendRecoveryEmailVerificationOtpEmail(params: OtpEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const expiresMinutes = params.expiresMinutes || 10;
    const subject = `Toowix Verification: Your Recovery Email Verification Code is ${params.otpCode}`;
    const text = `
Hello ${params.recipientName || 'Administrator'},

Please use the following 6-digit code to verify your recovery email for your Toowix organization account:

${params.otpCode}

This code will expire in ${expiresMinutes} minutes. If you did not initiate this request, you can safely ignore this email.

— The Toowix Security Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 32px; color: #f8fafc;">
  <div style="max-width: 540px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px; border: 1px solid #334155;">
    <div style="display: flex; align-items: center; margin-bottom: 24px;">
      <div style="background: #10b981; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; color: #ffffff;">T</div>
      <span style="font-size: 1.1rem; font-weight: 700; color: #ffffff; margin-left: 12px; letter-spacing: 0.5px;">Toowix Mail Platform</span>
    </div>
    <h2 style="color: #ffffff; margin-top: 0; font-size: 1.4rem;">Verify Your Recovery Email</h2>
    <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.6;">
      Hello ${params.recipientName || 'Administrator'},<br/>
      We received a request to add this address as a verified recovery email for your Toowix organization registration. Use the one-time code below to confirm:
    </p>
    <div style="background: #0f172a; border: 1px solid #10b981; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
      <span style="font-family: monospace; font-size: 2.2rem; font-weight: 800; letter-spacing: 8px; color: #34d399;">${params.otpCode}</span>
    </div>
    <p style="color: #cbd5e1; font-size: 0.85rem; line-height: 1.5;">
      ⚠️ This code expires in <strong>${expiresMinutes} minutes</strong> and can only be used once.<br/>
      If you did not request this verification code, please ignore this email.
    </p>
  </div>
</body>
</html>
    `.trim();

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: config.smtp.from,
        to: params.to,
        subject,
        text,
        html,
      });

      console.log(`\n============================================================`);
      console.log(`[EMAIL DISPATCH: SUCCESS] Recovery Email Verification OTP Code`);
      console.log(`To: ${params.to}`);
      console.log(`OTP Code: ${params.otpCode} (Expires in ${expiresMinutes} min)`);
      console.log(`Message ID: ${info.messageId}`);
      console.log(`============================================================\n`);

      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      console.warn(`\n============================================================`);
      console.warn(`[EMAIL DISPATCH: OTP FALLBACK / LOGGED]`);
      console.warn(`Could not deliver OTP to ${params.to} via SMTP: ${err.message}`);
      console.warn(`OTP Code: ${params.otpCode}`);
      console.warn(`============================================================\n`);

      return { success: false, error: err.message };
    }
  }

  /**
   * Dispatches a 6-digit one-time code to verify a primary contact email during tenant registration.
   */
  async sendContactEmailVerificationOtpEmail(params: OtpEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const expiresMinutes = params.expiresMinutes || 10;
    const subject = `Toowix Verification: Your Contact Email Verification Code is ${params.otpCode}`;
    const text = `
Hello ${params.recipientName || 'Administrator'},

Please use the following 6-digit code to verify your primary contact email address for your Toowix organization account:

${params.otpCode}

This code will expire in ${expiresMinutes} minutes. If you did not initiate this request, you can safely ignore this email.

— The Toowix Security Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 32px; color: #f8fafc;">
  <div style="max-width: 540px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px; border: 1px solid #334155;">
    <div style="display: flex; align-items: center; margin-bottom: 24px;">
      <div style="background: #0284c7; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; color: #ffffff;">T</div>
      <span style="font-size: 1.1rem; font-weight: 700; color: #ffffff; margin-left: 12px; letter-spacing: 0.5px;">Toowix Mail Platform</span>
    </div>
    <h2 style="color: #ffffff; margin-top: 0; font-size: 1.4rem;">Verify Your Contact Email</h2>
    <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.6;">
      Hello ${params.recipientName || 'Administrator'},<br/>
      Please confirm your primary administrative contact email address for organization registration. Use the one-time verification code below:
    </p>
    <div style="background: #0f172a; border: 1px solid #0284c7; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
      <span style="font-family: monospace; font-size: 2.2rem; font-weight: 800; letter-spacing: 8px; color: #38bdf8;">${params.otpCode}</span>
    </div>
    <p style="color: #cbd5e1; font-size: 0.85rem; line-height: 1.5;">
      ⚠️ This code expires in <strong>${expiresMinutes} minutes</strong> and can only be used once.<br/>
      If you did not request this verification code, please ignore this email.
    </p>
  </div>
</body>
</html>
    `.trim();

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: config.smtp.from,
        to: params.to,
        subject,
        text,
        html,
      });

      console.log(`\n============================================================`);
      console.log(`[EMAIL DISPATCH: SUCCESS] Contact Email Verification OTP Code`);
      console.log(`To: ${params.to}`);
      console.log(`OTP Code: ${params.otpCode} (Expires in ${expiresMinutes} min)`);
      console.log(`Message ID: ${info.messageId}`);
      console.log(`============================================================\n`);

      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      console.warn(`\n============================================================`);
      console.warn(`[EMAIL DISPATCH: OTP FALLBACK / LOGGED]`);
      console.warn(`Could not deliver Contact OTP to ${params.to} via SMTP: ${err.message}`);
      console.warn(`OTP Code: ${params.otpCode}`);
      console.warn(`============================================================\n`);

      return { success: false, error: err.message };
    }
  }

  /**
   * Dispatches a 6-digit one-time code to authenticate login via email 2FA.
   */
  async sendLogin2FaOtpEmail(params: OtpEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const expiresMinutes = params.expiresMinutes || 10;
    const subject = `Toowix Security: Your 2FA Login Code is ${params.otpCode}`;
    const text = `
Hello ${params.recipientName || 'Administrator'},

A login attempt requires two-factor security confirmation for your Toowix administrator account.

Your single-use 6-digit security code is:

${params.otpCode}

This code will expire in ${expiresMinutes} minutes. If you did not attempt to sign in, someone may be attempting to access your account.

— The Toowix Security Team
    `.trim();

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8" /></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0f172a; margin: 0; padding: 32px; color: #f8fafc;">
  <div style="max-width: 540px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px; border: 1px solid #334155;">
    <div style="display: flex; align-items: center; margin-bottom: 24px;">
      <div style="background: #6366f1; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; color: #ffffff;">T</div>
      <span style="font-size: 1.1rem; font-weight: 700; color: #ffffff; margin-left: 12px; letter-spacing: 0.5px;">Toowix Mail Platform</span>
    </div>
    <h2 style="color: #ffffff; margin-top: 0; font-size: 1.4rem;">Two-Factor Login Verification</h2>
    <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.6;">
      Hello ${params.recipientName || 'Administrator'},<br/>
      Use the one-time security code below to complete sign in to your administrator portal:
    </p>
    <div style="background: #0f172a; border: 1px solid #6366f1; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
      <span style="font-family: monospace; font-size: 2.2rem; font-weight: 800; letter-spacing: 8px; color: #a5b4fc;">${params.otpCode}</span>
    </div>
    <p style="color: #cbd5e1; font-size: 0.85rem; line-height: 1.5;">
      ⚠️ This code expires in <strong>${expiresMinutes} minutes</strong> and can only be used once.<br/>
      If you did not attempt to sign in, please secure your account immediately.
    </p>
  </div>
</body>
</html>
    `.trim();

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: config.smtp.from,
        to: params.to,
        subject,
        text,
        html,
      });

      console.log(`\n============================================================`);
      console.log(`[EMAIL DISPATCH: SUCCESS] Login 2FA OTP Code`);
      console.log(`To: ${params.to}`);
      console.log(`OTP Code: ${params.otpCode} (Expires in ${expiresMinutes} min)`);
      console.log(`Message ID: ${info.messageId}`);
      console.log(`============================================================\n`);

      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      console.warn(`\n============================================================`);
      console.warn(`[EMAIL DISPATCH: OTP FALLBACK / LOGGED]`);
      console.warn(`Could not deliver OTP to ${params.to} via SMTP: ${err.message}`);
      console.warn(`OTP Code: ${params.otpCode}`);
      console.warn(`============================================================\n`);

      return { success: false, error: err.message };
    }
  }
}

export const emailService = new EmailService();
