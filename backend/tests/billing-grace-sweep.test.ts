import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel, DomainModel, PlanModel, DomainSubscriptionModel } from '../src/db/models';
import { stalwartClient } from '../src/stalwart/client';
import { runGraceSweepOnce } from '../src/jobs/billing-grace-sweep.job';

let mongoServer: MongoMemoryServer;

describe('billing-grace-sweep.job', () => {
  let tenantId: string;
  let planId: string;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri(), autoIndex: true });
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await TenantModel.deleteMany({});
    await DomainModel.deleteMany({});
    await PlanModel.deleteMany({});
    await DomainSubscriptionModel.deleteMany({});

    const tenant = await TenantModel.create({ name: 'Acme', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantId = tenant._id.toString();
    const plan = await PlanModel.create({ name: 'Team', seatCount: 10, displayOrder: 1, isActive: true });
    planId = plan._id.toString();

    vi.spyOn(stalwartClient, 'updateDomainStatus').mockResolvedValue();
    vi.spyOn(stalwartClient, 'updateAccountStatus').mockResolvedValue();
  });

  it('suspends a domain whose grace period has expired', async () => {
    const domain = await DomainModel.create({ tenantId, domainName: 'expired.com', status: 'active' });
    const sub = await DomainSubscriptionModel.create({
      domainId: domain._id,
      tenantId,
      planId,
      stripeSubscriptionId: 'sub_x',
      stripeSubscriptionItemId: 'si_x',
      status: 'grace',
      gracePeriodEndsAt: new Date(Date.now() - 60 * 1000), // 1 minute ago
    });

    const result = await runGraceSweepOnce();

    expect(result.suspended).toBe(1);
    expect((await DomainModel.findById(domain._id))?.status).toBe('suspended');
    expect((await DomainSubscriptionModel.findById(sub._id))?.status).toBe('suspended');
  });

  it('leaves a domain alone whose grace period has not yet expired', async () => {
    const domain = await DomainModel.create({ tenantId, domainName: 'still-in-grace.com', status: 'active' });
    await DomainSubscriptionModel.create({
      domainId: domain._id,
      tenantId,
      planId,
      stripeSubscriptionId: 'sub_y',
      stripeSubscriptionItemId: 'si_y',
      status: 'grace',
      gracePeriodEndsAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000), // 6 days out
    });

    const result = await runGraceSweepOnce();

    expect(result.suspended).toBe(0);
    expect((await DomainModel.findById(domain._id))?.status).toBe('active');
  });

  it('ignores subscriptions in any status other than grace', async () => {
    const domain = await DomainModel.create({ tenantId, domainName: 'trialing.com', status: 'active' });
    await DomainSubscriptionModel.create({
      domainId: domain._id,
      tenantId,
      planId,
      stripeSubscriptionId: 'sub_z',
      stripeSubscriptionItemId: 'si_z',
      status: 'trialing',
      gracePeriodEndsAt: new Date(Date.now() - 60 * 1000),
    });

    const result = await runGraceSweepOnce();
    expect(result.suspended).toBe(0);
  });

  it('skips a concurrent sweep if one is already in progress (re-entrancy guard)', async () => {
    const domain = await DomainModel.create({ tenantId, domainName: 'busy.com', status: 'active' });
    await DomainSubscriptionModel.create({
      domainId: domain._id,
      tenantId,
      planId,
      stripeSubscriptionId: 'sub_busy',
      stripeSubscriptionItemId: 'si_busy',
      status: 'grace',
      gracePeriodEndsAt: new Date(Date.now() - 60 * 1000),
    });

    vi.spyOn(stalwartClient, 'updateDomainStatus').mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 50)) as any
    );

    const [first, second] = await Promise.all([runGraceSweepOnce(), runGraceSweepOnce()]);
    const suspendedCounts = [first.suspended, second.suspended].sort();
    expect(suspendedCounts).toEqual([0, 1]);
  });
});
