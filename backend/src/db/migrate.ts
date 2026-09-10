import { config } from '../config';
import { connectDatabase, disconnectDatabase } from './connection';
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
  AdminSessionModel,
} from './models';

export async function runMigrations(): Promise<void> {
  console.log('[Migration] Starting database migration & index synchronization...');
  await connectDatabase({ uri: config.mongodbUri, autoIndex: true });

  const models = [
    { name: 'Tenant', model: TenantModel },
    { name: 'Domain', model: DomainModel },
    { name: 'AdminUser', model: AdminUserModel },
    { name: 'Mailbox', model: MailboxModel },
    { name: 'RegistrationApplication', model: RegistrationApplicationModel },
    { name: 'ActivationToken', model: ActivationTokenModel },
    { name: 'AuditLog', model: AuditLogModel },
    { name: 'BackupRecord', model: BackupRecordModel },
    { name: 'SystemSettings', model: SystemSettingsModel },
    { name: 'AdminSession', model: AdminSessionModel },
  ];

  for (const item of models) {
    try {
      await item.model.createIndexes();
      console.log(`[Migration] ✓ Indexes verified for ${item.name}`);
    } catch (err: any) {
      console.error(`[Migration] ✗ Failed to sync indexes for ${item.name}:`, err.message);
      throw err;
    }
  }

  console.log('[Migration] All 10 database models & indexes synchronized successfully.');
}

if (require.main === module) {
  runMigrations()
    .then(async () => {
      await disconnectDatabase();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('[Migration Fatal]:', err);
      await disconnectDatabase();
      process.exit(1);
    });
}
