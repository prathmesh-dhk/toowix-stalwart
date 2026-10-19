import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { TenantModel } from '../src/db/models';
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

vi.mock('stripe', () => ({
  default: vi.fn(() => ({
    customers: { create: customersCreate },
    products: { create: productsCreate },
    subscriptionItems: { create: subscriptionItemsCreate },
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
});
