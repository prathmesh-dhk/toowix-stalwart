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

// The confirmed billing design (grill-me interview) is exactly 1/10/25/100
// seat fixed tiers plus one pay-as-you-go Custom plan — not the wider
// 1/10/25/50/75/100 set an earlier, pre-billing session originally seeded.
// Upserted by name (not a single "only if collection is empty" guard) so
// this corrects an already-seeded dev/staging database on the next boot
// instead of silently no-op'ing forever once anything exists.
const DEFAULT_PLANS = [
  { name: 'Individual', badge: 'Solo', seatCount: 1, displayOrder: 1, isDefault: false, billingMode: 'fixed' as const },
  { name: 'Team', badge: 'Standard', seatCount: 10, displayOrder: 2, isDefault: true, billingMode: 'fixed' as const },
  { name: 'Growth', badge: 'Growth', seatCount: 25, displayOrder: 3, isDefault: false, billingMode: 'fixed' as const },
  { name: 'Enterprise', badge: 'Enterprise', seatCount: 100, displayOrder: 4, isDefault: false, billingMode: 'fixed' as const },
  { name: 'Custom', badge: 'Pay as you go', seatCount: 99999, displayOrder: 5, isDefault: false, billingMode: 'metered' as const },
];

// Retired tiers from the earlier, pre-billing seed set — deactivated rather
// than deleted (Plan deletion is blocked while any Domain still references
// it; deactivating just hides them from pickers going forward).
const RETIRED_PLAN_NAMES = ['Business', 'Scale'];

export async function seedDefaultPlans(): Promise<void> {
  try {
    for (const plan of DEFAULT_PLANS) {
      await PlanModel.findOneAndUpdate(
        { name: plan.name },
        {
          $setOnInsert: {
            monthlyPriceInPaise: 0,
            isActive: true,
          },
          $set: {
            badge: plan.badge,
            seatCount: plan.seatCount,
            displayOrder: plan.displayOrder,
            isDefault: plan.isDefault,
            billingMode: plan.billingMode,
          },
        },
        { upsert: true }
      );
    }

    if (DEFAULT_PLANS.some((p) => p.isDefault)) {
      const defaultNames = DEFAULT_PLANS.filter((p) => p.isDefault).map((p) => p.name);
      await PlanModel.updateMany({ name: { $nin: defaultNames } }, { $set: { isDefault: false } });
    }

    await PlanModel.updateMany({ name: { $in: RETIRED_PLAN_NAMES } }, { $set: { isActive: false, isDefault: false } });

    console.log('[Seed] Plans reconciled to the confirmed billing tier set (Individual, Team, Growth, Enterprise, Custom).');
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
