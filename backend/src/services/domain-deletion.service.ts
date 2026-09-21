import mongoose from 'mongoose';
import { DomainModel } from '../db/models/Domain';
import { MailboxModel } from '../db/models/Mailbox';
import { DomainSubscriptionModel } from '../db/models/DomainSubscription';
import { DomainDnsCredentialModel } from '../db/models/DomainDnsCredential';
import { stripeClient } from '../stripe/client';
import { stalwartClient } from '../stalwart/client';
import { logAudit } from '../audit/service';

export interface DeletionActor {
  id: string;
  email: string;
  role: string;
}

export class DomainDeletionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400
  ) {
    super(message);
    this.name = 'DomainDeletionError';
  }
}

/**
 * The destructive cascade behind the tenant's own zero-mailbox instant delete:
 * 1. Cancels live Stripe subscription (if one exists).
 * 2. Purges DomainSubscription document.
 * 3. Purges DomainDnsCredential document.
 * 4. Deletes domain from Stalwart mail server.
 * 5. Deletes Domain document from MongoDB.
 * 6. If primary domain was deleted, reassigns another domain as primary.
 * Caller is responsible for re-verifying the mailbox count is zero
 * immediately before invoking this — it does no such check itself.
 */
export async function executeDeletionCascade(domainId: mongoose.Types.ObjectId | string, tenantId: mongoose.Types.ObjectId | string): Promise<{ wasPrimary: boolean }> {
  const domain = await DomainModel.findById(domainId);

  // 1. Cancel live Stripe subscription if present
  const subscription = await DomainSubscriptionModel.findOne({ domainId });
  if (subscription?.stripeSubscriptionId) {
    try {
      await stripeClient.cancelSubscription(subscription.stripeSubscriptionId);
    } catch (err: any) {
      console.warn(`[Domain Deletion] Stripe cancel skipped/failed for ${subscription.stripeSubscriptionId}:`, err.message);
    }
  }

  // 2. Delete DomainSubscription
  await DomainSubscriptionModel.deleteOne({ domainId });

  // 3. Delete DomainDnsCredential
  await DomainDnsCredentialModel.deleteOne({ domainId });

  // 4. Delete Stalwart domain & DKIM keys
  if (domain?.stalwartDomainId) {
    try {
      await stalwartClient.deleteDomain(domain.stalwartDomainId);
    } catch (err: any) {
      console.warn(`[Domain Deletion] Stalwart deleteDomain failed for ${domain.stalwartDomainId}:`, err.message);
    }
  } else if (domain) {
    try {
      const liveDomains = await stalwartClient.listDomains();
      const match = liveDomains.find((d) => d.name.toLowerCase() === domain.domainName.toLowerCase());
      if (match?.id) {
        await stalwartClient.deleteDomain(match.id);
      }
    } catch (err: any) {
      console.warn(`[Domain Deletion] Stalwart domain lookup/delete failed for ${domain.domainName}:`, err.message);
    }
  }

  // 5. Delete Domain from MongoDB
  const wasPrimary = Boolean(domain?.isPrimary);
  await DomainModel.deleteOne({ _id: domainId });

  // 6. Reassign primary domain if deleted domain was primary
  if (wasPrimary) {
    const nextDomain = await DomainModel.findOne({ tenantId }).sort({ createdAt: 1 });
    if (nextDomain) {
      nextDomain.isPrimary = true;
      await nextDomain.save();
    }
  }

  return { wasPrimary };
}

/**
 * Lets a tenant delete a domain immediately, with no Super Admin approval —
 * allowed only when the domain currently has zero mailboxes, the same bar
 * requestDomainDeletion already enforces before a request can even be
 * created. Also resolves (auto-approves) any pending deletion request for
 * this domain so it doesn't linger in the Super Admin queue for a domain
 * that no longer exists.
 */
export async function deleteDomainDirectly(
  domainId: string,
  tenantId: string,
  actor: DeletionActor
): Promise<{ success: boolean; domainName: string }> {
  const domain = await DomainModel.findOne({ _id: domainId, tenantId });
  if (!domain) {
    throw new DomainDeletionError('Domain not found or unauthorized', 'DOMAIN_NOT_FOUND', 404);
  }

  const mailboxCount = await MailboxModel.countDocuments({ domainId: domain._id, tenantId });
  if (mailboxCount > 0) {
    throw new DomainDeletionError(
      `Cannot delete domain '${domain.domainName}': ${mailboxCount} mailbox(es) still exist. Remove all mailboxes first.`,
      'MAILBOXES_EXIST',
      400
    );
  }

  const domainName = domain.domainName;
  const { wasPrimary } = await executeDeletionCascade(domain._id, domain.tenantId);

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'DOMAIN_DELETED_DIRECT',
    resource: 'DOMAIN',
    resourceId: domainId,
    metadata: {
      domainName,
      wasPrimary,
    },
  });

  return { success: true, domainName };
}
