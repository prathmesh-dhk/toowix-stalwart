import mongoose from 'mongoose';
import { DomainModel } from '../db/models/Domain';
import { MailboxModel } from '../db/models/Mailbox';
import { DomainSubscriptionModel } from '../db/models/DomainSubscription';
import { DomainDnsCredentialModel } from '../db/models/DomainDnsCredential';
import { DomainDeletionRequestModel, IDomainDeletionRequest } from '../db/models/DomainDeletionRequest';
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
 * Creates a pending deletion request for a domain after strictly validating that
 * zero mailboxes are hosted on the domain.
 */
export async function requestDomainDeletion(
  domainId: string,
  tenantId: string,
  actor: DeletionActor,
  reason?: string
): Promise<IDomainDeletionRequest> {
  const domain = await DomainModel.findOne({ _id: domainId, tenantId });
  if (!domain) {
    throw new DomainDeletionError('Domain not found or unauthorized', 'DOMAIN_NOT_FOUND', 404);
  }

  // 1. Mailbox-zero enforcement
  const mailboxCount = await MailboxModel.countDocuments({ domainId: domain._id, tenantId });
  if (mailboxCount > 0) {
    throw new DomainDeletionError(
      `Cannot request deletion for domain '${domain.domainName}': ${mailboxCount} mailbox(es) still exist. Remove all mailboxes first.`,
      'MAILBOXES_EXIST',
      400
    );
  }

  // 2. Prevent duplicate pending requests
  const existingPending = await DomainDeletionRequestModel.findOne({
    domainId: domain._id,
    status: 'pending',
  });
  if (existingPending) {
    throw new DomainDeletionError(
      `A deletion request is already pending review for domain '${domain.domainName}'.`,
      'DELETION_REQUEST_ALREADY_PENDING',
      409
    );
  }

  // 3. Create deletion request
  const request = await DomainDeletionRequestModel.create({
    domainId: domain._id,
    tenantId: domain.tenantId,
    domainName: domain.domainName,
    status: 'pending',
    reason: reason?.trim() || null,
    requestedBy: new mongoose.Types.ObjectId(actor.id),
    requestedByEmail: actor.email,
  });

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
    tenantId,
    action: 'DOMAIN_DELETION_REQUESTED',
    resource: 'DOMAIN',
    resourceId: domain._id.toString(),
    metadata: {
      domainName: domain.domainName,
      requestId: request._id.toString(),
      reason: reason?.trim() || null,
    },
  });

  return request;
}

/**
 * Retrieves the latest deletion request for a specific domain.
 */
export async function getDomainDeletionRequest(
  domainId: string,
  tenantId: string
): Promise<IDomainDeletionRequest | null> {
  return DomainDeletionRequestModel.findOne({ domainId, tenantId }).sort({ createdAt: -1 });
}

/**
 * The destructive cascade shared by both the Super-Admin-approved deletion
 * flow and the tenant's own zero-mailbox instant delete:
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

export async function approveDomainDeletion(
  requestId: string,
  reviewer: DeletionActor
): Promise<{ success: boolean; domainName: string }> {
  const request = await DomainDeletionRequestModel.findById(requestId);
  if (!request) {
    throw new DomainDeletionError('Domain deletion request not found', 'REQUEST_NOT_FOUND', 404);
  }

  if (request.status !== 'pending') {
    throw new DomainDeletionError(
      `Cannot approve request with status '${request.status}'`,
      'INVALID_REQUEST_STATUS',
      409
    );
  }

  // Re-verify mailbox count is still zero before executing destructive cascade
  const mailboxCount = await MailboxModel.countDocuments({
    domainId: request.domainId,
    tenantId: request.tenantId,
  });
  if (mailboxCount > 0) {
    throw new DomainDeletionError(
      `Cannot execute deletion: ${mailboxCount} mailbox(es) were created since request was submitted. Remove all mailboxes first.`,
      'MAILBOXES_EXIST',
      400
    );
  }

  const domainName = request.domainName;
  const { wasPrimary } = await executeDeletionCascade(request.domainId, request.tenantId);

  // Update Deletion Request status
  request.status = 'approved';
  request.reviewedBy = new mongoose.Types.ObjectId(reviewer.id);
  request.reviewedByEmail = reviewer.email;
  request.reviewedAt = new Date();
  await request.save();

  // Audit logs
  await logAudit({
    actorId: reviewer.id,
    actorRole: reviewer.role,
    actorEmail: reviewer.email,
    tenantId: request.tenantId.toString(),
    action: 'DOMAIN_DELETION_APPROVED',
    resource: 'DOMAIN_DELETION_REQUEST',
    resourceId: request._id.toString(),
    metadata: {
      domainName,
      domainId: request.domainId.toString(),
    },
  });

  await logAudit({
    actorId: reviewer.id,
    actorRole: reviewer.role,
    actorEmail: reviewer.email,
    tenantId: request.tenantId.toString(),
    action: 'DOMAIN_DELETED',
    resource: 'DOMAIN',
    resourceId: request.domainId.toString(),
    metadata: {
      domainName,
      wasPrimary,
    },
  });

  return { success: true, domainName };
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

  await DomainDeletionRequestModel.updateMany(
    { domainId: domain._id, status: 'pending' },
    {
      status: 'approved',
      reviewedBy: new mongoose.Types.ObjectId(actor.id),
      reviewedByEmail: actor.email,
      reviewedAt: new Date(),
    }
  );

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

/**
 * Rejects a domain deletion request without any side effects.
 */
export async function rejectDomainDeletion(
  requestId: string,
  reviewer: DeletionActor,
  rejectionReason?: string
): Promise<{ success: boolean; domainName: string }> {
  const request = await DomainDeletionRequestModel.findById(requestId);
  if (!request) {
    throw new DomainDeletionError('Domain deletion request not found', 'REQUEST_NOT_FOUND', 404);
  }

  if (request.status !== 'pending') {
    throw new DomainDeletionError(
      `Cannot reject request with status '${request.status}'`,
      'INVALID_REQUEST_STATUS',
      409
    );
  }

  request.status = 'rejected';
  request.rejectionReason = rejectionReason?.trim() || null;
  request.reviewedBy = new mongoose.Types.ObjectId(reviewer.id);
  request.reviewedByEmail = reviewer.email;
  request.reviewedAt = new Date();
  await request.save();

  await logAudit({
    actorId: reviewer.id,
    actorRole: reviewer.role,
    actorEmail: reviewer.email,
    tenantId: request.tenantId.toString(),
    action: 'DOMAIN_DELETION_REJECTED',
    resource: 'DOMAIN_DELETION_REQUEST',
    resourceId: request._id.toString(),
    metadata: {
      domainName: request.domainName,
      rejectionReason: rejectionReason?.trim() || null,
    },
  });

  return { success: true, domainName: request.domainName };
}

/**
 * Lists deletion requests for Super Admin with filtering and pagination.
 */
export async function listDomainDeletionRequests(params: {
  status?: string;
  limit?: number;
  skip?: number;
}): Promise<{
  requests: any[];
  total: number;
  limit: number;
  skip: number;
}> {
  const limit = Math.min(Math.max(params.limit || 50, 1), 100);
  const skip = Math.max(params.skip || 0, 0);

  const query: Record<string, any> = {};
  if (params.status && params.status !== 'ALL') {
    query.status = params.status.toLowerCase();
  }

  const [requests, total] = await Promise.all([
    DomainDeletionRequestModel.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('tenantId', 'name')
      .lean(),
    DomainDeletionRequestModel.countDocuments(query),
  ]);

  return {
    requests: requests.map((r: any) => ({
      id: r._id.toString(),
      domainId: r.domainId.toString(),
      tenantId: r.tenantId?._id ? r.tenantId._id.toString() : r.tenantId?.toString() || '',
      tenantName: r.tenantId?.name || 'Unknown Tenant',
      domainName: r.domainName,
      status: r.status,
      reason: r.reason || null,
      requestedByEmail: r.requestedByEmail,
      reviewedByEmail: r.reviewedByEmail || null,
      reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
      rejectionReason: r.rejectionReason || null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
    total,
    limit,
    skip,
  };
}
