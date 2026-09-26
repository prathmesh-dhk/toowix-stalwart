import mongoose from 'mongoose';
import { MailboxModel } from '../db/models/Mailbox';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { stalwartClient } from '../stalwart/client';
import { logAudit } from '../audit/service';
import { StalwartAccountExistsError, StalwartError } from '../stalwart/errors';
import { StalwartEmailAlias } from '../stalwart/types';
import { DomainSubscriptionModel } from '../db/models/DomainSubscription';
import { reportMeteredUsage, syncDomainActiveUserCount, ensureDomainSubscription } from './billing.service';
import { config } from '../config';

/** Unactivated (billing-hold) mailboxes a tenant may keep, and how long they wait before being removed. */
export const HELD_MAILBOX_LIMIT = 5;
export const HELD_MAILBOX_TTL_DAYS = 14;

export interface CreateMailboxInput {
  displayName?: string;
  localPart: string;
  password: string;
  domainId?: string;
}

export interface MailboxAliasRecord {
  id: string;
  localPart: string;
  domainId: string;
  domainName: string;
  address: string;
  description?: string | null;
  createdAt: string;
}

export interface AddAliasInput {
  localPart: string;
  description?: string | null;
}

export interface MailboxRecord {
  id: string;
  tenantId: string;
  domainId: string;
  localPart: string;
  displayName: string | null;
  address: string;
  stalwartAccountId: string | null;
  status: 'active' | 'suspended';
  billingHold: boolean;
  aliases?: MailboxAliasRecord[];
  createdAt: string;
  updatedAt: string;
}

export class MailboxService {
  public static mapToRecord(doc: any): MailboxRecord {
    return {
      id: doc._id.toString(),
      tenantId: doc.tenantId.toString(),
      domainId: doc.domainId.toString(),
      localPart: doc.localPart,
      displayName: doc.displayName || null,
      address: doc.address,
      stalwartAccountId: doc.stalwartAccountId || null,
      status: doc.status,
      billingHold: !!doc.billingHold,
      aliases: (doc.aliases || []).map((a: any) => ({
        id: a._id.toString(),
        localPart: a.localPart,
        domainId: a.domainId.toString(),
        domainName: a.domainName,
        address: a.address,
        description: a.description || null,
        createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : (a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString()),
      })),
      createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : new Date(doc.createdAt).toISOString(),
      updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : new Date(doc.updatedAt).toISOString(),
    };
  }

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
    const displayName = input.displayName?.trim() || null;

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

    // 2b. Suspended domains can't get new mailboxes.
    if (domain.status === 'suspended') {
      await TenantModel.updateOne({ _id: tenantId, mailboxCount: { $gt: 0 } }, { $inc: { mailboxCount: -1 } });
      throw {
        status: 403,
        code: 'DOMAIN_NOT_ACTIVATED',
        message: `Domain '${domain.domainName}' is suspended.`,
      };
    }

    // 2c. Billing hold — TENANT-level, not per domain. Until the tenant has confirmed a payment method
    // (which starts its single 60-day trial), new mailboxes are still created and listed, but stay
    // suspended and sit in the cart. Once the trial is running, mailboxes on every domain are live at once.
    const existingSub = await DomainSubscriptionModel.findOne({ domainId: domain._id });
    const hasLiveSub = !!existingSub && !['incomplete', 'canceled'].includes(existingSub.status);
    const onBillingHold = !tenant.trialStartedAt && !hasLiveSub;
    if (onBillingHold) {
      const held = await MailboxModel.countDocuments({ tenantId, billingHold: true });
      if (held >= HELD_MAILBOX_LIMIT) {
        await TenantModel.updateOne({ _id: tenantId, mailboxCount: { $gt: 0 } }, { $inc: { mailboxCount: -1 } });
        throw {
          status: 409,
          code: 'HELD_LIMIT_REACHED',
          message: `You can add up to ${HELD_MAILBOX_LIMIT} users before activating your free trial. Open the Cart and confirm your card to add more.`,
        };
      }
    }
    if (!onBillingHold && !hasLiveSub) {
      await ensureDomainSubscription(domain, { id: actorId || 'system', email: 'billing@toowix.internal', role: actorRole || 'SYSTEM' });
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
          message: `${domain.planName || 'Plan'} user limit reached (${domain.mailboxLimit} users) for '${domain.domainName}'. Change plan to add more users.`,
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
          description: displayName || localPart,
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
            description: displayName || localPart,
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
      displayName,
      address: fullAddress,
      stalwartAccountId: stalwartAccount.id,
      status: onBillingHold ? 'suspended' : 'active',
      billingHold: onBillingHold,
    });

    if (onBillingHold) {
      try {
        await stalwartClient.updateAccountStatus(stalwartAccount.id, true);
      } catch (err: any) {
        console.warn(`[MailboxService] Could not hold ${fullAddress} in Stalwart:`, err.message);
      }
    }

    await logAudit({
      actorId,
      actorRole,
      tenantId,
      action: 'MAILBOX_CREATED',
      resource: 'MAILBOX',
      resourceId: mailboxDoc._id.toString(),
      metadata: { address: fullAddress, stalwartAccountId: stalwartAccount.id, pendingActivation: onBillingHold },
      success: true,
    });

    // Best-effort: update the running peak for metered (Custom-plan) domains.
    // Never let a Stripe hiccup block mailbox creation itself.
    reportMeteredUsage(domain._id.toString()).catch((err) =>
      console.warn(`[MailboxService] reportMeteredUsage failed for domain ${domain._id}:`, err.message)
    );

    // Pay-as-you-go: sync active user count to Stripe subscription item quantity
    syncDomainActiveUserCount(domain._id.toString()).catch((err) =>
      console.warn(`[MailboxService] syncDomainActiveUserCount failed for domain ${domain._id}:`, err.message)
    );

    return this.mapToRecord(mailboxDoc);
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

    return docs.map((doc) => this.mapToRecord(doc));
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

    return this.mapToRecord(doc);
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
        const msg = err?.details?.description || err?.message || '';
        if (
          err?.code === 'PASSWORD_UPDATE_FAILED' ||
          msg.toLowerCase().includes('password is too weak') ||
          msg.toLowerCase().includes('commonly used password')
        ) {
          const cleanMsg = (err?.details?.description || err?.message || 'Password was rejected as too weak.').replace(/^Failed to update password in Stalwart:\s*/i, '');
          throw {
            status: 400,
            code: 'PASSWORD_TOO_WEAK',
            message: cleanMsg,
          };
        }
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

    if (actorRole === 'TENANT_MODERATOR') {
      throw {
        status: 403,
        code: 'FORBIDDEN',
        message: 'Moderators are not permitted to delete mailboxes. Only Tenant Administrators may delete mailboxes.',
      };
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

    // Pay-as-you-go: sync active user count after deletion
    syncDomainActiveUserCount(mailbox.domainId).catch((err) =>
      console.warn(`[MailboxService] syncDomainActiveUserCount failed for domain ${mailbox.domainId}:`, err.message)
    );
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

    // Pay-as-you-go: suspended users are not billable
    syncDomainActiveUserCount(mailbox.domainId).catch((err) =>
      console.warn(`[MailboxService] syncDomainActiveUserCount failed for domain ${mailbox.domainId}:`, err.message)
    );

    return this.mapToRecord(updatedDoc!);
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

    if (mailbox.billingHold) {
      throw {
        status: 402,
        code: 'PAYMENT_METHOD_REQUIRED',
        message: 'This mailbox is pending activation. Open the cart, add a payment method and confirm to activate it.',
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

    // Pay-as-you-go: reactivated user becomes billable again
    syncDomainActiveUserCount(mailbox.domainId).catch((err) =>
      console.warn(`[MailboxService] syncDomainActiveUserCount failed for domain ${mailbox.domainId}:`, err.message)
    );

    return this.mapToRecord(updatedDoc!);
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
    const mailbox = await MailboxModel.findOne({ address: email.trim().toLowerCase() });
    if (!mailbox?.stalwartAccountId) {
      // Legacy external-email admins or accounts with no Stalwart mailbox
      return;
    }

    try {
      await stalwartClient.updateAccountPassword(mailbox.stalwartAccountId, newPassword);
    } catch (err: any) {
      const msg = err?.details?.description || err?.message || '';
      // If Stalwart rejected the password as too weak / common or invalid:
      if (
        err?.code === 'PASSWORD_UPDATE_FAILED' ||
        msg.toLowerCase().includes('password is too weak') ||
        msg.toLowerCase().includes('commonly used password')
      ) {
        const cleanMsg = (err?.details?.description || err?.message || 'Password was rejected as too weak.').replace(/^Failed to update password in Stalwart:\s*/i, '');
        throw {
          status: 400,
          code: 'PASSWORD_TOO_WEAK',
          message: cleanMsg,
        };
      }

      // Mail server outage / unreachable: log warning for fallback
      console.warn(`[MailboxService] Stalwart password sync skipped for ${email}:`, err?.message);
    }
  }

  /**
   * Add an email alias to a mailbox:
   * 1. Validates localPart syntax and target domain ownership/activation.
   * 2. Checks global collision against primary mailboxes and existing aliases.
   * 3. Syncs alias to Stalwart mail server via JMAP.
   * 4. Persists alias subdocument in MongoDB.
   * 5. Does NOT increment tenant mailboxCount (aliases are free/zero-seat).
   */
  static async addAlias(
    mailboxId: string,
    tenantId: string,
    input: AddAliasInput,
    actorId?: string,
    actorRole = 'TENANT_ADMIN'
  ): Promise<MailboxAliasRecord> {
    if (!mongoose.Types.ObjectId.isValid(mailboxId) || !mongoose.Types.ObjectId.isValid(tenantId)) {
      throw { status: 404, code: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' };
    }

    const localPart = (input.localPart || '').trim().toLowerCase();
    if (!/^[a-zA-Z0-9._-]+$/.test(localPart)) {
      throw {
        status: 400,
        code: 'INVALID_LOCAL_PART',
        message: 'Local part can only contain letters, numbers, dots, hyphens, and underscores',
      };
    }

    // 1. Fetch tenant and verify status
    const tenant = await TenantModel.findById(tenantId);
    if (!tenant) {
      throw { status: 404, code: 'TENANT_NOT_FOUND', message: 'Tenant not found' };
    }
    if (tenant.status === 'suspended' || tenant.status === 'pending_deletion') {
      throw {
        status: 403,
        code: 'TENANT_SUSPENDED',
        message: 'Tenant is suspended; alias creation is blocked',
      };
    }

    // 2. Fetch mailbox and check status
    const mailbox = await MailboxModel.findOne({ _id: mailboxId, tenantId });
    if (!mailbox) {
      throw { status: 404, code: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' };
    }
    if (mailbox.status === 'suspended') {
      throw {
        status: 403,
        code: 'MAILBOX_SUSPENDED',
        message: 'Cannot add aliases to a suspended mailbox',
      };
    }

    // 3. Aliases always stay on the mailbox's own domain. This prevents a
    // caller from creating an address on another domain by changing a request.
    const domain = await DomainModel.findOne({ _id: mailbox.domainId, tenantId });
    if (!domain) {
      throw { status: 404, code: 'DOMAIN_NOT_FOUND', message: 'Domain not found for this tenant' };
    }
    if (domain.status === 'suspended' || domain.dnsStatus !== 'active') {
      throw {
        status: 403,
        code: 'DOMAIN_NOT_ACTIVE',
        message: `Domain '${domain.domainName}' is not active; aliases cannot be added to it`,
      };
    }

    const fullAddress = `${localPart}@${domain.domainName}`;

    // 4. Collision checks:
    // a. Primary mailbox address collision
    const existingPrimary = await MailboxModel.findOne({ address: fullAddress });
    if (existingPrimary) {
      throw {
        status: 409,
        code: 'ADDRESS_IN_USE',
        message: `Address '${fullAddress}' is already in use by a primary mailbox`,
      };
    }

    // b. Alias address collision across any mailbox
    const existingAlias = await MailboxModel.findOne({ 'aliases.address': fullAddress });
    if (existingAlias) {
      throw {
        status: 409,
        code: 'ALIAS_EXISTS',
        message: `Alias '${fullAddress}' already exists`,
      };
    }

    // 5. Stalwart Domain Resolution
    let stalwartDomainId = domain.stalwartDomainId;
    if (!stalwartDomainId) {
      try {
        stalwartDomainId = await resolvePlatformStalwartDomainId(domain);
      } catch (err: any) {
        stalwartDomainId = domain.domainName;
      }
    }

    // 6. Update Stalwart if mailbox is provisioned
    if (mailbox.stalwartAccountId) {
      const currentAliases = mailbox.aliases || [];

      // Resolve stalwartDomainIds for all domains involved in existing aliases
      const domainIdsToResolve = [...new Set(currentAliases.map((a) => a.domainId.toString()))];
      const domainDocs = await DomainModel.find({ _id: { $in: domainIdsToResolve } });
      const domainMap = new Map<string, any>();
      for (const d of domainDocs) {
        domainMap.set(d._id.toString(), d);
      }

      const resolvedCurrentAliases: StalwartEmailAlias[] = await Promise.all(
        currentAliases.map(async (a) => {
          const d = domainMap.get(a.domainId.toString());
          let resolvedId = d?.stalwartDomainId;
          if (!resolvedId && d) {
            try {
              resolvedId = await resolvePlatformStalwartDomainId(d);
            } catch {
              resolvedId = a.domainName;
            }
          }
          return {
            name: a.localPart,
            domainId: resolvedId || a.domainName,
            description: a.description || null,
            enabled: true,
          };
        })
      );

      const stalwartAliases: StalwartEmailAlias[] = [
        ...resolvedCurrentAliases,
        {
          name: localPart,
          domainId: stalwartDomainId || domain.domainName,
          description: input.description?.trim() || null,
          enabled: true,
        },
      ];

      try {
        await stalwartClient.updateAccountAliases(mailbox.stalwartAccountId, stalwartAliases);
      } catch (err: any) {
        throw {
          status: 502,
          code: 'STALWART_SYNC_FAILED',
          message: `Failed to sync alias to mail server: ${err.message}`,
        };
      }
    }

    // 7. Push to MongoDB subdocuments
    const newAliasDoc = {
      _id: new mongoose.Types.ObjectId(),
      localPart,
      domainId: domain._id,
      domainName: domain.domainName,
      address: fullAddress,
      description: input.description?.trim() || null,
      createdAt: new Date(),
    };

    mailbox.aliases.push(newAliasDoc as any);
    await mailbox.save();

    await logAudit({
      actorId,
      actorRole,
      tenantId: tenant._id.toString(),
      action: 'MAILBOX_ALIAS_CREATED',
      resource: 'MAILBOX',
      resourceId: mailbox._id.toString(),
      metadata: { address: fullAddress, mailboxAddress: mailbox.address, domainName: domain.domainName },
      success: true,
    });

    return {
      id: newAliasDoc._id.toString(),
      localPart: newAliasDoc.localPart,
      domainId: newAliasDoc.domainId.toString(),
      domainName: newAliasDoc.domainName,
      address: newAliasDoc.address,
      description: newAliasDoc.description,
      createdAt: newAliasDoc.createdAt.toISOString(),
    };
  }

  /**
   * Delete an email alias from a mailbox:
   * 1. Validates existence and tenant ownership.
   * 2. Removes alias from Stalwart account via JMAP.
   * 3. Removes alias subdocument from MongoDB.
   */
  static async deleteAlias(
    mailboxId: string,
    tenantId: string,
    aliasId: string,
    actorId?: string,
    actorRole = 'TENANT_ADMIN'
  ): Promise<void> {
    if (
      !mongoose.Types.ObjectId.isValid(mailboxId) ||
      !mongoose.Types.ObjectId.isValid(tenantId) ||
      !mongoose.Types.ObjectId.isValid(aliasId)
    ) {
      throw { status: 404, code: 'ALIAS_NOT_FOUND', message: 'Alias or mailbox not found' };
    }

    const tenant = await TenantModel.findById(tenantId);
    if (!tenant) {
      throw { status: 404, code: 'TENANT_NOT_FOUND', message: 'Tenant not found' };
    }
    if (tenant.status === 'suspended' || tenant.status === 'pending_deletion') {
      throw {
        status: 403,
        code: 'TENANT_SUSPENDED',
        message: 'Tenant is suspended; alias deletion is blocked',
      };
    }

    const mailbox = await MailboxModel.findOne({ _id: mailboxId, tenantId });
    if (!mailbox) {
      throw { status: 404, code: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' };
    }

    const aliasDoc = mailbox.aliases.find((a) => a._id.toString() === aliasId);
    if (!aliasDoc) {
      throw { status: 404, code: 'ALIAS_NOT_FOUND', message: 'Alias not found on this mailbox' };
    }

    // Stalwart sync: remove alias from Stalwart account
    if (mailbox.stalwartAccountId) {
      const remainingAliasDocs = mailbox.aliases.filter((a) => a._id.toString() !== aliasId);

      const domainIdsToResolve = [...new Set(remainingAliasDocs.map((a) => a.domainId.toString()))];
      const domainDocs = await DomainModel.find({ _id: { $in: domainIdsToResolve } });
      const domainMap = new Map<string, any>();
      for (const d of domainDocs) {
        domainMap.set(d._id.toString(), d);
      }

      const remainingAliases: StalwartEmailAlias[] = await Promise.all(
        remainingAliasDocs.map(async (a) => {
          const d = domainMap.get(a.domainId.toString());
          let resolvedId = d?.stalwartDomainId;
          if (!resolvedId && d) {
            try {
              resolvedId = await resolvePlatformStalwartDomainId(d);
            } catch {
              resolvedId = a.domainName;
            }
          }
          return {
            name: a.localPart,
            domainId: resolvedId || a.domainName,
            description: a.description || null,
            enabled: true,
          };
        })
      );

      try {
        await stalwartClient.updateAccountAliases(mailbox.stalwartAccountId, remainingAliases);
      } catch (err: any) {
        console.warn(`[MailboxService] Failed to remove alias ${aliasDoc.address} from Stalwart:`, err.message);
      }
    }

    // Pull from MongoDB
    mailbox.aliases = mailbox.aliases.filter((a) => a._id.toString() !== aliasId) as any;
    await mailbox.save();

    await logAudit({
      actorId,
      actorRole,
      tenantId: tenant._id.toString(),
      action: 'MAILBOX_ALIAS_DELETED',
      resource: 'MAILBOX',
      resourceId: mailbox._id.toString(),
      metadata: { address: aliasDoc.address, mailboxAddress: mailbox.address },
      success: true,
    });
  }

  /**
   * List all aliases for a specific mailbox.
   */
  static async listAliases(mailboxId: string, tenantId?: string): Promise<MailboxAliasRecord[]> {
    if (!mongoose.Types.ObjectId.isValid(mailboxId)) {
      throw { status: 404, code: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' };
    }

    const filter: any = { _id: mailboxId };
    if (tenantId) {
      if (!mongoose.Types.ObjectId.isValid(tenantId)) {
        throw { status: 404, code: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' };
      }
      filter.tenantId = tenantId;
    }

    const mailbox = await MailboxModel.findOne(filter);
    if (!mailbox) {
      throw { status: 404, code: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' };
    }

    return (mailbox.aliases || []).map((a) => ({
      id: a._id.toString(),
      localPart: a.localPart,
      domainId: a.domainId.toString(),
      domainName: a.domainName,
      address: a.address,
      description: a.description || null,
      createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : (a.createdAt ? new Date(a.createdAt).toISOString() : new Date().toISOString()),
    }));
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

