import mongoose from 'mongoose';
import { MailboxMigrationJobModel, IMailboxMigrationJob } from '../db/models/MailboxMigrationJob';
import { MailboxService } from './mailbox.service';
import { stalwartClient } from '../stalwart/client';
import { logAudit } from '../audit/service';

export interface MailboxMigrationJobDTO {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  sourceAddress: string;
  destinationAddress: string;
  totalMessages: number;
  migratedMessages: number;
  failedCount?: number;
  deleteSourceAfter?: boolean;
  error: string | null;
}

function toDTO(job: IMailboxMigrationJob): MailboxMigrationJobDTO {
  return {
    id: job._id.toString(),
    status: job.status,
    sourceAddress: job.sourceAddress,
    destinationAddress: job.destinationAddress,
    totalMessages: job.totalMessages,
    migratedMessages: job.migratedMessages,
    failedCount: job.failedCount || 0,
    deleteSourceAfter: job.deleteSourceAfter || false,
    error: job.error || null,
  };
}

/**
 * Kicks off a mailbox migration job to safely copy mail from source to destination.
 * If deleteSourceAfter is false (default), the source mailbox is strictly PRESERVED and not deleted.
 * Progress is polled via getMigrationJobStatus.
 */
export async function startMailboxMigration(
  sourceMailboxId: string,
  destinationMailboxId: string,
  tenantId: string,
  deleteSourceAfter = false,
  actorId?: string,
  actorRole = 'TENANT_ADMIN'
): Promise<{ jobId: string }> {
  if (sourceMailboxId === destinationMailboxId) {
    throw { status: 400, code: 'SAME_MAILBOX', message: 'Choose a different mailbox to migrate mail into' };
  }

  const [source, destination] = await Promise.all([
    MailboxService.getMailboxById(sourceMailboxId, tenantId),
    MailboxService.getMailboxById(destinationMailboxId, tenantId),
  ]);

  if (!source) {
    throw { status: 404, code: 'MAILBOX_NOT_FOUND', message: 'Mailbox not found' };
  }
  if (!destination) {
    throw { status: 404, code: 'DESTINATION_NOT_FOUND', message: 'Destination mailbox not found' };
  }
  if (!source.stalwartAccountId || !destination.stalwartAccountId) {
    throw { status: 409, code: 'MAILBOX_NOT_PROVISIONED', message: 'Both mailboxes must be fully provisioned before migrating mail' };
  }

  const job = await MailboxMigrationJobModel.create({
    tenantId,
    sourceMailboxId,
    sourceAddress: source.address,
    destinationMailboxId,
    destinationAddress: destination.address,
    deleteSourceAfter,
    status: 'queued',
  });

  // Fire-and-forget: the HTTP response returns the job id immediately, progress is polled.
  void runMigrationJob(
    job._id.toString(),
    source.stalwartAccountId,
    destination.stalwartAccountId,
    tenantId,
    deleteSourceAfter,
    actorId,
    actorRole
  );

  return { jobId: job._id.toString() };
}

/**
 * Legacy wrapper: kicks off "migrate then auto-delete".
 */
export async function startMigrationAndDelete(
  sourceMailboxId: string,
  destinationMailboxId: string,
  tenantId: string,
  actorId?: string,
  actorRole = 'TENANT_ADMIN'
): Promise<{ jobId: string }> {
  return startMailboxMigration(sourceMailboxId, destinationMailboxId, tenantId, true, actorId, actorRole);
}

async function runMigrationJob(
  jobId: string,
  sourceStalwartAccountId: string,
  destStalwartAccountId: string,
  tenantId: string,
  deleteSourceAfter: boolean,
  actorId?: string,
  actorRole = 'TENANT_ADMIN'
): Promise<void> {
  const job = await MailboxMigrationJobModel.findById(jobId);
  if (!job) return;

  try {
    job.status = 'running';
    job.startedAt = new Date();
    await job.save();

    const folderName = `Migrated from ${job.sourceAddress}`;
    const result = await stalwartClient.migrateAccountMail(
      sourceStalwartAccountId,
      destStalwartAccountId,
      folderName,
      (migrated, total) => {
        void MailboxMigrationJobModel.updateOne({ _id: jobId }, { migratedMessages: migrated, totalMessages: total });
      }
    );

    const failedCount = result.failedMessageIds?.length || 0;
    job.totalMessages = result.totalMessages;
    job.migratedMessages = result.migratedMessages;
    job.failedCount = failedCount;

    // Strict verification: check if any message failed to migrate
    if (failedCount > 0) {
      throw new Error(`Migration completed with ${failedCount} failed message(s) out of ${result.totalMessages}. Source mailbox was preserved.`);
    }

    // Only delete if explicitly requested
    if (deleteSourceAfter) {
      await MailboxService.deleteMailbox(job.sourceMailboxId.toString(), tenantId, actorId, actorRole);
    }

    job.status = 'completed';
    job.completedAt = new Date();
    await job.save();

    await logAudit({
      actorId,
      actorRole,
      tenantId,
      action: deleteSourceAfter ? 'MAILBOX_MIGRATED_AND_DELETED' : 'MAILBOX_MIGRATED',
      resource: 'MAILBOX',
      resourceId: job.sourceMailboxId.toString(),
      metadata: {
        sourceAddress: job.sourceAddress,
        destinationAddress: job.destinationAddress,
        totalMessages: result.totalMessages,
        migratedMessages: result.migratedMessages,
        failedMessageCount: failedCount,
        deleteSourceAfter,
      },
      success: true,
    });
  } catch (err: any) {
    console.error(`[MailboxMigration] Job ${jobId} failed:`, err.message);
    job.status = 'failed';
    job.error = err.message || 'Migration failed';
    await job.save();
  }
}

export async function getMigrationJobStatus(jobId: string, tenantId: string): Promise<MailboxMigrationJobDTO> {
  if (!mongoose.Types.ObjectId.isValid(jobId)) {
    throw { status: 404, code: 'JOB_NOT_FOUND', message: 'Migration job not found' };
  }
  const job = await MailboxMigrationJobModel.findOne({ _id: jobId, tenantId });
  if (!job) {
    throw { status: 404, code: 'JOB_NOT_FOUND', message: 'Migration job not found' };
  }
  return toDTO(job);
}
