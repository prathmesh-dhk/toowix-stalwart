import mongoose from 'mongoose';
import {
  TenantModel,
  DomainModel,
  AdminUserModel,
  MailboxModel,
  RegistrationApplicationModel,
  ActivationTokenModel,
  AuditLogModel,
  BackupRecordModel,
  SystemSettingsModel,
} from './models';

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
      await Promise.all([
        TenantModel.createIndexes(),
        DomainModel.createIndexes(),
        AdminUserModel.createIndexes(),
        MailboxModel.createIndexes(),
        RegistrationApplicationModel.createIndexes(),
        ActivationTokenModel.createIndexes(),
        AuditLogModel.createIndexes(),
        BackupRecordModel.createIndexes(),
        SystemSettingsModel.createIndexes(),
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
