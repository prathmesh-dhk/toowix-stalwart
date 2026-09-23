import mongoose from 'mongoose';
import {
  TenantModel,
  DomainModel,
  AdminUserModel,
  MailboxModel,
  ActivationTokenModel,
  AuditLogModel,
  BackupRecordModel,
  SystemSettingsModel,
  AdminSessionModel,
  DomainSubscriptionModel,
} from './models';

/**
 * Drops any index on `domain_subscriptions` involving `domainId` that doesn't match the current
 * schema's single-field unique index on `domainId` — covers both the old compound
 * `{domainId: 1, tenantId: 1}` unique index (a leftover from a since-removed feature that let many
 * tenants hold a row against the same domainId) and a plain non-unique `{domainId: 1}` index (from
 * an even earlier schema revision, before domainId was unique at all). Mongoose's createIndexes()
 * only ADDS indexes missing from the current schema; it never drops or upgrades ones that predate
 * a schema change — including a same-named index with the wrong `unique` flag, which it refuses to
 * recreate over (IndexKeySpecsConflict). Idempotent and self-healing: a no-op once the index
 * already matches, safe to run on every boot.
 */
async function dropStaleDomainSubscriptionIndex(): Promise<void> {
  try {
    const indexes = await DomainSubscriptionModel.collection.indexes();
    const stale = indexes.find((idx) => {
      const keys = Object.keys(idx.key);
      if (keys.length === 1 && idx.key.domainId === 1) return !idx.unique;
      return keys.length === 2 && idx.key.domainId === 1 && idx.key.tenantId === 1;
    });
    if (stale?.name) {
      await DomainSubscriptionModel.collection.dropIndex(stale.name);
      console.log(`[DB Migration] Dropped stale index '${stale.name}' on domain_subscriptions`);
    }
  } catch (err: any) {
    // Collection may not exist yet on a fresh database — nothing to migrate.
    if (err?.codeName !== 'NamespaceNotFound') {
      console.warn('[DB Migration] Failed to check/drop stale domain_subscriptions index:', err.message);
    }
  }
}

export interface DbConnectionOptions {
  uri: string;
  autoIndex?: boolean;
}

let isConnected = false;

export async function connectDatabase(options: DbConnectionOptions): Promise<typeof mongoose> {
  const { uri, autoIndex = true } = options;

  if (isConnected && mongoose.connection.readyState === 1) {
    return mongoose;
  }

  try {
    mongoose.set('strictQuery', true);
    
    const instance = await mongoose.connect(uri, {
      autoIndex,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    isConnected = true;

    // Ensure all compound unique indexes are built
    if (autoIndex) {
      await dropStaleDomainSubscriptionIndex();
      await Promise.all([
        TenantModel.createIndexes(),
        DomainModel.createIndexes(),
        AdminUserModel.createIndexes(),
        MailboxModel.createIndexes(),
        ActivationTokenModel.createIndexes(),
        AuditLogModel.createIndexes(),
        BackupRecordModel.createIndexes(),
        SystemSettingsModel.createIndexes(),
        AdminSessionModel.createIndexes(),
        DomainSubscriptionModel.createIndexes(),
      ]);
    }

    mongoose.connection.on('error', (err) => {
      console.error('[MongoDB Error]:', err);
    });

    mongoose.connection.on('disconnected', () => {
      isConnected = false;
      console.warn('[MongoDB Disconnected]');
    });

    return instance;
  } catch (err) {
    isConnected = false;
    console.error('[MongoDB Connection Failed]:', err);
    throw err;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    isConnected = false;
  }
}

export function isDatabaseConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function checkDatabaseHealth(): Promise<{ status: 'healthy' | 'unhealthy'; pingMs?: number; error?: string }> {
  try {
    if (!isDatabaseConnected() || !mongoose.connection.db) {
      return { status: 'unhealthy', error: 'Database not connected' };
    }

    const start = Date.now();
    await mongoose.connection.db.admin().ping();
    const pingMs = Date.now() - start;

    return { status: 'healthy', pingMs };
  } catch (err: any) {
    return { status: 'unhealthy', error: err?.message || 'Database ping failed' };
  }
}
