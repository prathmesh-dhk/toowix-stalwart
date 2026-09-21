import mongoose from 'mongoose';
import { MailboxModel } from '../db/models/Mailbox';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { stalwartClient } from '../stalwart/client';
import { logAudit } from '../audit/service';
import { StalwartAccountExistsError, StalwartError } from '../stalwart/errors';
import { DomainSubscriptionModel } from '../db/models/DomainSubscription';
import { reportMeteredUsage } from './billing.service';
import { config, isBillingEnabled } from '../config';

export interface CreateMailboxInput {
  localPart: string;
  password: string;
  domainId?: string;
}

export interface MailboxRecord {
  id: string;
  tenantId: string;
  domainId: string;
  localPart: string;
  address: string;
  stalwartAccountId: string | null;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export class MailboxService {
  /**
   * Concurrency-safe mailbox creation using atomic MongoDB conditional updates ($expr + $inc).
   * 1. Atomically reserve quota on TenantModel:
   *    find and increment mailboxCount IF mailboxCount < mailboxLimit and status == 'active'.
   * 2. Check 1:1 DomainModel assigned to tenant.
   * 3. Check uniqueness of email address in MongoDB.
   * 4. Call Stalwart API to create mailbox account.
   * 5. If Stalwart fails: rollback quota decrement and throw mapped error.
   * 6. If Stalwart succeeds: insert MailboxModel record, audit event, return record.
   */
  static async createMailbox(
    tenantId: string,
    input: CreateMailboxInput,
    actorId?: string,
    actorRole = 'TENANT_ADMIN'
  ): Promise<MailboxRecord> {
    const localPart = input.localPart.trim().toLowerCase();

    // Syntax validation for local-part (RFC 5322 compatible characters)
    if (!/^[a-zA-Z0-9._-]+$/.test(localPart)) {
      throw {
        status: 400,
        code: 'INVALID_LOCAL_PART',
        message: 'Local part can only contain letters, numbers, dots, hyphens, and underscores',
      };
    }

    if (!input.password || input.password.length < 8) {
      throw {
        status: 400,
        code: 'PASSWORD_TOO_SHORT',
        message: 'Password must be at least 8 characters long',
      };
    }

    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      throw { status: 404, code: 'TENANT_NOT_FOUND', message: 'Tenant not found' };
    }

    // 1. Atomic Quota Reservation
    const tenant = await TenantModel.findOneAndUpdate(
      {
        _id: tenantId,
        status: 'active',
        $expr: { $lt: ['$mailboxCount', '$mailboxLimit'] },
      },
      { $inc: { mailboxCount: 1 } },
      { returnDocument: 'after' }
    );

    if (!tenant) {
      const existingTenant = await TenantModel.findById(tenantId);
      if (!existingTenant) {
        throw { status: 404, code: 'TENANT_NOT_FOUND', message: 'Tenant not found' };
      }
      if ((existingTenant.status === 'suspended' || existingTenant.status === 'pending_deletion')) {
        throw {
          status: 403,
          code: 'TENANT_SUSPENDED',
          message: 'Tenant is suspended; mailbox creation is blocked',
        };
      }
      if (existingTenant.status !== 'active') {
        throw {
          status: 400,
          code: 'TENANT_INACTIVE',
          message: `Tenant is not active (${existingTenant.status})`,
        };
      }
      throw {
        status: 409,
        code: 'QUOTA_EXCEEDED',
        message: `Mailbox limit of ${existingTenant.mailboxLimit} reached for tenant '${existingTenant.name}'`,
      };
    }

    // 2. Resolve domain for tenant (either by input.domainId or default to primary/first domain)
    let domain;
    if (input.domainId && mongoose.Types.ObjectId.isValid(input.domainId)) {
      domain = await DomainModel.findOne({ _id: input.domainId, tenantId });
      if (!domain) {
        // Rollback quota
        await TenantModel.updateOne({ _id: tenantId, mailboxCount: { $gt: 0 } }, { $inc: { mailboxCount: -1 } });
        throw { status: 404, code: 'DOMAIN_NOT_FOUND', message: 'Specified domain was not found for this tenant' };
      }
    } else {
      domain = await DomainModel.findOne({ tenantId }).sort({ isPrimary: -1, createdAt: 1 });
      if (!domain) {
        // Rollback quota
        await TenantModel.updateOne({ _id: tenantId, mailboxCount: { $gt: 0 } }, { $inc: { mailboxCount: -1 } });
        throw { status: 400, code: 'DOMAIN_MISSING', message: 'Tenant does not have an assigned domain' };
      }
    }

    // 2b. Block mailbox creation if the domain is suspended or not yet activated by Super Admin
    if (domain.status === 'suspended' || domain.dnsStatus !== 'active') {
      // Rollback quota
      await TenantModel.updateOne({ _id: tenantId, mailboxCount: { $gt: 0 } }, { $inc: { mailboxCount: -1 } });
      throw {
        status: 403,
        code: 'DOMAIN_NOT_ACTIVATED',
        message: `Domain '${domain.domainName}' is pending activation by a Super Admin. Mailboxes can only be created once the domain is activated.`,
      };
    }

    // 2c. Billing gate: a domain must have a non-incomplete/canceled/suspended
    // subscription before its first mailbox can be created when billing is enabled.
    // When billing is bypassed/skipped, this check is skipped entirely.
    if (isBillingEnabled()) {
      const subscription = await DomainSubscriptionModel.findOne({ domainId: domain._id });
      if (!subscription || ['incomplete', 'canceled', 'suspended'].includes(subscription.status)) {
        // Rollback quota
        await TenantModel.updateOne({ _id: tenantId, mailboxCount: { $gt: 0 } }, { $inc: { mailboxCount: -1 } });
        throw {
          status: 402,
          code: 'PAYMENT_REQUIRED',
          message: `Add a payment method for domain '${domain.domainName}' before creating mailboxes.`,
        };
      }
    }

    // Check domain-level mailboxLimit if configured
    if (domain.mailboxLimit) {
      const currentDomainCount = await MailboxModel.countDocuments({ domainId: domain._id });
      if (currentDomainCount >= domain.mailboxLimit) {
        // Rollback quota
        await TenantModel.updateOne({ _id: tenantId, mailboxCount: { $gt: 0 } }, { $inc: { mailboxCount: -1 } });
        throw {
          status: 409,
          code: 'DOMAIN_QUOTA_EXCEEDED',
          message: `Mailbox limit of ${domain.mailboxLimit} reached for domain '${domain.domainName}'`,
        };
      }
    }

    const fullAddress = `${localPart}@${domain.domainName}`;

    // 3. Check uniqueness in MongoDB
    const existingMailbox = await MailboxModel.findOne({ address: fullAddress });
    if (existingMailbox) {
      // Rollback quota
      await TenantModel.updateOne({ _id: tenantId, mailboxCount: { $gt: 0 } }, { $inc: { mailboxCount: -1 } });
      throw { status: 409, code: 'MAILBOX_EXISTS', message: `Mailbox '${fullAddress}' already exists` };
    }

    // 4. Resolve Stalwart Domain ID
    let stalwartDomainId = domain.stalwartDomainId;
    try {
      const domains = await stalwartClient.listDomains();
      const match = domains.find((d) => d.name.toLowerCase() === domain.domainName.toLowerCase());
      if (match) {
        stalwartDomainId = match.id;
        if (domain.stalwartDomainId !== match.id) {
          domain.stalwartDomainId = match.id;
          await domain.save();
        }
      } else {
        const createdDom = await stalwartClient.createDomain(domain.domainName, `Tenant: ${tenant.name}`);
        stalwartDomainId = createdDom.id;
        domain.stalwartDomainId = createdDom.id;
        await domain.save();
      }
    } catch (err: any) {
      if (!stalwartDomainId) {
        stalwartDomainId = domain.domainName;
      }
    }

    // 5. Provision in Stalwart
    let stalwartAccount: { id: string; name: string };
    try {
      try {
        stalwartAccount = await stalwartClient.createAccount({
          name: localPart,
          domainId: stalwartDomainId!,
          password: input.password,
          description: localPart,
        });
      } catch (err: any) {
        if (err.message && err.message.includes('invalidForeignKey')) {
          const domains = await stalwartClient.listDomains();
          const match = domains.find((d) => d.name.toLowerCase() === domain.domainName.toLowerCase());
          const targetId = match ? match.id : (await stalwartClient.createDomain(domain.domainName, `Tenant: ${tenant.name}`)).id;
          domain.stalwartDomainId = targetId;
          await domain.save();
          stalwartAccount = await stalwartClient.createAccount({
            name: localPart,
            domainId: targetId,
            password: input.password,
            description: localPart,
          });
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      // Rollback quota on failure
      await TenantModel.updateOne({ _id: tenantId, mailboxCount: { $gt: 0 } }, { $inc: { mailboxCount: -1 } });

      await logAudit({
        actorId,
        actorRole,
        tenantId,
        action: 'MAILBOX_PROVISION_FAILED',
        resource: 'MAILBOX',
        metadata: { address: fullAddress, error: err.message },
        success: false,
      });

      if (err instanceof StalwartAccountExistsError || err.code === 'ACCOUNT_EXISTS') {
        throw {
          status: 409,
          code: 'MAILBOX_EXISTS_IN_STALWART',
          message: `Mailbox '${fullAddress}' already exists on the mail server`,
        };
      }

      if (err.message && err.message.toLowerCase().includes('password is too weak')) {
        throw {
          status: 400,
          code: 'PASSWORD_TOO_WEAK',
          message: `Stalwart rejected this password as too weak/common: ${err.message}`,
        };
      }

      throw {
        status: 503,
        code: 'STALWART_UNAVAILABLE',
        message: `Failed to provision mailbox on Stalwart mail engine: ${err.message}`,
      };
    }

    // 6. Save Mailbox record in MongoDB
    const mailboxDoc = await MailboxModel.create({
      tenantId: tenant._id,
      domainId: domain._id,
      localPart,
      address: fullAddress,
      stalwartAccountId: stalwartAccount.id,
      status: 'active',
    });

    await logAudit({
      actorId,
      actorRole,
      tenantId,
      action: 'MAILBOX_CREATED',
      resource: 'MAILBOX',
      resourceId: mailboxDoc._id.toString(),
      metadata: { address: fullAddress, stalwartAccountId: stalwartAccount.id },
      success: true,
    });

    // Best-effort: update the running peak for metered (Custom-plan) domains.
    // Never let a Stripe hiccup block mailbox creation itself.
    reportMeteredUsage(domain._id.toString()).catch((err) =>
      console.warn(`[MailboxService] reportMeteredUsage failed for domain ${domain._id}:`, err.message)
    );

    return {
      id: mailboxDoc._id.toString(),
      tenantId: tenant._id.toString(),
      domainId: domain._id.toString(),
      localPart: mailboxDoc.localPart,
      address: mailboxDoc.address,
      stalwartAccountId: mailboxDoc.stalwartAccountId || null,
      status: mailboxDoc.status,
      createdAt: mailboxDoc.createdAt.toISOString(),
      updatedAt: mailboxDoc.updatedAt.toISOString(),
    };
  }

  /**
   * List all mailboxes for a tenant.
   */
  static async listMailboxes(tenantId: string, domainId?: string): Promise<MailboxRecord[]> {
    if (!mongoose.Types.ObjectId.isValid(tenantId)) {
      return [];
    }

    const filter: any = { tenantId };
    if (domainId && mongoose.Types.ObjectId.isValid(domainId)) {
      filter.domainId = domainId;
    }

    const docs = await MailboxModel.find(filter).sort({ createdAt: 1 });

    return docs.map((doc) => ({
      id: doc._id.toString(),
      tenantId: doc.tenantId.toString(),
      domainId: doc.domainId.toString(),
      localPart: doc.localPart,
      address: doc.address,
      stalwartAccountId: doc.stalwartAccountId || null,
      status: doc.status,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    }));
  }

  /**
   * Get single mailbox by ID, enforcing tenant boundary when tenantId is provided.
   */
  static async getMailboxById(mailboxId: string, tenantId?: string): Promise<MailboxRecord | null> {
    if (!mongoose.Types.ObjectId.isValid(mailboxId)) {
      return null;
    }

    const filter: any = { _id: mailboxId };
    if (tenantId) {
      if (!mongoose.Types.ObjectId.isValid(tenantId)) {
        return null;
      }
      filter.tenantId = tenantId;
    }

    const doc = await MailboxModel.findOne(filter);
    if (!doc) return null;

    return {
      id: doc._id.toString(),
      tenantId: doc.tenantId.toString(),
      domainId: doc.domainId.toString(),
      localPart: doc.localPart,
      address: doc.address,
      stalwartAccountId: doc.stalwartAccountId || null,
      status: doc.status,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  /**
   * Reset mailbox password via Stalwart.
   * Passwords are NEVER stored in MongoDB.
   */
  static async resetPassword(
    mailboxId: string,
    newPassword: string,
    tenantId?: string,
    actorId?: string,
    actorRole = 'TENANT_ADMIN'
  ): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
      throw { status: 400, code: 'PASSWORD_TOO_SHORT', message: 'Password must be at least 8 characters long' };
    }

    const mailbox = await this.getMailboxById(mailboxId, tenantId);
    if (!mailbox) {
      throw { status: 404, code: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' };
    }

    // Tenant check: block if tenant is suspended
    const tenant = await TenantModel.findById(mailbox.tenantId);
    if ((tenant?.status === 'suspended' || tenant?.status === 'pending_deletion')) {
      throw {
        status: 403,
        code: 'TENANT_SUSPENDED',
        message: 'Tenant is suspended; mailbox password reset is blocked',
      };
    }

    if (mailbox.stalwartAccountId) {
      try {
        await stalwartClient.updateAccountPassword(mailbox.stalwartAccountId, newPassword);
      } catch (err: any) {
        throw {
          status: 503,
          code: 'STALWART_UNAVAILABLE',
          message: `Failed to update password on mail engine: ${err.message}`,
        };
      }
    }

    await logAudit({
      actorId,
      actorRole,
      tenantId: mailbox.tenantId,
      action: 'MAILBOX_PASSWORD_RESET',
      resource: 'MAILBOX',
      resourceId: mailboxId,
      metadata: { address: mailbox.address },
      success: true,
    });
  }

  /**
   * Delete mailbox from Stalwart and MongoDB.
   * Atomically decrements tenant mailboxCount.
   */
  static async deleteMailbox(
    mailboxId: string,
    tenantId?: string,
    actorId?: string,
    actorRole = 'TENANT_ADMIN'
  ): Promise<void> {
    const mailbox = await this.getMailboxById(mailboxId, tenantId);
    if (!mailbox) {
      throw { status: 404, code: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' };
    }

    // Tenant check: block if tenant is suspended
    const tenant = await TenantModel.findById(mailbox.tenantId);
    if ((tenant?.status === 'suspended' || tenant?.status === 'pending_deletion')) {
      throw {
        status: 403,
        code: 'TENANT_SUSPENDED',
        message: 'Tenant is suspended; mailbox deletion is blocked',
      };
    }

    // 1. Delete from Stalwart if an account was provisioned
    if (mailbox.stalwartAccountId) {
      try {
        await stalwartClient.deleteAccount(mailbox.stalwartAccountId);
      } catch (err: any) {
        console.warn(`[MailboxService] Stalwart account delete warning for ${mailbox.stalwartAccountId}:`, err.message);
      }
    }

    // 2. Delete from MongoDB
    await MailboxModel.deleteOne({ _id: mailbox.id });

    // 3. Atomically decrement mailbox count
    await TenantModel.updateOne(
      { _id: mailbox.tenantId, mailboxCount: { $gt: 0 } },
      { $inc: { mailboxCount: -1 } }
    );

    await logAudit({
      actorId,
      actorRole,
      tenantId: mailbox.tenantId,
      action: 'MAILBOX_DELETED',
      resource: 'MAILBOX',
      resourceId: mailboxId,
      metadata: { address: mailbox.address },
      success: true,
    });
  }

  /**
   * Suspend a specific mailbox:
   * 1. Check parent tenant is active (if suspended, block).
   * 2. Set account permissions in Stalwart to empty set (freezes authentication/sending).
   * 3. Set status: 'suspended' in MongoDB.
   * 4. Log audit event.
   */
  static async suspendMailbox(
    mailboxId: string,
    tenantId?: string,
    actorId?: string,
    actorRole = 'TENANT_ADMIN'
  ): Promise<MailboxRecord> {
    const mailbox = await this.getMailboxById(mailboxId, tenantId);
    if (!mailbox) {
      throw { status: 404, code: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' };
    }

    const tenant = await TenantModel.findById(mailbox.tenantId);
    if ((tenant?.status === 'suspended' || tenant?.status === 'pending_deletion')) {
      throw {
        status: 403,
        code: 'TENANT_SUSPENDED',
        message: 'Tenant is suspended; mailbox operations are blocked',
      };
    }

    if (mailbox.stalwartAccountId) {
      try {
        await stalwartClient.updateAccountStatus(mailbox.stalwartAccountId, true);
      } catch (err: any) {
        console.warn(`[MailboxService] Stalwart account suspend warning for ${mailbox.stalwartAccountId}:`, err.message);
      }
    }

    const updatedDoc = await MailboxModel.findByIdAndUpdate(
      mailbox.id,
      { status: 'suspended' },
      { returnDocument: 'after' }
    );

    await logAudit({
      actorId,
      actorRole,
      tenantId: mailbox.tenantId,
      action: 'MAILBOX_SUSPENDED',
      resource: 'MAILBOX',
      resourceId: mailbox.id,
      metadata: { address: mailbox.address },
      success: true,
    });

    return {
      id: updatedDoc!._id.toString(),
      tenantId: updatedDoc!.tenantId.toString(),
      domainId: updatedDoc!.domainId.toString(),
      localPart: updatedDoc!.localPart,
      address: updatedDoc!.address,
      stalwartAccountId: updatedDoc!.stalwartAccountId || null,
      status: updatedDoc!.status,
      createdAt: updatedDoc!.createdAt.toISOString(),
      updatedAt: updatedDoc!.updatedAt.toISOString(),
    };
  }

  /**
   * Reactivate a suspended mailbox:
   * 1. Check parent tenant is active (if suspended, block).
   * 2. Restore account permissions in Stalwart.
   * 3. Set status: 'active' in MongoDB.
   * 4. Log audit event.
   */
  static async reactivateMailbox(
    mailboxId: string,
    tenantId?: string,
    actorId?: string,
    actorRole = 'TENANT_ADMIN'
  ): Promise<MailboxRecord> {
    const mailbox = await this.getMailboxById(mailboxId, tenantId);
    if (!mailbox) {
      throw { status: 404, code: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' };
    }

    const tenant = await TenantModel.findById(mailbox.tenantId);
    if ((tenant?.status === 'suspended' || tenant?.status === 'pending_deletion')) {
      throw {
        status: 403,
        code: 'TENANT_SUSPENDED',
        message: 'Tenant is suspended; mailbox operations are blocked',
      };
    }

    if (mailbox.stalwartAccountId) {
      try {
        await stalwartClient.updateAccountStatus(mailbox.stalwartAccountId, false);
      } catch (err: any) {
        console.warn(`[MailboxService] Stalwart account reactivate warning for ${mailbox.stalwartAccountId}:`, err.message);
      }
    }

    const updatedDoc = await MailboxModel.findByIdAndUpdate(
      mailbox.id,
      { status: 'active' },
      { returnDocument: 'after' }
    );

    await logAudit({
      actorId,
      actorRole,
      tenantId: mailbox.tenantId,
      action: 'MAILBOX_REACTIVATED',
      resource: 'MAILBOX',
      resourceId: mailbox.id,
      metadata: { address: mailbox.address },
      success: true,
    });

    return {
      id: updatedDoc!._id.toString(),
      tenantId: updatedDoc!.tenantId.toString(),
      domainId: updatedDoc!.domainId.toString(),
      localPart: updatedDoc!.localPart,
      address: updatedDoc!.address,
      stalwartAccountId: updatedDoc!.stalwartAccountId || null,
      status: updatedDoc!.status,
      createdAt: updatedDoc!.createdAt.toISOString(),
      updatedAt: updatedDoc!.updatedAt.toISOString(),
    };
  }

  /**
   * Provisions the login identity mailbox for a self-service signup: `username@<platformMailDomain>`.
   *
   * Deliberately not createMailbox(): that gates on an active tenant with seat quota, a domain the
   * caller's tenant owns, dnsStatus, and a live billing subscription. At signup the tenant does not
   * exist yet, and none of those should apply to a free login identity anyway. The Mongo row is
   * written first as the reservation — Mailbox.address is globally unique, so two simultaneous
   * signups for the same username produce one winner and one E11000, never two Stalwart accounts.
   */
  static async createPlatformIdentityMailbox(
    localPart: string,
    password: string
  ): Promise<{ id: string; address: string; stalwartAccountId: string | null }> {
    const domain = await DomainModel.findOne({ domainName: config.platformMailDomain });
    if (!domain) {
      throw {
        status: 503,
        code: 'PLATFORM_DOMAIN_MISSING',
        message: `Platform identity domain '${config.platformMailDomain}' is not provisioned yet.`,
      };
    }

    const address = `${localPart}@${config.platformMailDomain}`;

    const mailboxDoc = await MailboxModel.create({
      tenantId: domain.tenantId,
      domainId: domain._id,
      localPart,
      address,
      status: 'active',
    }).catch((err: any) => {
      if (err?.code === 11000) {
        throw { status: 409, code: 'USERNAME_TAKEN', message: `'${address}' is already taken.` };
      }
      throw err;
    });

    try {
      let account;
      try {
        account = await stalwartClient.createAccount({
          name: localPart,
          domainId: await resolvePlatformStalwartDomainId(domain),
          password,
          description: address,
        });
      } catch (err: any) {
        // Cached Stalwart domain id is stale (domain recreated server-side) — re-resolve once.
        if (err.message && err.message.includes('invalidForeignKey')) {
          account = await stalwartClient.createAccount({
            name: localPart,
            domainId: await resolvePlatformStalwartDomainId(domain, true),
            password,
            description: address,
          });
        } else {
          throw err;
        }
      }
      mailboxDoc.stalwartAccountId = account.id;
      await mailboxDoc.save();
    } catch (err: any) {
      await MailboxModel.deleteOne({ _id: mailboxDoc._id });

      if (err instanceof StalwartAccountExistsError || err.code === 'ACCOUNT_EXISTS') {
        throw { status: 409, code: 'USERNAME_TAKEN', message: `'${address}' is already taken.` };
      }
      if (err.message && err.message.toLowerCase().includes('password is too weak')) {
        throw {
          status: 400,
          code: 'PASSWORD_TOO_WEAK',
          message: 'That password was rejected as too weak or too common. Please choose a stronger one.',
        };
      }
      throw {
        status: 503,
        code: 'STALWART_UNAVAILABLE',
        message: `Could not create your mailbox on the mail server: ${err.message}`,
      };
    }

    // Counter only — the platform tenant's mailboxLimit is never enforced against these.
    await TenantModel.updateOne({ _id: domain.tenantId }, { $inc: { mailboxCount: 1 } });

    await logAudit({
      actorRole: 'SYSTEM',
      tenantId: domain.tenantId.toString(),
      action: 'PLATFORM_IDENTITY_MAILBOX_CREATED',
      resource: 'MAILBOX',
      resourceId: mailboxDoc._id.toString(),
      metadata: { address },
      success: true,
    });

    return {
      id: mailboxDoc._id.toString(),
      address,
      stalwartAccountId: mailboxDoc.stalwartAccountId,
    };
  }

  /**
   * Undo for createPlatformIdentityMailbox, used when the rest of a signup fails after the mailbox
   * was provisioned. Without it a half-finished signup strands the username forever.
   */
  static async deletePlatformIdentityMailbox(address: string): Promise<void> {
    const mailbox = await MailboxModel.findOne({ address: address.trim().toLowerCase() });
    if (!mailbox) return;

    if (mailbox.stalwartAccountId) {
      try {
        await stalwartClient.deleteAccount(mailbox.stalwartAccountId);
      } catch (err: any) {
        console.warn(`[MailboxService] Stalwart cleanup failed for ${address}:`, err?.message);
      }
    }
    await MailboxModel.deleteOne({ _id: mailbox._id });
    await TenantModel.updateOne({ _id: mailbox.tenantId, mailboxCount: { $gt: 0 } }, { $inc: { mailboxCount: -1 } });
  }

  /**
   * Keeps the Stalwart credential in step with the login password, now that an admin's login email
   * IS their mailbox address. Best-effort by design: legacy external-email admins and super admins
   * have no matching mailbox, and a mail server outage must never block a password reset.
   */
  static async syncLoginMailboxPassword(email: string, newPassword: string): Promise<void> {
    try {
      const mailbox = await MailboxModel.findOne({ address: email.trim().toLowerCase() });
      if (mailbox?.stalwartAccountId) {
        await stalwartClient.updateAccountPassword(mailbox.stalwartAccountId, newPassword);
      }
    } catch (err: any) {
      console.warn(`[MailboxService] Stalwart password sync skipped for ${email}:`, err?.message);
    }
  }
}

/** Resolve (creating if absent) the Stalwart domain id for a Domain row, caching it back. */
async function resolvePlatformStalwartDomainId(domain: any, forceRefresh = false): Promise<string> {
  if (domain.stalwartDomainId && !forceRefresh) return domain.stalwartDomainId;

  const domains = await stalwartClient.listDomains();
  const match = domains.find((d) => d.name.toLowerCase() === domain.domainName.toLowerCase());
  const id = match ? match.id : (await stalwartClient.createDomain(domain.domainName, 'Toowix platform identities')).id;

  if (domain.stalwartDomainId !== id) {
    domain.stalwartDomainId = id;
    await domain.save();
  }
  return id;
}

