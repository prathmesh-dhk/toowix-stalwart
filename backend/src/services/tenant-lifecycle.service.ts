import { Types } from 'mongoose';
import { DomainModel } from '../db/models/Domain';
import { MailboxModel } from '../db/models/Mailbox';
import { AdminUserModel } from '../db/models/AdminUser';
import { AdminSessionModel } from '../db/models/AdminSession';
import { ActivationTokenModel } from '../db/models/ActivationToken';
import { TenantDnsCredentialModel } from '../db/models/TenantDnsCredential';
import { TenantModel } from '../db/models/Tenant';
import { stalwartClient } from '../stalwart/client';
import { executeDeletionCascade } from './domain-deletion.service';

/**
 * Tenant-wide infrastructure cascades shared by the Super Admin suspend/reactivate
 * routes and the organisation-deletion flow (which suspends for its cooling-off
 * period and finally purges). They only touch domains/mailboxes/Stalwart — callers
 * own the Tenant.status transition and the audit trail.
 */

async function resolveStalwartDomainId(domain: { domainName: string; stalwartDomainId?: string | null; save: () => Promise<unknown> }) {
  if (domain.stalwartDomainId) return domain.stalwartDomainId;
  try {
    const liveDomains = await stalwartClient.listDomains();
    const match = liveDomains.find((d) => d.name.toLowerCase() === domain.domainName.toLowerCase());
    if (match) {
      domain.stalwartDomainId = match.id;
      await domain.save();
      return match.id;
    }
  } catch (err: any) {
    console.warn(`[TenantLifecycle] Could not query Stalwart live domains for ${domain.domainName}:`, err.message);
  }
  return null;
}

/** Disable every domain of the tenant and freeze every mailbox, in MongoDB and Stalwart. */
export async function suspendTenantInfrastructure(tenantId: string | Types.ObjectId): Promise<void> {
  const domains = await DomainModel.find({ tenantId });
  await DomainModel.updateMany({ tenantId }, { status: 'suspended' });

  const stalwartDomainIds = new Set<string>();
  for (const domain of domains) {
    const id = await resolveStalwartDomainId(domain);
    if (!id) continue;
    stalwartDomainIds.add(id);
    try {
      await stalwartClient.updateDomainStatus(id, false);
    } catch (err: any) {
      console.warn(`[TenantLifecycle] Failed to disable Stalwart domain ${id}:`, err.message);
    }
  }

  const mailboxes = await MailboxModel.find({ tenantId });
  await MailboxModel.updateMany({ tenantId }, { status: 'suspended' });

  let liveAccounts: any[] = [];
  try {
    liveAccounts = await stalwartClient.listAccounts();
  } catch (err: any) {
    console.warn('[TenantLifecycle] Could not list Stalwart accounts during suspend:', err.message);
  }

  for (const mailbox of mailboxes) {
    let accountId = mailbox.stalwartAccountId;
    if (!accountId) {
      const match = liveAccounts.find(
        (a) =>
          a.emailAddress?.toLowerCase() === mailbox.address.toLowerCase() ||
          (a.name?.toLowerCase() === mailbox.localPart.toLowerCase() &&
            (stalwartDomainIds.size === 0 || stalwartDomainIds.has(a.domainId)))
      );
      if (match) {
        accountId = match.id;
        mailbox.stalwartAccountId = match.id;
        await mailbox.save();
      }
    }

    if (accountId) {
      try {
        await stalwartClient.updateAccountStatus(accountId, true);
      } catch (err: any) {
        console.warn(`[TenantLifecycle] Failed to freeze Stalwart account ${accountId} (${mailbox.address}):`, err.message);
      }
    }
  }
}

/** Inverse of suspendTenantInfrastructure. */
export async function restoreTenantInfrastructure(tenantId: string | Types.ObjectId): Promise<void> {
  const domains = await DomainModel.find({ tenantId });
  await DomainModel.updateMany({ tenantId }, { status: 'active' });

  for (const domain of domains) {
    const id = await resolveStalwartDomainId(domain);
    if (!id) continue;
    try {
      await stalwartClient.updateDomainStatus(id, true);
    } catch (err: any) {
      console.warn(`[TenantLifecycle] Failed to enable Stalwart domain ${id}:`, err.message);
    }
  }

  const mailboxes = await MailboxModel.find({ tenantId });
  await MailboxModel.updateMany({ tenantId }, { status: 'active' });

  for (const mailbox of mailboxes) {
    if (!mailbox.stalwartAccountId) continue;
    try {
      await stalwartClient.updateAccountStatus(mailbox.stalwartAccountId, false);
    } catch (err: any) {
      console.warn(`[TenantLifecycle] Failed to unfreeze Stalwart account ${mailbox.stalwartAccountId} (${mailbox.address}):`, err.message);
    }
  }
}

export interface PurgeSummary {
  mailboxesDeleted: number;
  domainNames: string[];
}

/**
 * Irreversibly removes the tenant and everything hanging off it: Stalwart accounts and
 * domains, Stripe subscriptions, DNS credentials, admin users and their sessions.
 * Does NOT touch the OrganisationDeletion audit record or the registration-email block —
 * those must outlive the organisation.
 */
export async function purgeTenant(tenantId: string | Types.ObjectId): Promise<PurgeSummary> {
  const mailboxes = await MailboxModel.find({ tenantId });
  for (const m of mailboxes) {
    if (!m.stalwartAccountId) continue;
    try {
      await stalwartClient.deleteAccount(m.stalwartAccountId);
    } catch (err: any) {
      console.warn(`[TenantLifecycle] Failed to delete Stalwart account ${m.stalwartAccountId}:`, err.message);
    }
  }
  await MailboxModel.deleteMany({ tenantId });

  const domains = await DomainModel.find({ tenantId });
  for (const domain of domains) {
    // Stripe cancel, subscription + DNS credential purge, Stalwart domain delete, Domain delete.
    await executeDeletionCascade(domain._id, tenantId);
  }
  await DomainModel.deleteMany({ tenantId });

  const adminIds = (await AdminUserModel.find({ tenantId }).select('_id')).map((u) => u._id);
  await AdminSessionModel.deleteMany({ userId: { $in: adminIds } });
  await AdminUserModel.deleteMany({ tenantId });
  await ActivationTokenModel.deleteMany({ tenantId });
  await TenantDnsCredentialModel.deleteMany({ tenantId });
  await TenantModel.deleteOne({ _id: tenantId });

  return { mailboxesDeleted: mailboxes.length, domainNames: domains.map((d) => d.domainName) };
}
