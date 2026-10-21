import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel, PlanModel } from '../src/db/models';
import { config } from '../src/config';

// Fake Stripe that honours idempotency keys the way the real API does: same key, same customer.
const created = new Map<string, { id: string }>();
let seq = 0;
const customersCreate = vi.fn(async (_params: unknown, opts?: { idempotencyKey?: string }) => {
  const key = opts?.idempotencyKey;
  if (key && created.has(key)) return created.get(key)!;
  const customer = { id: `cus_${++seq}` };
  if (key) created.set(key, customer);
  return customer;
});
const productsCreate = vi.fn(async (params: any) => ({ id: `prod_${++seq}`, ...params }));
const subscriptionItemsCreate = vi.fn(async (params: any) => ({ id: `si_${++seq}`, ...params }));
const subscriptionItemsUpdate = vi.fn(async (id: string, params: any) => ({ id, ...params }));
const subscriptionsUpdate = vi.fn(async (id: string, params: any) => ({ id, ...params }));
const pricesCreate = vi.fn(async (params: any) => ({ id: `price_${++seq}`, ...params }));
const subscriptionSchedulesCreate = vi.fn(async (params: any) => ({
  id: `sched_${++seq}`,
  phases: [{ start_date: 1000, end_date: 2000, items: [{ price: 'price_old', quantity: 2 }, { price: 'price_sibling', quantity: 1 }] }],
}));
const subscriptionSchedulesUpdate = vi.fn(async (id: string, params: any) => ({ id, ...params }));
const subscriptionSchedulesRelease = vi.fn(async (id: string) => ({ id }));
const liveItems = (extra: any[] = []) => ({
  data: [
    { id: 'si_old', price: { id: 'price_old' }, quantity: 2 },
    { id: 'si_sibling', price: { id: 'price_sibling' }, quantity: 1 },
    ...extra,
  ],
});
const subscriptionsRetrieve = vi.fn(async (id: string): Promise<any> => ({ id, schedule: null as string | null, items: liveItems() }));
const subscriptionSchedulesRetrieve = vi.fn(async (id: string) => ({
  id,
  current_phase: { start_date: 1000, end_date: 2000 },
  phases: [
    { start_date: 1000, end_date: 2000, items: [{ price: 'price_old', quantity: 2 }, { price: 'price_sibling', quantity: 1 }] },
    { start_date: 2000, end_date: 3000, items: [{ price: 'price_old_down', quantity: 2 }, { price: 'price_sibling', quantity: 1 }] },
  ],
}));

vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    customers: { create: customersCreate },
    products: { create: productsCreate },
    subscriptionItems: { create: subscriptionItemsCreate, update: subscriptionItemsUpdate },
    prices: { create: pricesCreate },
    subscriptionSchedules: {
      create: subscriptionSchedulesCreate,
      update: subscriptionSchedulesUpdate,
      retrieve: subscriptionSchedulesRetrieve,
      release: subscriptionSchedulesRelease,
    },
    subscriptions: { retrieve: subscriptionsRetrieve, update: subscriptionsUpdate },
  })),
}));

import { stripeClient } from '../src/stripe/client';

let mongoServer: MongoMemoryServer;
const original = { ...config.stripe };

describe('stripeClient.getOrCreateCustomer', () => {
  beforeAll(async () => {
    config.stripe.secretKey = 'sk_test_dummy';
    mongoServer = await MongoMemoryServer.create();
    await connectDatabase({ uri: mongoServer.getUri(), autoIndex: true });
  });

  afterAll(async () => {
    Object.assign(config.stripe, original);
    await disconnectDatabase();
    await mongoServer.stop();
  });

  it('a double-clicked checkout ends up with exactly one Stripe customer for the tenant', async () => {
    const tenant = await TenantModel.create({ name: 'Acme', status: 'active' });
    // Two requests, each holding its own copy of the tenant loaded before either saved.
    const [a, b] = await Promise.all([TenantModel.findById(tenant._id), TenantModel.findById(tenant._id)]);

    const [idA, idB] = await Promise.all([stripeClient.getOrCreateCustomer(a!), stripeClient.getOrCreateCustomer(b!)]);

    expect(idA).toBe(idB);
    expect((await TenantModel.findById(tenant._id))!.stripeCustomerId).toBe(idA);
  });

  it('addDomainSubscriptionItem creates product first then attaches subscription item with product.id', async () => {
    const item = await stripeClient.addDomainSubscriptionItem('sub_master_123', {
      name: 'Pro — second.com',
      unitAmountPaise: 9900,
      quantity: 2,
      domainId: 'dom_second_123',
      planId: 'plan_pro_123',
    });

    expect(productsCreate).toHaveBeenCalledWith({
      name: 'Pro — second.com',
      metadata: { domainId: 'dom_second_123', planId: 'plan_pro_123' },
    });
    expect(subscriptionItemsCreate).toHaveBeenCalledWith({
      subscription: 'sub_master_123',
      quantity: 2,
      proration_behavior: 'create_prorations',
      price_data: {
        currency: 'inr',
        unit_amount: 9900,
        recurring: { interval: 'month' },
        product: expect.stringMatching(/^prod_/),
      },
    });
    expect(item.id).toMatch(/^si_/);
  });

  it('setPendingPrices schedules only the pending item’s new price for the next period', async () => {
    await stripeClient.setPendingPrices('sub_shared_123', { si_sibling: 'price_starter_123' });

    expect(subscriptionSchedulesCreate).toHaveBeenCalledWith({ from_subscription: 'sub_shared_123' });
    expect(subscriptionSchedulesUpdate).toHaveBeenLastCalledWith(expect.stringMatching(/^sched_/), {
      phases: [
        { items: [{ price: 'price_old', quantity: 2 }, { price: 'price_sibling', quantity: 1 }], start_date: 1000, end_date: 2000 },
        { items: [{ price: 'price_old', quantity: 2 }, { price: 'price_starter_123', quantity: 1 }] },
      ],
    });
  });

  it('setPendingPrices rebuilds both phases from the live items, so a domain added or a quantity changed since survives', async () => {
    // The attached schedule copied the items when the downgrade was made; since then si_old went
    // to 5 users and a new domain joined.
    subscriptionsRetrieve.mockResolvedValueOnce({
      id: 'sub_shared_123',
      schedule: 'sched_existing',
      items: {
        data: [
          { id: 'si_old', price: { id: 'price_old_up' }, quantity: 5 },
          { id: 'si_sibling', price: { id: 'price_sibling' }, quantity: 1 },
          { id: 'si_new', price: { id: 'price_new' }, quantity: 3 },
        ],
      },
    });
    subscriptionSchedulesCreate.mockClear();

    await stripeClient.setPendingPrices('sub_shared_123', { si_sibling: 'price_sibling_down' });

    expect(subscriptionSchedulesCreate).not.toHaveBeenCalled();
    expect(subscriptionSchedulesUpdate).toHaveBeenLastCalledWith('sched_existing', {
      phases: [
        {
          items: [{ price: 'price_old_up', quantity: 5 }, { price: 'price_sibling', quantity: 1 }, { price: 'price_new', quantity: 3 }],
          start_date: 1000,
          end_date: 2000,
        },
        { items: [{ price: 'price_old_up', quantity: 5 }, { price: 'price_sibling_down', quantity: 1 }, { price: 'price_new', quantity: 3 }] },
      ],
    });
  });

  it('an upgrade charged now invoices the difference at once, and Stripe refuses the change if that payment fails', async () => {
    await stripeClient.updateSubscriptionItemPrice('sub_up', 'si_up', 'price_pro', 2, true);
    expect(subscriptionsUpdate).toHaveBeenLastCalledWith('sub_up', {
      items: [{ id: 'si_up', price: 'price_pro', quantity: 2 }],
      proration_behavior: 'always_invoice',
      payment_behavior: 'error_if_incomplete',
    });

    // During the Trial nothing is owed, so the difference isn't invoiced.
    await stripeClient.updateSubscriptionItemPrice('sub_up', 'si_up', 'price_pro', 2, false);
    expect(subscriptionsUpdate).toHaveBeenLastCalledWith('sub_up', {
      items: [{ id: 'si_up', price: 'price_pro', quantity: 2 }],
      proration_behavior: 'create_prorations',
    });
  });

  it('a quantity charged now invoices the remaining days at once; otherwise the proration waits for the next bill', async () => {
    await stripeClient.syncDomainUserQuantity('si_q', 3, true);
    expect(subscriptionItemsUpdate).toHaveBeenLastCalledWith('si_q', { quantity: 3, proration_behavior: 'always_invoice' });

    await stripeClient.syncDomainUserQuantity('si_q', 2);
    expect(subscriptionItemsUpdate).toHaveBeenLastCalledWith('si_q', { quantity: 2, proration_behavior: 'create_prorations' });
  });

  it('setPendingPrices keeps a running Trial in the current phase, so a downgrade during the Trial does not end it', async () => {
    subscriptionsRetrieve.mockResolvedValueOnce({ id: 'sub_shared_123', schedule: null, status: 'trialing', trial_end: 2000, items: liveItems() });

    await stripeClient.setPendingPrices('sub_shared_123', { si_old: 'price_old_down' });

    expect(subscriptionSchedulesUpdate).toHaveBeenLastCalledWith(expect.stringMatching(/^sched_/), {
      phases: [
        { items: [{ price: 'price_old', quantity: 2 }, { price: 'price_sibling', quantity: 1 }], start_date: 1000, end_date: 2000, trial_end: 2000 },
        { items: [{ price: 'price_old_down', quantity: 2 }, { price: 'price_sibling', quantity: 1 }] },
      ],
    });
  });

  it('setPendingPrices leaves a schedule that is already in step alone', async () => {
    subscriptionsRetrieve.mockResolvedValueOnce({ id: 'sub_shared_123', schedule: 'sched_existing', items: liveItems() });
    subscriptionSchedulesUpdate.mockClear();

    // The fake schedule's next phase already holds si_old's downgrade to price_old_down.
    await stripeClient.setPendingPrices('sub_shared_123', { si_old: 'price_old_down' });

    expect(subscriptionSchedulesUpdate).not.toHaveBeenCalled();
  });

  it('setPendingPrices releases the schedule once nothing is pending, and does nothing without one', async () => {
    subscriptionsRetrieve.mockResolvedValueOnce({ id: 'sub_shared_123', schedule: 'sched_existing', items: liveItems() });
    subscriptionSchedulesUpdate.mockClear();
    subscriptionSchedulesCreate.mockClear();

    // A pending price the item already has (its phase started) is no longer pending.
    await stripeClient.setPendingPrices('sub_shared_123', { si_old: 'price_old' });
    expect(subscriptionSchedulesRelease).toHaveBeenCalledWith('sched_existing');

    subscriptionSchedulesRelease.mockClear();
    await stripeClient.setPendingPrices('sub_shared_123', {});
    expect(subscriptionSchedulesRelease).not.toHaveBeenCalled();
    expect(subscriptionSchedulesCreate).not.toHaveBeenCalled();
    expect(subscriptionSchedulesUpdate).not.toHaveBeenCalled();
  });
});
