import crypto from 'crypto';
import { TenantModel } from '../db/models/Tenant';
import { DomainModel } from '../db/models/Domain';
import { MailboxModel } from '../db/models/Mailbox';
import { stalwartClient } from '../stalwart/client';
import { config } from '../config';
import { logAudit } from '../audit/service';

export interface QuotaDiscrepancy {
  tenantId: string;
  tenantName: string;
  recordedMailboxCount: number;
  actualActiveMailboxes: number;
}

export interface EntityDriftRepairResult {
  repairedCount: number;
  restoredDomains: string[];
  restoredMailboxes: string[];
  failedDomains: { domain: string; error: string }[];
  failedMailboxes: { mailbox: string; error: string }[];
  quotaRepairedCount: number;
  synchronized: boolean;
}

export interface DriftReport {
  timestamp: string;
  synchronized: boolean;
  database: {
    tenantsCount: number;
    domainsCount: number;
    activeMailboxesCount: number;
    suspendedMailboxesCount: number;
  };
  stalwart: {
    domainsCount: number;
    accountsCount: number;
  };
  drift: {
    missingInStalwartDomains: string[];
    orphanedInStalwartDomains: string[];
    missingInStalwartMailboxes: string[];
    orphanedInStalwartAccounts: string[];
    quotaDiscrepancies: QuotaDiscrepancy[];
  };
}

export class ReconciliationService {
  /**
   * Generates a comprehensive drift report between MongoDB (single source of truth)
   * and Stalwart (mail delivery and storage engine).
   */
  async checkDrift(): Promise<DriftReport> {
    // 1. Fetch DB tenants, domains, and mailboxes
    const [tenants, domains, mailboxes] = await Promise.all([
      TenantModel.find().lean(),
      DomainModel.find({ status: 'active' }).lean(),
      MailboxModel.find().lean(),
    ]);

    const dbDomains = new Set(domains.map((d) => d.domainName.toLowerCase().trim()));
    const activeDbMailboxes = new Set(
      mailboxes
        .filter((m) => m.status === 'active')
        .map((m) => m.address.toLowerCase().trim())
    );
    const suspendedMailboxesCount = mailboxes.filter((m) => m.status === 'suspended').length;

    // 2. Check Quota Invariants
    const quotaDiscrepancies: QuotaDiscrepancy[] = [];
    for (const t of tenants) {
      const actualActive = mailboxes.filter(
        (m) => m.tenantId.toString() === t._id.toString() && m.status === 'active'
      ).length;

      if (t.mailboxCount !== actualActive) {
        quotaDiscrepancies.push({
          tenantId: t._id.toString(),
          tenantName: t.name,
          recordedMailboxCount: t.mailboxCount,
          actualActiveMailboxes: actualActive,
        });
      }
    }

    // 3. Fetch Stalwart live domains and accounts
    let stalwartDomains: any[] = [];
    let stalwartAccounts: any[] = [];
    try {
      [stalwartDomains, stalwartAccounts] = await Promise.all([
        stalwartClient.listDomains(),
        stalwartClient.listAccounts(),
      ]);
    } catch (err: any) {
      console.warn('[Reconciliation] Failed to query Stalwart:', err.message);
    }

    // System objects to ignore (management principal domain & credentials)
    const systemDomain = (config.stalwart.user.split('@')[1] || 'toowix.test').toLowerCase();
    const systemAccountEmails = new Set([
      config.stalwart.user.toLowerCase(),
      `admin@${systemDomain}`.toLowerCase(),
    ]);

    const stDomains = new Set(
      stalwartDomains
        .map((d) => d.name.toLowerCase().trim())
        .filter((name) => name !== systemDomain)
    );

    const stAccounts = new Set(
      stalwartAccounts
        .map((a) => (a.emailAddress || a.name).toLowerCase().trim())
        .filter((addr) => !systemAccountEmails.has(addr) && !addr.endsWith(`@${systemDomain}`))
    );

    // 4. Compute domain drift
    const missingInStalwartDomains: string[] = [];
    for (const d of dbDomains) {
      if (!stDomains.has(d)) {
        missingInStalwartDomains.push(d);
      }
    }

    const orphanedInStalwartDomains: string[] = [];
    for (const d of stDomains) {
      if (!dbDomains.has(d)) {
        orphanedInStalwartDomains.push(d);
      }
    }

    // 5. Compute mailbox drift
    const missingInStalwartMailboxes: string[] = [];
    for (const addr of activeDbMailboxes) {
      if (!stAccounts.has(addr)) {
        missingInStalwartMailboxes.push(addr);
      }
    }

    const orphanedInStalwartAccounts: string[] = [];
    for (const addr of stAccounts) {
      if (!activeDbMailboxes.has(addr)) {
        orphanedInStalwartAccounts.push(addr);
      }
    }

    const synchronized =
      missingInStalwartDomains.length === 0 &&
      orphanedInStalwartDomains.length === 0 &&
      missingInStalwartMailboxes.length === 0 &&
      orphanedInStalwartAccounts.length === 0 &&
      quotaDiscrepancies.length === 0;

    return {
      timestamp: new Date().toISOString(),
      synchronized,
      database: {
        tenantsCount: tenants.length,
        domainsCount: dbDomains.size,
        activeMailboxesCount: activeDbMailboxes.size,
        suspendedMailboxesCount,
      },
      stalwart: {
        domainsCount: stDomains.size,
        accountsCount: stAccounts.size,
      },
      drift: {
        missingInStalwartDomains,
        orphanedInStalwartDomains,
        missingInStalwartMailboxes,
        orphanedInStalwartAccounts,
        quotaDiscrepancies,
      },
    };
  }

  /**
   * Recalculates and updates the mailboxCount for all tenants to match
   * the exact number of active mailboxes in MongoDB.
   */
  async repairQuotaDrift(): Promise<{
    repairedCount: number;
    details: { tenantId: string; tenantName: string; oldCount: number; newCount: number }[];
  }> {
    const tenants = await TenantModel.find();
    const details: { tenantId: string; tenantName: string; oldCount: number; newCount: number }[] = [];

    for (const t of tenants) {
      const actualCount = await MailboxModel.countDocuments({
        tenantId: t._id,
        status: 'active',
      });

      if (t.mailboxCount !== actualCount) {
        const oldCount = t.mailboxCount;
        t.mailboxCount = actualCount;
        await t.save();
        details.push({
          tenantId: t._id.toString(),
          tenantName: t.name,
          oldCount,
          newCount: actualCount,
        });
      }
    }

    return {
      repairedCount: details.length,
      details,
    };
  }

  /**
   * Automatically repairs entity drift by re-provisioning missing domains and mailboxes in Stalwart.
   * Also repairs quota drift across all tenants.
   */
  async repairEntityDrift(): Promise<EntityDriftRepairResult> {
    const driftReport = await this.checkDrift();
    const restoredDomains: string[] = [];
    const restoredMailboxes: string[] = [];
    const failedDomains: { domain: string; error: string }[] = [];
    const failedMailboxes: { mailbox: string; error: string }[] = [];

    // 1. Restore missing domains in Stalwart
    for (const domainName of driftReport.drift.missingInStalwartDomains) {
      try {
        const domainDoc = await DomainModel.findOne({
          domainName: new RegExp(`^${domainName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        });
        const createdDomain = await stalwartClient.createDomain(
          domainName,
          `Restored domain via Reconciliation Service`
        );
        if (domainDoc) {
          domainDoc.stalwartDomainId = createdDomain.id;
          await domainDoc.save();
        }
        restoredDomains.push(domainName);
        await logAudit({
          action: 'STALWART_DRIFT_DOMAIN_RESTORED',
          actorRole: 'SUPER_ADMIN',
          resource: 'Domain',
          resourceId: domainDoc?._id?.toString() || null,
          tenantId: domainDoc?.tenantId?.toString() || null,
          metadata: { domain: domainName, stalwartDomainId: createdDomain.id, source: 'reconciliation_auto_repair' },
        });
      } catch (err: any) {
        failedDomains.push({ domain: domainName, error: err.message || String(err) });
      }
    }

    // 2. Restore missing mailboxes in Stalwart
    for (const address of driftReport.drift.missingInStalwartMailboxes) {
      try {
        const mailboxDoc = await MailboxModel.findOne({
          address: new RegExp(`^${address.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
          status: 'active',
        });
        if (!mailboxDoc) continue;

        const [localPart, domainName] = address.split('@');
        const domainDoc = await DomainModel.findById(mailboxDoc.domainId);
        let domainId = domainDoc?.stalwartDomainId;
        if (!domainId) {
          const stDomains = await stalwartClient.listDomains();
          const match = stDomains.find((d) => d.name.toLowerCase() === domainName.toLowerCase());
          domainId = match ? match.id : domainName;
        }

        // Generate temporary secure password for restored Stalwart account
        const tempPassword = crypto.randomBytes(16).toString('hex') + 'A1!';
        const createdAccount = await stalwartClient.createAccount({
          name: localPart,
          domainId: domainId,
          password: tempPassword,
          description: mailboxDoc.displayName || localPart,
        });

        mailboxDoc.stalwartAccountId = createdAccount.id;
        await mailboxDoc.save();
        restoredMailboxes.push(address);

        await logAudit({
          action: 'STALWART_DRIFT_MAILBOX_RESTORED',
          actorRole: 'SUPER_ADMIN',
          resource: 'Mailbox',
          resourceId: mailboxDoc._id.toString(),
          tenantId: mailboxDoc.tenantId.toString(),
          metadata: { address, stalwartAccountId: createdAccount.id, source: 'reconciliation_auto_repair' },
        });
      } catch (err: any) {
        failedMailboxes.push({ mailbox: address, error: err.message || String(err) });
      }
    }

    // 3. Repair quota discrepancies if any
    const quotaResult = await this.repairQuotaDrift();

    // 4. Verify post-repair synchronization
    const finalReport = await this.checkDrift();

    return {
      repairedCount: restoredDomains.length + restoredMailboxes.length + quotaResult.repairedCount,
      restoredDomains,
      restoredMailboxes,
      failedDomains,
      failedMailboxes,
      quotaRepairedCount: quotaResult.repairedCount,
      synchronized: finalReport.synchronized,
    };
  }
}

export const reconciliationService = new ReconciliationService();
