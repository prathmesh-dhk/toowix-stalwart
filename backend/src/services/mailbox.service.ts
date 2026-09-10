import mongoose from 'mongoose';
import { MailboxModel } from '../db/models/Mailbox';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { stalwartClient } from '../stalwart/client';
import { logAudit } from '../audit/service';
import { StalwartAccountExistsError, StalwartError } from '../stalwart/errors';

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
      if (existingTenant.status === 'suspended') {
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
    if (tenant?.status === 'suspended') {
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
    if (tenant?.status === 'suspended') {
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
}
