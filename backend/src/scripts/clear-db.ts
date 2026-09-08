import mongoose from 'mongoose';
import { config } from '../config';
import { connectDatabase, disconnectDatabase } from '../db/connection';
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
} from '../db/models';
import { runMigrations } from '../db/migrate';
import { seedAll } from '../db/seed';
import { stalwartClient } from '../stalwart/client';

// Domains and accounts that must NEVER be deleted from Stalwart
const PRESERVED_STALWART_DOMAINS = new Set(['example.org', 'toowix.test']);
const PRESERVED_STALWART_ACCOUNTS = new Set(['admin', 'toowix-service']);

async function clearDatabase() {
  console.log('====================================================');
  console.log('  Toowix Mail Platform — Database Clear & Reset');
  console.log('====================================================\n');

  console.log('[1/5] Connecting to MongoDB:', config.mongodbUri);
  await connectDatabase({ uri: config.mongodbUri, autoIndex: true });
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Database connection instance not available.');
  }

  // Count documents before clearing
  console.log('\n[2/5] Current database snapshot before wipe:');
  const collections = [
    { name: 'tenants', model: TenantModel },
    { name: 'domains', model: DomainModel },
    { name: 'mailboxes', model: MailboxModel },
    { name: 'admin_users', model: AdminUserModel },
    { name: 'registration_applications', model: RegistrationApplicationModel },
    { name: 'activation_tokens', model: ActivationTokenModel },
    { name: 'audit_logs', model: AuditLogModel },
    { name: 'backup_records', model: BackupRecordModel },
    { name: 'system_settings', model: SystemSettingsModel },
  ];

  for (const col of collections) {
    const count = await col.model.countDocuments();
    console.log(`  • ${col.name}: ${count} documents`);
  }

  // Clear all collections
  console.log('\n[3/5] Purging all documents from all collections...');
  for (const col of collections) {
    const res = await (col.model as any).deleteMany({});
    console.log(`  ✓ Cleared ${col.name} (${res.deletedCount} deleted)`);
  }

  // Clean test domains and accounts from Stalwart
  console.log('\n[4/5] Synchronizing Stalwart mail server...');
  try {
    const liveAccounts = await stalwartClient.listAccounts();
    console.log(`  Found ${liveAccounts.length} accounts in Stalwart:`);
    for (const a of liveAccounts) {
      const accountName = (a.name || a.id || '').toLowerCase();
      if (PRESERVED_STALWART_ACCOUNTS.has(accountName)) {
        console.log(`   - Preserving system account: ${accountName}`);
      } else {
        try {
          await stalwartClient.deleteAccount(a.id);
          console.log(`   ✓ Deleted test account: ${accountName} (${a.id})`);
        } catch (err: any) {
          console.warn(`   ! Could not delete account ${accountName}: ${err.message}`);
        }
      }
    }

    const liveDomains = await stalwartClient.listDomains();
    console.log(`  Found ${liveDomains.length} domains in Stalwart:`);
    for (const d of liveDomains) {
      if (PRESERVED_STALWART_DOMAINS.has(d.name.toLowerCase())) {
        console.log(`   - Preserving system domain: ${d.name}`);
      } else {
        try {
          await stalwartClient.deleteDomain(d.id);
          console.log(`   ✓ Deleted test domain: ${d.name} (${d.id})`);
        } catch (err: any) {
          console.warn(`   ! Could not delete domain ${d.name}: ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    console.warn('  ! Stalwart connection skipped (offline or unreachable):', err.message);
  }

  // Re-build indexes & re-seed defaults
  console.log('\n[5/5] Re-indexing collections and seeding initial admin...');
  await runMigrations();
  await seedAll();

  // Create initial audit log entry
  await AuditLogModel.create({
    actorRole: 'SYSTEM',
    actorEmail: 'system@toowix.com',
    action: 'SYSTEM_DATABASE_CLEARED_AND_INITIALIZED',
    resource: 'DATABASE',
    status: 'SUCCESS',
    metadata: {
      timestamp: new Date().toISOString(),
      superAdminEmail: process.env.INITIAL_ADMIN_EMAIL || 'admin@toowix.com',
    },
    timestamp: new Date(),
  });

  // Final verification
  console.log('\n====================================================');
  console.log('  Verification Post-Reset Snapshot:');
  console.log('====================================================');
  for (const col of collections) {
    const count = await col.model.countDocuments();
    console.log(`  • ${col.name}: ${count} document(s)`);
  }

  const superAdmin = await AdminUserModel.findOne({ role: 'SUPER_ADMIN' });
  console.log('\nSuper Admin Account:');
  console.log(`  Email:    ${superAdmin?.email}`);
  console.log(`  Role:     ${superAdmin?.role}`);
  console.log(`  Status:   ${superAdmin?.status}`);
  console.log(`  2FA:      ${superAdmin?.twoFactorEnabled ? 'Enabled' : 'Disabled (clean first-login)'}`);
  console.log('====================================================\n');
  console.log('✓ Database successfully cleared, normalized, and re-initialized!\n');
}

clearDatabase()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Fatal error during clearDatabase:', err);
    await disconnectDatabase();
    process.exit(1);
  });
