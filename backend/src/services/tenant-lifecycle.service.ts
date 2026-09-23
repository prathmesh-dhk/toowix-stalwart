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

/**
 * Groups deleted mailboxes that belonged to a DIFFERENT tenant (the platform one) by owner, so
 * that tenant's Tenant.mailboxCount can be refunded. Only true login-identity mailboxes
 * (matched by admin email) ever counted against it.
 */
function countByForeignTenant(
  mailboxes: { tenantId: Types.ObjectId }[],
  ownTenantId: string | Types.ObjectId
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of mailboxes) {
    const owner = m.tenantId.toString();
    if (owner === ownTenantId.toString()) continue;
    counts.set(owner, (counts.get(owner) || 0) + 1);
  }
  return counts;
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
  // Admins' platform identity mailboxes (username@<platformMailDomain>) live under the platform
  // tenant, not this one, so a plain {tenantId} sweep would leave them orphaned on the mail server.
  // Collect the addresses before the admin rows are deleted below.
  const adminEmails = (await AdminUserModel.find({ tenantId }).select('email')).map((u) => u.email);
  // Own-domain mailboxes and this tenant's login-identity mailbox (matched by address, filed under
  // the platform tenant) — their local parts are freed back to the pool for another tenant to
  // claim, unlike the login identity's address, which stays permanently blocked (see
  // registration-block service) and is deliberately NOT deleted from that block here.
  const mailboxFilter = { $or: [{ tenantId }, { address: { $in: adminEmails } }] };

  const mailboxes = await MailboxModel.find(mailboxFilter);
  for (const m of mailboxes) {
    if (!m.stalwartAccountId) continue;
    try {
      await stalwartClient.deleteAccount(m.stalwartAccountId);
    } catch (err: any) {
      console.warn(`[TenantLifecycle] Failed to delete Stalwart account ${m.stalwartAccountId}:`, err.message);
    }
  }
  await MailboxModel.deleteMany(mailboxFilter);

  // Identity mailboxes were counted against the platform tenant, so give those seats back —
  // this tenant's own counter dies with it below, but the platform tenant outlives every customer.
  for (const [platformTenantId, count] of countByForeignTenant(mailboxes, tenantId)) {
    await TenantModel.updateOne({ _id: platformTenantId }, { $inc: { mailboxCount: -count } });
  }

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
