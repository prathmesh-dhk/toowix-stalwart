import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel, DomainModel, PlanModel, DomainSubscriptionModel } from '../src/db/models';
import { stalwartClient } from '../src/stalwart/client';
import { runJob } from '../src/jobs/run-once';

let mongoServer: MongoMemoryServer;

describe('runJob (dev run-once entry point)', () => {
  beforeAll(async () => {
    // A developer's .env may switch billing off; the sweeps no-op then.
    delete process.env.SKIP_BILLING;
    process.env.ENABLE_BILLING = 'true';
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri(), autoIndex: true });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await disconnectDatabase();
    await mongoServer.stop();
  });

  it('grace suspends a domain whose Grace Period has expired', async () => {
    vi.spyOn(stalwartClient, 'updateDomainStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue();
    const tenant = await TenantModel.create({ name: 'Acme', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    const plan = await PlanModel.create({ name: 'Team', seatCount: 10, displayOrder: 1, isActive: true });
    const domain = await DomainModel.create({ tenantId: tenant._id, domainName: 'expired.com', status: 'active' });
    await DomainSubscriptionModel.create({
      domainId: domain._id,
      tenantId: tenant._id,
      planId: plan._id,
      stripeSubscriptionId: 'sub_x',
      stripeSubscriptionItemId: 'si_x',
      status: 'grace',
      gracePeriodEndsAt: new Date(Date.now() - 60 * 1000),
    });

    expect(await runJob('grace')).toEqual({ suspended: 1, noticesSent: 0, retriesAttempted: 0 });
    expect((await DomainModel.findById(domain._id))?.status).toBe('suspended');
  });

  it('trial and reconcile each run once and report their result', async () => {
    expect(await runJob('trial')).toEqual({ reminded: 0 });
    expect(await runJob('reconcile')).toEqual({ tenantsChecked: 0, driftCorrected: 0 });
  });

  it('trial runs as of a given date, so a Stripe test clock can be followed', async () => {
    const trialStartedAt = new Date('2026-10-19T12:00:00Z');
    await TenantModel.create({
      name: 'Clocked',
      status: 'active',
      mailboxLimit: 50,
      mailboxCount: 1,
      contactEmail: 'admin@clocked.com',
      trialStartedAt,
      trialEndsAt: new Date(trialStartedAt.getTime() + 60 * 86400000),
    });

    expect(await runJob('trial', new Date(trialStartedAt.getTime() + 46 * 86400000))).toEqual({ reminded: 1 });
    expect((await TenantModel.findOne({ name: 'Clocked' }))?.trialRemindersSent).toEqual([45]);
  });

  it('rejects an unknown job name, listing the valid ones', async () => {
    await expect(runJob('nope')).rejects.toThrow('grace, trial, reconcile');
  });
});
