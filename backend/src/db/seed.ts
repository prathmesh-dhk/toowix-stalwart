import argon2 from 'argon2';
import { config } from '../config';
import { connectDatabase, disconnectDatabase } from './connection';
import { AdminUserModel } from './models/AdminUser';
import { SystemSettingsModel } from './models/SystemSettings';
import { AuditLogModel } from './models/AuditLog';
import { PlanModel } from './models/Plan';

export async function seedInitialAdmin(): Promise<void> {
  try {
    const existingAdmin = await AdminUserModel.findOne({ role: 'SUPER_ADMIN' });

    if (!existingAdmin) {
      const email = (process.env.INITIAL_ADMIN_EMAIL || 'admin@toowix.com').toLowerCase().trim();
      const password = process.env.INITIAL_ADMIN_PASSWORD || 'PlatformAdmin2026!';
      const passwordHash = await argon2.hash(password);

      const admin = await AdminUserModel.create({
        email,
        name: 'Platform Super Admin',
        passwordHash,
        role: 'SUPER_ADMIN',
        tenantId: null,
        status: 'active',
        twoFactorEnabled: false,
      });

      console.log('[Seed] Created default Super Admin:', { id: admin._id, email: admin.email });
    } else {
      console.log('[Seed] Super Admin already exists:', existingAdmin.email);
    }
  } catch (err) {
    console.error('[Seed Error]:', err);
    throw err;
  }
}

export async function seedSystemSettings(): Promise<void> {
  try {
    const existing = await SystemSettingsModel.findOne({ key: 'alerts_config' });
    if (!existing) {
      await SystemSettingsModel.create({
        key: 'alerts_config',
        webhookUrl: process.env.ALERT_WEBHOOK_URL || '',
        alertEmail: process.env.ALERT_EMAIL || '',
        alertsEnabled: Boolean(process.env.ALERT_WEBHOOK_URL),
        consecutiveFailureThreshold: 3,
        updatedBy: 'system_seed',
      });
      console.log('[Seed] Initialized default SystemSettings (alerts_config)');
    } else {
      console.log('[Seed] SystemSettings (alerts_config) already exists');
    }

    const mailLimits = await SystemSettingsModel.findOne({ key: 'mail_limits' });
    if (!mailLimits) {
      await SystemSettingsModel.create({
        key: 'mail_limits',
        attachmentSizeMb: 5,
        messageSizeMb: 6,
        maxMailboxDepth: 10,
        maxMailboxNameLength: 255,
        updatedBy: 'system_seed',
      });
      console.log('[Seed] Initialized default SystemSettings (mail_limits)');
    } else {
      console.log('[Seed] SystemSettings (mail_limits) already exists');
    }
  } catch (err) {
    console.error('[Seed SystemSettings Error]:', err);
    throw err;
  }
}

export async function seedDefaultPlans(): Promise<void> {
  try {
    const existingCount = await PlanModel.countDocuments();
    if (existingCount > 0) {
      console.log('[Seed] Plans already exist, skipping default seed.');
      return;
    }

    // Mirrors the tier values every seat picker across the app used to
    // hardcode independently. The 50-seat plan is flagged default to match
    // today's self-registration/application-approval behavior exactly.
    await PlanModel.insertMany([
      { name: 'Individual', badge: 'Solo', seatCount: 1, displayOrder: 1, isActive: true, isDefault: false },
      { name: 'Team', badge: 'Standard', seatCount: 10, displayOrder: 2, isActive: true, isDefault: false },
      { name: 'Growth', badge: 'Growth', seatCount: 25, displayOrder: 3, isActive: true, isDefault: false },
      { name: 'Business', badge: 'Business', seatCount: 50, displayOrder: 4, isActive: true, isDefault: true },
      { name: 'Scale', badge: 'Scale', seatCount: 75, displayOrder: 5, isActive: true, isDefault: false },
      { name: 'Enterprise', badge: 'Enterprise', seatCount: 100, displayOrder: 6, isActive: true, isDefault: false },
    ]);
    console.log('[Seed] Initialized default Plans (Individual..Enterprise)');
  } catch (err) {
    console.error('[Seed Plans Error]:', err);
    throw err;
  }
}

export async function seedAll(): Promise<void> {
  console.log('[Seed] Seeding database defaults...');
  await seedInitialAdmin();
  await seedSystemSettings();
  await seedDefaultPlans();
  console.log('[Seed] Database defaults seeded successfully.');
}

if (require.main === module) {
  (async () => {
    try {
      await connectDatabase({ uri: config.mongodbUri, autoIndex: true });
      await seedAll();
      await disconnectDatabase();
      process.exit(0);
    } catch (err) {
      console.error('[Seed Fatal]:', err);
      await disconnectDatabase();
      process.exit(1);
    }
  })();
}
