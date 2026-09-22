import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import {
  TenantModel,
  DomainModel,
  MailboxModel,
  DomainSubscriptionModel,
  PlanModel,
} from '../src/db/models';
import { stalwartClient } from '../src/stalwart/client';
import { MailboxService } from '../src/services/mailbox.service';
import { seedPlatformIdentityDomain } from '../src/db/seed';
import { config } from '../src/config';

let mongoServer: MongoMemoryServer;

describe('MailboxService.createSharedDomainMailbox — mailboxes on the shared dhkmail domain', () => {
  let sharedDomainId: string;
  let tenantAId: string;
  let tenantBId: string;

  /** Gives a tenant an active subscription against the shared domain, with the given seat cap. */
  const subscribe = (tenantId: string, mailboxLimit: number, overrides: Record<string, unknown> = {}) =>
    DomainSubscriptionModel.create({
      domainId: sharedDomainId,
      tenantId,
      planId: new mongoose.Types.ObjectId(),
      stripeSubscriptionId: `sub_${tenantId}`,
      stripeSubscriptionItemId: `si_${tenantId}`,
      status: 'active',
      mailboxLimit,
      mailboxCount: 0,
      ...overrides,
    });

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
    await Promise.all(
      [TenantModel, DomainModel, MailboxModel, DomainSubscriptionModel, PlanModel].map((m) => m.deleteMany({}))
    );

    vi.spyOn(stalwartClient, 'listDomains').mockResolvedValue([{ id: 'stalwart-dhkmail', name: config.platformMailDomain }]);
    vi.spyOn(stalwartClient, 'createDomain').mockResolvedValue({ id: 'stalwart-dhkmail', name: config.platformMailDomain });
    vi.spyOn(stalwartClient, 'createAccount').mockResolvedValue({ id: 'stalwart-acc-x', name: 'x' } as any);
    vi.spyOn(stalwartClient, 'deleteAccount').mockResolvedValue();

    await seedPlatformIdentityDomain();
    const sharedDomain = await DomainModel.findOne({ domainName: config.platformMailDomain });
    sharedDomainId = sharedDomain!._id.toString();

    const tenantA = await TenantModel.create({ name: 'Acme Corp', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantAId = tenantA._id.toString();
    const tenantB = await TenantModel.create({ name: 'Rival Inc', status: 'active', mailboxLimit: 50, mailboxCount: 0 });
    tenantBId = tenantB._id.toString();
  });

  it("creates a mailbox owned by the calling tenant, filed under the platform tenant's domain", async () => {
    await subscribe(tenantAId, 5);

    const result = await MailboxService.createSharedDomainMailbox(tenantAId, 'sales', 'Password123!');

    expect(result.address).toBe(`sales@${config.platformMailDomain}`);
    expect(result.stalwartAccountId).toBe('stalwart-acc-x');

    const mailbox = await MailboxModel.findOne({ address: result.address });
    expect(mailbox).not.toBeNull();
    expect(mailbox!.ownerTenantId!.toString()).toBe(tenantAId);
    expect(mailbox!.domainId.toString()).toBe(sharedDomainId);
    // Filed under the platform tenant (the Domain's real owner), never the calling tenant —
    // that's what keeps {tenantId, localPart} globally unique instead of colliding per caller.
    const sharedDomain = await DomainModel.findById(sharedDomainId);
    expect(mailbox!.tenantId.toString()).toBe(sharedDomain!.tenantId.toString());
    expect(mailbox!.tenantId.toString()).not.toBe(tenantAId);

    // Never touches the tenant's own (unrelated) mailbox quota — that's for their own domains.
    expect((await TenantModel.findById(tenantAId))!.mailboxCount).toBe(0);
  });

  it("refuses when the tenant has never subscribed to the shared domain", async () => {
    await expect(MailboxService.createSharedDomainMailbox(tenantAId, 'sales', 'Password123!')).rejects.toMatchObject({
      status: 402,
    });
    expect(await MailboxModel.countDocuments({})).toBe(0);
  });

  it.each(['canceled', 'suspended', 'incomplete'])('refuses when the subscription status is %s', async (status) => {
    await subscribe(tenantAId, 5, { status });
    await expect(MailboxService.createSharedDomainMailbox(tenantAId, 'sales', 'Password123!')).rejects.toMatchObject({
      status: 402,
    });
  });

  it("enforces THIS tenant's own seat cap, not the shared Domain document's", async () => {
    await subscribe(tenantAId, 1);
    await MailboxService.createSharedDomainMailbox(tenantAId, 'first', 'Password123!');

    await expect(MailboxService.createSharedDomainMailbox(tenantAId, 'second', 'Password123!')).rejects.toMatchObject({
      status: 409,
      code: 'DOMAIN_QUOTA_EXCEEDED',
    });

    const sub = await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId: tenantAId });
    expect(sub!.mailboxCount).toBe(1);
  });

  it("two tenants' seat caps are independent — one being full doesn't block the other", async () => {
    await subscribe(tenantAId, 1);
    await subscribe(tenantBId, 5);

    await MailboxService.createSharedDomainMailbox(tenantAId, 'owner', 'Password123!');
    await expect(MailboxService.createSharedDomainMailbox(tenantAId, 'second', 'Password123!')).rejects.toMatchObject({
      status: 409,
    });

    // Tenant B is nowhere near their own cap — must not be affected by A's.
    await expect(MailboxService.createSharedDomainMailbox(tenantBId, 'welcome', 'Password123!')).resolves.toMatchObject({
      address: `welcome@${config.platformMailDomain}`,
    });
  });

  it('mailbox names are unique across every tenant on the shared domain, not just within one', async () => {
    await subscribe(tenantAId, 5);
    await subscribe(tenantBId, 5);

    await MailboxService.createSharedDomainMailbox(tenantAId, 'support', 'Password123!');

    await expect(MailboxService.createSharedDomainMailbox(tenantBId, 'support', 'Password123!')).rejects.toMatchObject({
      status: 409,
      code: 'USERNAME_TAKEN',
    });

    // Tenant A's seat wasn't consumed twice, and tenant B's attempt didn't eat a seat either.
    expect((await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId: tenantAId }))!.mailboxCount).toBe(1);
    expect((await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId: tenantBId }))!.mailboxCount).toBe(0);
  });

  it('rolls back the seat reservation when Stalwart provisioning fails', async () => {
    await subscribe(tenantAId, 5);
    vi.spyOn(stalwartClient, 'createAccount').mockRejectedValue(new Error('mail server unreachable'));

    await expect(MailboxService.createSharedDomainMailbox(tenantAId, 'broken', 'Password123!')).rejects.toMatchObject({
      status: 503,
    });

    expect(await MailboxModel.countDocuments({})).toBe(0);
    expect((await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId: tenantAId }))!.mailboxCount).toBe(0);
  });

  it('maps a weak-password rejection from Stalwart to 400, rolling back the reservation', async () => {
    await subscribe(tenantAId, 5);
    vi.spyOn(stalwartClient, 'createAccount').mockRejectedValue(new Error('password is too weak'));

    await expect(MailboxService.createSharedDomainMailbox(tenantAId, 'weak', 'weakweak')).rejects.toMatchObject({
      status: 400,
      code: 'PASSWORD_TOO_WEAK',
    });
    expect((await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId: tenantAId }))!.mailboxCount).toBe(0);
  });

  it('reuses the cached Stalwart domain id instead of re-resolving it every time', async () => {
    await subscribe(tenantAId, 5);
    await MailboxService.createSharedDomainMailbox(tenantAId, 'one', 'Password123!');
    vi.mocked(stalwartClient.listDomains).mockClear();

    await MailboxService.createSharedDomainMailbox(tenantAId, 'two', 'Password123!');
    expect(stalwartClient.listDomains).not.toHaveBeenCalled();
  });

  describe('shared-domain mailboxes through the ordinary list/get/delete paths', () => {
    it('listMailboxes surfaces a shared-domain mailbox under the calling tenant, not the platform tenant', async () => {
      await subscribe(tenantAId, 5);
      const created = await MailboxService.createSharedDomainMailbox(tenantAId, 'sales', 'Password123!');

      const list = await MailboxService.listMailboxes(tenantAId);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(created.id);
      expect(list[0].tenantId).toBe(tenantAId);
      expect(list[0].ownerTenantId).toBe(tenantAId);

      // Never leaks into another (real) tenant's list.
      expect(await MailboxService.listMailboxes(tenantBId)).toHaveLength(0);
    });

    it('getMailboxById resolves a shared-domain mailbox for its owning tenant', async () => {
      await subscribe(tenantAId, 5);
      const created = await MailboxService.createSharedDomainMailbox(tenantAId, 'sales', 'Password123!');

      const found = await MailboxService.getMailboxById(created.id, tenantAId);
      expect(found).not.toBeNull();
      expect(found!.tenantId).toBe(tenantAId);

      // Another tenant can't reach it by id, even though the raw row is filed under the platform tenant.
      expect(await MailboxService.getMailboxById(created.id, tenantBId)).toBeNull();
    });

    it('deleteMailbox releases the seat on DomainSubscription, not on Tenant.mailboxCount', async () => {
      await subscribe(tenantAId, 1);
      const created = await MailboxService.createSharedDomainMailbox(tenantAId, 'sales', 'Password123!');

      expect((await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId: tenantAId }))!.mailboxCount).toBe(1);

      await MailboxService.deleteMailbox(created.id, tenantAId);

      expect(await MailboxModel.findById(created.id)).toBeNull();
      expect((await DomainSubscriptionModel.findOne({ domainId: sharedDomainId, tenantId: tenantAId }))!.mailboxCount).toBe(0);
      // The tenant's own (unrelated) mailbox quota must stay untouched.
      expect((await TenantModel.findById(tenantAId))!.mailboxCount).toBe(0);

      // Seat freed — another mailbox (even a different tenant's) can claim the same local part now.
      await subscribe(tenantBId, 5);
      await expect(MailboxService.createSharedDomainMailbox(tenantBId, 'sales', 'Password123!')).resolves.toMatchObject({
        address: `sales@${config.platformMailDomain}`,
      });
    });
  });
});
