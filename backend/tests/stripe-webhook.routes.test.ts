import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import Stripe from 'stripe';
import { app } from '../src/app';
import { config } from '../src/config';

// Real Stripe signature verification, offline: signed with a throwaway secret, not the .env one.
const SECRET = 'whsec_test_secret';
const original = { ...config.stripe };

describe('POST /api/webhooks/stripe signature checks', () => {
  beforeAll(() => {
    config.stripe.secretKey = 'sk_test_dummy';
    config.stripe.webhookSecret = SECRET;
  });

  afterAll(() => {
    Object.assign(config.stripe, original);
  });

  const payload = JSON.stringify({ id: 'evt_test', object: 'event', type: 'ping' });

  it('rejects a request with no signature', async () => {
    const res = await request(app).post('/api/webhooks/stripe').set('Content-Type', 'application/json').send(payload);
    expect(res.status).toBe(400);
  });

  it('rejects a request signed with the wrong secret', async () => {
    const forged = Stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_attacker' });
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', forged)
      .send(payload);
    expect(res.status).toBe(400);
  });
});
