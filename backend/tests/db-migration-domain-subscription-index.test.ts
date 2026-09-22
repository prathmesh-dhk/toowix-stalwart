import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/db/connection';
import { DomainSubscriptionModel } from '../src/db/models';

let mongoServer: MongoMemoryServer;

describe('DomainSubscription stale-index migration', () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
  });

  afterAll(async () => {
    await disconnectDatabase();
    await mongoServer.stop();
  });

  it(
    "drops a pre-existing single-field unique domainId index so multiple tenants can subscribe to the same (shared) domain — " +
      'reproduces the E11000 a live deployment hits after the compound-index schema change until this migration runs',
    async () => {
      // Simulate a database that predates the compound-unique-index schema change: the collection
      // already has the OLD single-field unique index on domainId, created before this feature.
      const rawClient = new mongoose.mongo.MongoClient(mongoServer.getUri());
      await rawClient.connect();
      const rawDb = rawClient.db();
      await rawDb.collection('domain_subscriptions').createIndex({ domainId: 1 }, { unique: true, name: 'domainId_1' });
      await rawClient.close();

      // Now connect the normal way — this is what every server boot does, and must self-heal.
      await connectDatabase({ uri: mongoServer.getUri(), autoIndex: true });

      const domainId = new mongoose.Types.ObjectId();
      const tenantAId = new mongoose.Types.ObjectId();
      const tenantBId = new mongoose.Types.ObjectId();

      await DomainSubscriptionModel.create({
        domainId,
        tenantId: tenantAId,
        planId: new mongoose.Types.ObjectId(),
        stripeSubscriptionId: 'sub_a',
        stripeSubscriptionItemId: 'si_a',
        status: 'active',
      });

      // Before the migration, this second insert (same domainId, different tenant — exactly the
      // dhkmail multi-tenant scenario) would throw E11000 against the stale domainId_1 index.
      await expect(
        DomainSubscriptionModel.create({
          domainId,
          tenantId: tenantBId,
          planId: new mongoose.Types.ObjectId(),
          stripeSubscriptionId: 'sub_b',
          stripeSubscriptionItemId: 'si_b',
          status: 'active',
        })
      ).resolves.toMatchObject({ domainId, tenantId: tenantBId });

      // The compound uniqueness is still enforced: the SAME tenant can't hold two rows for the
      // same domain.
      await expect(
        DomainSubscriptionModel.create({
          domainId,
          tenantId: tenantAId,
          planId: new mongoose.Types.ObjectId(),
          stripeSubscriptionId: 'sub_a2',
          stripeSubscriptionItemId: 'si_a2',
          status: 'active',
        })
      ).rejects.toMatchObject({ code: 11000 });
    }
  );
});
