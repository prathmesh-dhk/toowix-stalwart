import { Types } from 'mongoose';
import { generateSecret } from 'otplib';
import {
  TenantModel,
  ITenant,
  DomainModel,
  IDomain,
  AdminUserModel,
  IAdminUser,
  MailboxModel,
  IMailbox,
  ActivationTokenModel,
  IActivationToken,
  AuditLogModel,
  IAuditLog,
  PlanModel,
  IPlan,
  DomainSubscriptionModel,
  IDomainSubscription,
} from '../../src/db/models';
import { hashPassword, generateOidcToken } from '../../src/auth/service';

let counter = 1000;
function uniqueId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}

export async function createTestTenant(overrides: Partial<ITenant> = {}): Promise<ITenant> {
  const name = overrides.name || uniqueId('Tenant');
  return TenantModel.create({
    name,
    status: 'active',
    mailboxLimit: 50,
    mailboxCount: 0,
    ...overrides,
  });
}

export async function createTestDomain(tenantId: Types.ObjectId | string, overrides: Partial<IDomain> = {}): Promise<IDomain> {
  const domainName = overrides.domainName || `${uniqueId('domain').toLowerCase()}.test`;
  return DomainModel.create({
    tenantId,
    domainName,
    stalwartDomainId: `dom-${domainName}`,
    isAuthoritative: true,
    verificationStatus: 'verified',
    status: 'active',
    dnsStatus: overrides.dnsStatus || 'active',
    ...overrides,
  });
}

export async function createTestPlan(overrides: Partial<IPlan> = {}): Promise<IPlan> {
  return PlanModel.create({
    name: overrides.name || uniqueId('Plan'),
    seatCount: 10,
    displayOrder: 1,
    isActive: true,
    billingMode: 'fixed',
    monthlyPriceInPaise: 0,
    ...overrides,
  });
}

/**
 * Seeds an active DomainSubscription so mailbox creation clears the billing
 * gate in mailbox.service.ts (a domain needs a non-incomplete/canceled/
 * suspended subscription before its first mailbox). Creates a Plan too if
 * none is passed — most tests don't care which plan, just that one exists.
 */
export async function createTestActiveSubscription(
  domainId: Types.ObjectId | string,
  tenantId: Types.ObjectId | string,
  overrides: Partial<IDomainSubscription> = {}
): Promise<IDomainSubscription> {
  const planId = overrides.planId || (await createTestPlan())._id;
  return DomainSubscriptionModel.create({
    domainId,
    tenantId,
    planId,
    stripeSubscriptionId: uniqueId('test-sub'),
    stripeSubscriptionItemId: uniqueId('test-item'),
    status: 'trialing',
    ...overrides,
  });
}

export async function createTestSuperAdmin(overrides: Partial<IAdminUser> = {}): Promise<{ user: IAdminUser; token: string }> {
  const email = overrides.email || `${uniqueId('super').toLowerCase()}@toowix.test`;
  const plainPassword = 'SuperSecurePassword2026!';
  const user = await AdminUserModel.create({
    email,
    passwordHash: await hashPassword(plainPassword),
    role: 'SUPER_ADMIN',
    tenantId: null,
    status: 'active',
    twoFactorEnabled: true,
    twoFactorSecret: generateSecret(),
    ...overrides,
  });

  const token = generateOidcToken({
    id: (user._id as any).toString(),
    email: user.email,
    role: 'SUPER_ADMIN',
    tenantId: null,
    twoFactorEnabled: user.twoFactorEnabled,
  });

  return { user, token };
}

export async function createTestTenantAdmin(
  tenantId: Types.ObjectId | string,
  overrides: Partial<IAdminUser> = {}
): Promise<{ user: IAdminUser; token: string }> {
  const email = overrides.email || `${uniqueId('admin').toLowerCase()}@tenant.test`;
  const plainPassword = 'TenantAdminPassword2026!';
  const user = await AdminUserModel.create({
    email,
    passwordHash: await hashPassword(plainPassword),
    role: 'TENANT_ADMIN',
    tenantId,
    status: 'active',
    twoFactorEnabled: true,
    twoFactorSecret: generateSecret(),
    ...overrides,
  });

  const token = generateOidcToken({
    id: (user._id as any).toString(),
    email: user.email,
    role: 'TENANT_ADMIN',
    tenantId: tenantId.toString(),
    twoFactorEnabled: user.twoFactorEnabled,
  });

  return { user, token };
}

export async function createTestMailbox(
  tenantId: Types.ObjectId | string,
  domainId: Types.ObjectId | string,
  overrides: Partial<IMailbox> = {}
): Promise<IMailbox> {
  const localPart = overrides.localPart || uniqueId('user').toLowerCase();
  return MailboxModel.create({
    tenantId,
    domainId,
    localPart,
    address: `${localPart}@test.org`,
    passwordHash: await hashPassword('MailboxPassword2026!'),
    stalwartAccountId: `acc-${localPart}`,
    status: 'active',
    quotaBytes: 1073741824,
    ...overrides,
  });
}

export async function createTestActivationToken(
  applicationId: Types.ObjectId | string,
  tenantId: Types.ObjectId | string,
  overrides: Partial<IActivationToken> = {}
): Promise<{ record: IActivationToken; rawToken: string }> {
  const rawToken = uniqueId('raw-activation-token');
  const tokenHash = require('crypto').createHash('sha256').update(rawToken).digest('hex');
  const record = await ActivationTokenModel.create({
    applicationId,
    tenantId,
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    isUsed: false,
    ...overrides,
  });
  return { record, rawToken };
}

export async function createTestAuditLog(overrides: Record<string, any> = {}): Promise<IAuditLog> {
  const actorId = overrides.actorId || overrides.actor_id || new Types.ObjectId();
  const actorRole = overrides.actorRole || overrides.actor_role || 'TENANT_ADMIN';
  const actorEmail = overrides.actorEmail || overrides.actor_email || 'admin@test.org';
  const actorIp = overrides.actorIp || overrides.actor_ip || '127.0.0.1';
  const tenantId = overrides.tenantId || overrides.tenant_id || undefined;
  const action = overrides.action || 'MAILBOX_CREATED';
  const resource = overrides.resource || 'MAILBOX';
  const resourceId = overrides.resourceId || overrides.resource_id || undefined;
  const status = overrides.status || 'SUCCESS';
  const metadata = overrides.metadata || {};
  const timestamp = overrides.timestamp || new Date();

  return AuditLogModel.create({
    actorId,
    actorRole,
    actorEmail,
    actorIp,
    tenantId,
    action,
    resource,
    resourceId,
    status,
    metadata,
    timestamp,
  });
}
