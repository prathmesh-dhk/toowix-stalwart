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
    'drops a pre-existing compound {domainId, tenantId} unique index so the single-field unique ' +
      'domainId index (one subscription per domain) is enforced again — reproduces the E11000 a live ' +
      'deployment hits after the compound index was removed, until this migration runs',
    async () => {
      // Simulate a database that predates this schema change: the collection already has the OLD
      // compound unique index on {domainId, tenantId}, created before this feature was removed.
      const rawClient = new mongoose.mongo.MongoClient(mongoServer.getUri());
      await rawClient.connect();
      const rawDb = rawClient.db();
      await rawDb
        .collection('domain_subscriptions')
        .createIndex({ domainId: 1, tenantId: 1 }, { unique: true, name: 'domainId_1_tenantId_1' });
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

      // Before the migration, a second row for the same domainId under a DIFFERENT tenant would
      // have been allowed by the stale compound index. It must be rejected now.
      await expect(
        DomainSubscriptionModel.create({
          domainId,
          tenantId: tenantBId,
          planId: new mongoose.Types.ObjectId(),
          stripeSubscriptionId: 'sub_b',
          stripeSubscriptionItemId: 'si_b',
          status: 'active',
        })
      ).rejects.toMatchObject({ code: 11000 });
    }
  );
});
