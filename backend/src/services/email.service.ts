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

export interface BackupCodesEmailParams {
  to: string;
  recipientName?: string;
  backupCodes: string[];
}

export interface DomainActivationFailedEmailParams {
  to: string;
  recipientName?: string;
  domainName: string;
  reason: 'conflict' | 'propagation_timeout';
  conflictDetails?: Array<{ type: string; name: string; foundValue: string }>;
}

export interface BillingGraceStartedEmailParams {
  to: string;
  recipientName?: string;
  domainName: string;
  gracePeriodEndsAt: Date;
}

export interface EmailDispatchResult {
  success: boolean;
  activationLink: string;
  messageId?: string;
  error?: string;
}

/**
 * Shared HTML shell for all transactional Toowix emails.
 * Built using table-based email layouts and inline styles for robust rendering across
 * Apple Mail, Gmail (Web & Mobile), Outlook (Windows, Mac, Web), and modern clients.
 */
function renderEmailShell(params: {
  title: string;
  previewText?: string;
  contentHtml: string;
}): string {
  const { title, previewText, contentHtml } = params;
  const currentYear = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <title>${title}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; height: 100% !important; background-color: #F8FAFC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    @media only screen and (max-width: 600px) {
      .email-shell-td { padding: 16px 8px !important; }
      .email-card-td { padding: 24px 20px !important; border-radius: 8px !important; }
      .email-code-text { font-size: 26px !important; letter-spacing: 4px !important; }
      .backup-grid-col { display: block !important; width: 100% !important; box-sizing: border-box !important; margin-bottom: 8px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F8FAFC; color: #334155; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
  ${
    previewText
      ? `<div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #F8FAFC; opacity: 0;">
    ${previewText}
  </div>`
      : ''
  }
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F8FAFC; table-layout: fixed;">
    <tr>
      <td align="center" class="email-shell-td" style="padding: 40px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px; margin: 0 auto; text-align: left;">
          <!-- Card Container -->
          <tr>
            <td class="email-card-td" style="background-color: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 12px; padding: 36px 32px; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);">
              <!-- Brand Header -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom: 28px;">
                <tr>
                  <td style="vertical-align: middle;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="background-color: #4F46E5; width: 34px; height: 34px; border-radius: 8px; text-align: center; vertical-align: middle;">
                          <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 18px; font-weight: 700; color: #FFFFFF; line-height: 34px; display: block;">&#9993;</span>
                        </td>
                        <td style="padding-left: 10px; vertical-align: middle;">
                          <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 19px; font-weight: 700; color: #0F172A; letter-spacing: -0.4px;">toowix</span>
                          <span style="display: inline-block; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.6px; color: #4F46E5; background-color: #EEF2FF; border: 1px solid #E0E7FF; padding: 2px 7px; border-radius: 4px; margin-left: 6px; vertical-align: middle;">Mail Platform</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Main Content -->
              ${contentHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 12px; text-align: center; font-size: 12px; line-height: 1.6; color: #94A3B8;">
              <p style="margin: 0 0 4px 0;">This is an automated operational message from Toowix Mail Platform.</p>
              <p style="margin: 0;">&copy; ${currentYear} Toowix. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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

    const contentHtml = `
      <h1 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">Your organization account is ready</h1>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
        Hello ${applicantName}, your registration application for <strong>${companyName}</strong> on <strong>${domainName}</strong> has been approved. Complete your setup below to activate your administrative portal.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; margin-bottom: 24px;">
        <tr>
          <td style="padding: 16px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="padding: 4px 0; font-size: 13px; color: #64748B; width: 140px; font-weight: 500;">Organization</td>
                <td style="padding: 4px 0; font-size: 13px; color: #0F172A; font-weight: 600;">${companyName}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; font-size: 13px; color: #64748B; font-weight: 500;">Dedicated Domain</td>
                <td style="padding: 4px 0; font-size: 13px; color: #0F172A; font-weight: 600;">${domainName}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; font-size: 13px; color: #64748B; font-weight: 500;">Contact Email</td>
                <td style="padding: 4px 0; font-size: 13px; color: #0F172A; font-weight: 600;">${params.to}</td>
              </tr>
              <tr>
                <td style="padding: 4px 0; font-size: 13px; color: #64748B; font-weight: 500;">Link Expiry</td>
                <td style="padding: 4px 0; font-size: 13px; color: #0F172A; font-weight: 600;">${expiresHours} hours</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- CTA Button -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
        <tr>
          <td style="border-radius: 6px; background-color: #4F46E5;">
            <a href="${activationLink}" target="_blank" style="display: inline-block; padding: 13px 28px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 15px; font-weight: 600; color: #FFFFFF; text-decoration: none; border-radius: 6px; background-color: #4F46E5;">
              Complete Account Setup &rarr;
            </a>
          </td>
        </tr>
      </table>

      <!-- Security Callout -->
      <div style="background-color: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px; padding: 12px 16px; margin-bottom: 24px;">
        <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #92400E;">
          <strong>Single-use link:</strong> This setup link expires in <strong>${expiresHours} hours</strong>. You will be prompted to set your administrator password and register mandatory two-factor authentication (2FA).
        </p>
      </div>

      <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748B;">If the button above does not work, copy and paste this link into your browser:</p>
      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 12px; color: #475569; word-break: break-all; background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 10px 12px;">
        ${activationLink}
      </div>
    `;

    return renderEmailShell({
      title: `Activate your Toowix Mail Platform account — ${companyName}`,
      previewText: `Your organization account for ${companyName} is ready. Complete setup within ${expiresHours} hours.`,
      contentHtml,
    });
  }

  /**
   * Generates a plain-text version of the activation email for clients without HTML support.
   */
  private buildActivationEmailText(params: TenantActivationEmailParams): string {
    const { companyName, applicantName, domainName, activationLink, expiresHours = 48 } = params;

    return `TOOWIX MAIL PLATFORM — ACCOUNT ACTIVATION

Hello ${applicantName},

Your registration application for ${companyName} on ${domainName} has been approved.

Organization: ${companyName}
Dedicated Domain: ${domainName}
Contact Email: ${params.to}
Link Expiration: ${expiresHours} hours

Complete your setup by visiting the link below:
${activationLink}

Important:
- This single-use link expires in ${expiresHours} hours.
- You will create your administrator password and configure two-factor authentication (2FA).

If you did not apply for this account, no action is needed; you can safely disregard this message.

— The Toowix Platform Team`.trim();
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
    const subject = `Toowix security code: ${params.otpCode}`;
    const text = `TOOWIX MAIL PLATFORM — PASSWORD RESET

Hello ${params.recipientName || 'Administrator'},

We received a request to reset the password for your Toowix administrator account.

Your single-use verification code:
${params.otpCode}

This code expires in ${expiresMinutes} minutes. If you did not request a password reset, you can safely ignore this email; your account credentials have not changed.

— The Toowix Security Team`.trim();

    const contentHtml = `
      <h1 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">Password reset verification</h1>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
        Hello ${params.recipientName || 'Administrator'}, we received a request to reset the password for your Toowix administrator account. Enter this one-time code to proceed:
      </p>

      <div style="background-color: #F8FAFC; border: 1px solid #CBD5E1; border-radius: 8px; padding: 22px 16px; text-align: center; margin: 24px 0;">
        <span class="email-code-text" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0F172A; display: inline-block;">${params.otpCode}</span>
      </div>

      <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.5; color: #64748B;">
        This single-use code will expire in <strong>${expiresMinutes} minutes</strong>.
      </p>
      <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 12px 14px;">
        <p style="margin: 0; font-size: 12px; line-height: 1.5; color: #64748B;">
          If you did not initiate a password reset, no action is needed. Your existing password remains secure.
        </p>
      </div>
    `;

    const html = renderEmailShell({
      title: 'Password Reset Verification',
      previewText: `Your verification code is ${params.otpCode}. Expires in ${expiresMinutes} minutes.`,
      contentHtml,
    });

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
    const subject = `Verify your recovery email: ${params.otpCode}`;
    const text = `TOOWIX MAIL PLATFORM — EMAIL VERIFICATION

Hello ${params.recipientName || 'Administrator'},

Use the 6-digit code below to confirm this address as a verified recovery email for your Toowix account:

${params.otpCode}

This code expires in ${expiresMinutes} minutes. If you did not initiate this request, you can safely ignore this email.

— The Toowix Security Team`.trim();

    const contentHtml = `
      <h1 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">Verify recovery email</h1>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
        Hello ${params.recipientName || 'Administrator'}, use the code below to confirm this address as a verified recovery email for your Toowix organization account:
      </p>

      <div style="background-color: #F8FAFC; border: 1px solid #CBD5E1; border-radius: 8px; padding: 22px 16px; text-align: center; margin: 24px 0;">
        <span class="email-code-text" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0F172A; display: inline-block;">${params.otpCode}</span>
      </div>

      <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #64748B;">
        This code expires in <strong>${expiresMinutes} minutes</strong> and can only be used once. If you did not initiate this request, you can safely ignore this message.
      </p>
    `;

    const html = renderEmailShell({
      title: 'Verify Your Recovery Email',
      previewText: `Your recovery email verification code is ${params.otpCode}.`,
      contentHtml,
    });

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
    const subject = `Verify your contact email: ${params.otpCode}`;
    const text = `TOOWIX MAIL PLATFORM — EMAIL VERIFICATION

Hello ${params.recipientName || 'Administrator'},

Use the 6-digit code below to confirm this address as the primary administrative contact for your organization registration:

${params.otpCode}

This code expires in ${expiresMinutes} minutes. If you did not request this verification, you can safely ignore this email.

— The Toowix Security Team`.trim();

    const contentHtml = `
      <h1 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">Verify contact email</h1>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
        Hello ${params.recipientName || 'Administrator'}, use the code below to confirm your primary administrative contact email for organization registration:
      </p>

      <div style="background-color: #F8FAFC; border: 1px solid #CBD5E1; border-radius: 8px; padding: 22px 16px; text-align: center; margin: 24px 0;">
        <span class="email-code-text" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0F172A; display: inline-block;">${params.otpCode}</span>
      </div>

      <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #64748B;">
        This code expires in <strong>${expiresMinutes} minutes</strong> and can only be used once. If you did not submit an organization registration, no action is needed.
      </p>
    `;

    const html = renderEmailShell({
      title: 'Verify Your Contact Email',
      previewText: `Your contact email verification code is ${params.otpCode}.`,
      contentHtml,
    });

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
   * Final-confirmation OTP for permanently deleting an organisation. Sent only to the
   * acting admin's own email, and worded so it is unmistakable what the code authorises.
   */
  // (organisationName / recipientName are user-controlled, so they are escaped before entering HTML)
  async sendOrganisationDeletionOtpEmail(
    params: OtpEmailParams & { organisationName: string }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const expiresMinutes = params.expiresMinutes || 10;
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const orgHtml = esc(params.organisationName);
    const nameHtml = esc(params.recipientName || 'Administrator');
    const subject = `Organisation deletion code: ${params.otpCode}`;
    const text = `TOOWIX MAIL PLATFORM — ORGANISATION DELETION

Hello ${params.recipientName || 'Administrator'},

Use the 6-digit code below to authorise the PERMANENT deletion of "${params.organisationName}", including all of its domains, mailboxes and administrator accounts:

${params.otpCode}

This code expires in ${expiresMinutes} minutes. If you did not request this, do not share the code — sign in and cancel the deletion, then change your password.

— The Toowix Security Team`.trim();

    const contentHtml = `
      <h1 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">Confirm organisation deletion</h1>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
        Hello ${nameHtml}, use the code below to authorise the <strong>permanent deletion</strong> of <strong>${orgHtml}</strong>, including all of its domains, mailboxes and administrator accounts.
      </p>

      <div style="background-color: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 22px 16px; text-align: center; margin: 24px 0;">
        <span class="email-code-text" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #7F1D1D; display: inline-block;">${params.otpCode}</span>
      </div>

      <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #64748B;">
        This code expires in <strong>${expiresMinutes} minutes</strong>. If you did not request this, do not share the code — sign in, cancel the deletion and change your password.
      </p>
    `;

    const html = renderEmailShell({
      title: 'Confirm Organisation Deletion',
      previewText: `Your organisation deletion code is ${params.otpCode}.`,
      contentHtml,
    });

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({ from: config.smtp.from, to: params.to, subject, text, html });
      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      console.warn(`[EMAIL DISPATCH: FAILED] Could not deliver organisation deletion OTP to ${params.to}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Dispatches a 6-digit one-time code to authenticate login via email 2FA.
   */
  async sendLogin2FaOtpEmail(params: OtpEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const expiresMinutes = params.expiresMinutes || 10;
    const subject = `Your sign-in verification code: ${params.otpCode}`;
    const text = `TOOWIX MAIL PLATFORM — TWO-FACTOR VERIFICATION

Hello ${params.recipientName || 'Administrator'},

A sign-in attempt requires two-factor security confirmation for your Toowix administrator account.

Your single-use sign-in code:
${params.otpCode}

This code expires in ${expiresMinutes} minutes. If you did not attempt to sign in, someone may know your password. Please sign in immediately to update your credentials and review account security.

— The Toowix Security Team`.trim();

    const contentHtml = `
      <h1 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">Sign-in verification code</h1>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
        Hello ${params.recipientName || 'Administrator'}, enter the security code below to complete sign-in to your Toowix administrator portal:
      </p>

      <div style="background-color: #F8FAFC; border: 1px solid #CBD5E1; border-radius: 8px; padding: 22px 16px; text-align: center; margin: 24px 0;">
        <span class="email-code-text" style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0F172A; display: inline-block;">${params.otpCode}</span>
      </div>

      <p style="margin: 0 0 16px 0; font-size: 14px; line-height: 1.5; color: #64748B;">
        This code expires in <strong>${expiresMinutes} minutes</strong> and can only be used once.
      </p>

      <div style="background-color: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 12px 14px;">
        <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #991B1B;">
          <strong>Security notice:</strong> If you did not attempt to sign in, someone may know your password. Sign in immediately to change your password and review recent security events.
        </p>
      </div>
    `;

    const html = renderEmailShell({
      title: 'Two-Factor Login Verification',
      previewText: `Your sign-in verification code is ${params.otpCode}.`,
      contentHtml,
    });

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

  /**
   * Dispatches emergency 2FA backup codes to the administrator's email.
   */
  async sendBackupCodesEmail(params: BackupCodesEmailParams): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const subject = 'Your emergency backup codes — Toowix Mail Platform';
    const formattedCodeList = params.backupCodes.map((code, idx) => `  ${idx + 1}. ${code}`).join('\n');
    const text = `TOOWIX MAIL PLATFORM — 2FA EMERGENCY BACKUP CODES

Hello ${params.recipientName || 'Administrator'},

Two-factor authentication has been configured for your account. Below are your 10 single-use emergency backup codes. Store them in a secure location (such as a password manager):

${formattedCodeList}

Important:
- Each code can only be used once to sign in if you lose access to your primary 2FA method.
- Once used, the code is deactivated.
- You can regenerate a new set of codes at any time from your Security Settings, which immediately invalidates all prior codes.

If you did not enable two-factor authentication, please contact your platform administrator immediately.

— The Toowix Security Team`.trim();

    // 2-column tabular layout for bulletproof email rendering
    const rows: string[] = [];
    for (let i = 0; i < params.backupCodes.length; i += 2) {
      const code1 = params.backupCodes[i];
      const code2 = params.backupCodes[i + 1];
      rows.push(`
        <tr>
          <td class="backup-grid-col" width="48%" style="padding: 4px 6px;">
            <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 10px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 14px; font-weight: 700; color: #0F172A; text-align: center; letter-spacing: 1px;">
              ${code1}
            </div>
          </td>
          ${
            code2
              ? `<td class="backup-grid-col" width="48%" style="padding: 4px 6px;">
            <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 6px; padding: 10px 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 14px; font-weight: 700; color: #0F172A; text-align: center; letter-spacing: 1px;">
              ${code2}
            </div>
          </td>`
              : '<td width="48%"></td>'
          }
        </tr>
      `);
    }

    const contentHtml = `
      <h1 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">Emergency backup codes</h1>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
        Hello ${params.recipientName || 'Administrator'}, two-factor authentication has been configured for your account. Below are your 10 single-use emergency backup codes. Store them in a secure place, such as a password manager:
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 16px 0;">
        ${rows.join('')}
      </table>

      <div style="background-color: #EEF2FF; border: 1px solid #C7D2FE; border-radius: 8px; padding: 14px 16px; margin: 24px 0 16px 0;">
        <ul style="margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.5; color: #3730A3;">
          <li style="margin-bottom: 4px;">Each backup code can only be used <strong>once</strong>.</li>
          <li style="margin-bottom: 4px;">Once used, the code is permanently deactivated.</li>
          <li>You can regenerate a new set at any time from your <strong>Security Settings</strong>, which immediately invalidates all prior codes.</li>
        </ul>
      </div>

      <p style="margin: 0; font-size: 12px; color: #94A3B8; line-height: 1.5;">
        If you did not configure two-factor authentication, please contact platform security immediately.
      </p>
    `;

    const html = renderEmailShell({
      title: 'Emergency 2FA Backup Codes',
      previewText: '10 single-use emergency backup codes for your Toowix administrator account.',
      contentHtml,
    });

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
      console.log(`[EMAIL DISPATCH: SUCCESS] 2FA Backup Codes`);
      console.log(`To: ${params.to}`);
      console.log(`Codes: ${params.backupCodes.join(', ')}`);
      console.log(`Message ID: ${info.messageId}`);
      console.log(`============================================================\n`);

      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      console.warn(`\n============================================================`);
      console.warn(`[EMAIL DISPATCH: BACKUP CODES FALLBACK / LOGGED]`);
      console.warn(`Could not deliver backup codes to ${params.to} via SMTP: ${err.message}`);
      console.warn(`Backup Codes:\n${params.backupCodes.join('\n')}`);
      console.warn(`============================================================\n`);

      return { success: false, error: err.message };
    }
  }

  /**
   * Notifies an admin that a domain's DNS activation stopped: either a
   * pre-existing conflicting record was found, or the propagation retry
   * window elapsed without the required records verifying publicly.
   */
  async sendDomainActivationFailedEmail(
    params: DomainActivationFailedEmailParams
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const isConflict = params.reason === 'conflict';
    const subject = isConflict
      ? `Action required: Conflicting DNS records found for ${params.domainName}`
      : `Action required: DNS verification timed out for ${params.domainName}`;

    const reasonSummary = isConflict
      ? `A pre-existing conflicting DNS record was detected for ${params.domainName} that Toowix will not overwrite automatically.`
      : `The required DNS records for ${params.domainName} were not detected as published within the allowed verification window.`;

    const text = `TOOWIX MAIL PLATFORM — DOMAIN ACTIVATION NOTICE

Hello ${params.recipientName || 'Administrator'},

Domain verification for ${params.domainName} has stopped and requires attention.

${reasonSummary}
${
  params.conflictDetails && params.conflictDetails.length
    ? `\nConflicting Records:\n` +
      params.conflictDetails.map((c) => `  - ${c.type} ${c.name}: ${c.foundValue}`).join('\n')
    : ''
}

Next steps:
1. Log in to your DNS provider's management console.
2. Update or remove the conflicting records listed above.
3. Return to the Toowix Admin portal and select "Retry / Verify".

Existing mail service and mailbox data on other active domains are unaffected.

— The Toowix Platform Team`.trim();

    const conflictHtmlRows = (params.conflictDetails || [])
      .map(
        (c) =>
          `<tr>
            <td style="padding: 8px 12px; border-top: 1px solid #E2E8F0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; color: #0F172A; font-weight: 600;">${c.type}</td>
            <td style="padding: 8px 12px; border-top: 1px solid #E2E8F0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; color: #475569;">${c.name}</td>
            <td style="padding: 8px 12px; border-top: 1px solid #E2E8F0; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; color: #475569; word-break: break-all;">${c.foundValue}</td>
          </tr>`
      )
      .join('');

    const contentHtml = `
      <div style="background-color: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 12px 14px; margin-bottom: 20px;">
        <span style="font-size: 13px; font-weight: 600; color: #B91C1C; text-transform: uppercase; letter-spacing: 0.5px;">Action Required</span>
      </div>

      <h1 style="margin: 0 0 12px 0; font-size: 20px; font-weight: 700; color: #0F172A; letter-spacing: -0.3px;">Domain verification stopped: ${params.domainName}</h1>
      <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
        Hello ${params.recipientName || 'Administrator'}, ${reasonSummary}
      </p>

      ${
        params.conflictDetails && params.conflictDetails.length
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0; border: 1px solid #E2E8F0; border-radius: 8px; overflow: hidden; background-color: #FFFFFF;">
              <thead>
                <tr style="background-color: #F8FAFC;">
                  <th style="padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B;">Type</th>
                  <th style="padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B;">Name</th>
                  <th style="padding: 8px 12px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: #64748B;">Current Detected Value</th>
                </tr>
              </thead>
              <tbody>
                ${conflictHtmlRows}
              </tbody>
            </table>`
          : ''
      }

      <div style="background-color: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 24px 0 16px 0;">
        <p style="margin: 0 0 8px 0; font-size: 14px; font-weight: 600; color: #0F172A;">How to resolve this:</p>
        <ol style="margin: 0; padding-left: 18px; font-size: 13px; line-height: 1.6; color: #475569;">
          <li>Log in to your DNS provider or domain registrar console.</li>
          <li>Update or remove conflicting records to match the required mail configuration.</li>
          <li>Return to the Toowix Admin portal and select <strong>Retry / Verify</strong>.</li>
        </ol>
      </div>

      <p style="margin: 0; font-size: 12px; color: #94A3B8; line-height: 1.5;">
        No active mailbox service or existing messages on other configured domains have been affected.
      </p>
    `;

    const html = renderEmailShell({
      title: `Domain Verification Stopped: ${params.domainName}`,
      previewText: `DNS verification for ${params.domainName} requires attention.`,
      contentHtml,
    });

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: config.smtp.from,
        to: params.to,
        subject,
        text,
        html,
      });
      console.log(`[EMAIL DISPATCH: SUCCESS] Domain Activation Failed (${params.reason}) -> ${params.to}`);
      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      console.warn(`[EMAIL DISPATCH: FALLBACK / LOGGED] Domain Activation Failed email to ${params.to}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  async sendBillingGraceStartedEmail(
    params: BillingGraceStartedEmailParams
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const deadline = params.gracePeriodEndsAt.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    const subject = `Payment failed for ${params.domainName} — please update your payment method`;

    const text = `TOOWIX MAIL PLATFORM — BILLING NOTICE

Hello ${params.recipientName || 'Administrator'},

We were unable to charge your payment method for ${params.domainName}.

Mail service is unaffected for now — you have until ${deadline} (7 days) to
update your payment method before service is paused for this domain.

Update your payment method from the Billing tab in Toowix Tenant Admin.

— The Toowix Platform Team`.trim();

    const contentHtml = `
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155; line-height: 1.6;">
        Hello ${params.recipientName || 'Administrator'},
      </p>
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155; line-height: 1.6;">
        We were unable to charge your payment method for <strong>${params.domainName}</strong>.
      </p>
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155; line-height: 1.6;">
        Mail service is unaffected for now — you have until <strong>${deadline}</strong> (7 days) to update
        your payment method before service is paused for this domain.
      </p>
      <p style="margin: 0; font-size: 13px; color: #64748B; line-height: 1.6;">
        Update your payment method from the Billing tab in Toowix Tenant Admin.
      </p>
    `;

    const html = renderEmailShell({
      title: `Payment Failed: ${params.domainName}`,
      previewText: `Update your payment method by ${deadline} to avoid service interruption.`,
      contentHtml,
    });

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({
        from: config.smtp.from,
        to: params.to,
        subject,
        text,
        html,
      });
      console.log(`[EMAIL DISPATCH: SUCCESS] Billing Grace Started -> ${params.to}`);
      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      console.warn(`[EMAIL DISPATCH: FALLBACK / LOGGED] Billing Grace Started email to ${params.to}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * One template for every billing lifecycle notice (held-mailbox expiry, trial ending, payment
   * failed reminders, read-only / retention warnings): a subject, a headline and short paragraphs.
   */
  async sendBillingNoticeEmail(params: {
    to: string;
    recipientName?: string | null;
    subject: string;
    headline: string;
    paragraphs: string[];
    previewText?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const greeting = `Hello ${params.recipientName || 'Administrator'},`;
    const text = `TOOWIX MAIL PLATFORM — BILLING NOTICE

${greeting}

${params.paragraphs.join('\n\n')}

Manage billing from the Cart or Billing page in Toowix Tenant Admin.

— The Toowix Platform Team`.trim();

    const contentHtml = `
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155; line-height: 1.6;">${greeting}</p>
      ${params.paragraphs
        .map((p) => `<p style="margin: 0 0 16px 0; font-size: 14px; color: #334155; line-height: 1.6;">${p}</p>`)
        .join('\n')}
      <p style="margin: 0; font-size: 13px; color: #64748B; line-height: 1.6;">
        Manage billing from the Cart or Billing page in Toowix Tenant Admin.
      </p>
    `;

    const html = renderEmailShell({
      title: params.headline,
      previewText: params.previewText || params.headline,
      contentHtml,
    });

    try {
      const transporter = this.getTransporter();
      const info = await transporter.sendMail({ from: config.smtp.from, to: params.to, subject: params.subject, text, html });
      console.log(`[EMAIL DISPATCH: SUCCESS] Billing notice "${params.subject}" -> ${params.to}`);
      return { success: true, messageId: info.messageId };
    } catch (err: any) {
      console.warn(`[EMAIL DISPATCH: FALLBACK / LOGGED] Billing notice to ${params.to}: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * Verifies SMTP relay connectivity and handshake latency.
   */
  async verifyRelay(): Promise<{
    connected: boolean;
    latencyMs: number;
    host: string;
    port: number;
    secure: boolean;
    authenticated: boolean;
    error?: string;
  }> {
    const startTime = Date.now();
    const transporter = this.getTransporter();
    try {
      await transporter.verify();
      const latencyMs = Date.now() - startTime;
      return {
        connected: true,
        latencyMs,
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        authenticated: Boolean(config.smtp.user && config.smtp.password),
      };
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      return {
        connected: false,
        latencyMs,
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        authenticated: Boolean(config.smtp.user && config.smtp.password),
        error: err.message || String(err),
      };
    }
  }

  /**
   * Sends an automated test diagnostic ping email to verify complete outbound delivery via relay.
   */
  async sendTestPing(to: string): Promise<{ success: boolean; messageId?: string; latencyMs: number; error?: string }> {
    const startTime = Date.now();
    const transporter = this.getTransporter();
    try {
      const info = await transporter.sendMail({
        from: config.smtp.from,
        to,
        subject: `[Toowix Relay Diagnostic] SMTP Ping Verification - ${new Date().toISOString()}`,
        text: `This is an automated SMTP relay diagnostic test message from Toowix Mail Platform.\nTimestamp: ${new Date().toISOString()}\nHost: ${config.smtp.host}:${config.smtp.port}`,
        html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #4f46e5; margin-top: 0;">Toowix Mail Platform — SMTP Relay Diagnostic</h2>
          <p>Your outbound mail relay transport is operational and connected.</p>
          <ul style="color: #475569; font-size: 13px;">
            <li><strong>Relay Host:</strong> ${config.smtp.host}:${config.smtp.port}</li>
            <li><strong>TLS Mode:</strong> ${config.smtp.secure ? 'Implicit TLS' : 'STARTTLS / Plain'}</li>
            <li><strong>Timestamp:</strong> ${new Date().toISOString()}</li>
          </ul>
        </div>`,
      });
      return {
        success: true,
        messageId: info.messageId,
        latencyMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        success: false,
        latencyMs: Date.now() - startTime,
        error: err.message || String(err),
      };
    }
  }
}

export const emailService = new EmailService();
