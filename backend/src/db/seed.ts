import argon2 from 'argon2';
import { config } from '../config';
import { connectDatabase, disconnectDatabase } from './connection';
import { AdminUserModel } from './models/AdminUser';
import { SystemSettingsModel } from './models/SystemSettings';
import { AuditLogModel } from './models/AuditLog';
import { PlanModel } from './models/Plan';
import { TenantModel } from './models/Tenant';
import { DomainModel } from './models/Domain';

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
  {
    name: 'Starter',
    badge: 'Basic',
    description: 'Essential email for solo founders and small teams (Up to 10 users)',
    seatCount: 10,
    displayOrder: 1,
    isDefault: false,
    billingMode: 'metered' as const,
    monthlyPriceInPaise: 19900, // ₹199 per active user / month
    storageQuotaGb: 10,
    apps: ['email'],
    features: ['Up to 10 users capacity', '₹199 per active user/month', '10 GB storage per user', 'Custom domain webmail & IMAP/SMTP', '60-day free trial'],
  },
  {
    name: 'Business',
    badge: 'Most Popular',
    description: 'Full workspace suite for growing teams (Up to 50 users)',
    seatCount: 50,
    displayOrder: 2,
    isDefault: true,
    billingMode: 'metered' as const,
    monthlyPriceInPaise: 39900, // ₹399 per active user / month
    storageQuotaGb: 25,
    apps: ['email', 'meet', 'sign'],
    features: ['Up to 50 users capacity', '₹399 per active user/month', '25 GB storage per user', 'Toowix Suite (Meet & Sign)', 'Priority Deliverability', '60-day free trial'],
  },
  {
    name: 'Enterprise',
    badge: 'High Capacity',
    description: 'High-capacity workspace with dedicated support (Up to 500 users)',
    seatCount: 500,
    displayOrder: 3,
    isDefault: false,
    billingMode: 'metered' as const,
    monthlyPriceInPaise: 59900, // ₹599 per active user / month
    storageQuotaGb: 50,
    apps: ['email', 'meet', 'sign'],
    features: ['Up to 500 users capacity', '₹599 per active user/month', '50 GB storage per user', 'Toowix Suite (Meet & Sign)', 'Full Audit Logs', '60-day free trial'],
  },
  {
    name: 'Pro',
    badge: 'Standard',
    description: 'Professional email workspace (Up to 20 users)',
    seatCount: 20,
    displayOrder: 4,
    isDefault: false,
    billingMode: 'metered' as const,
    monthlyPriceInPaise: 29900,
    storageQuotaGb: 20,
    apps: ['email', 'meet', 'sign'],
    features: ['Up to 20 users capacity', '₹299 per active user/month', '20 GB storage per user', '60-day free trial'],
  },
];

// Retired tiers from earlier seed sets — deactivated rather than deleted
const RETIRED_PLAN_NAMES = ['Individual', 'Team', 'Growth', 'Custom', 'Scale'];

export async function seedDefaultPlans(): Promise<void> {
  try {
    for (const plan of DEFAULT_PLANS) {
      await PlanModel.findOneAndUpdate(
        { name: plan.name },
        {
          $setOnInsert: {
            isActive: true,
          },
          $set: {
            badge: plan.badge,
            description: plan.description,
            seatCount: plan.seatCount,
            displayOrder: plan.displayOrder,
            isDefault: plan.isDefault,
            billingMode: plan.billingMode,
            monthlyPriceInPaise: plan.monthlyPriceInPaise,
            storageQuotaGb: plan.storageQuotaGb,
            apps: plan.apps,
            features: plan.features,
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

    console.log('[Seed] Plans reconciled to the confirmed 3-tier metered set (Starter, Pro, Enterprise).');
  } catch (err) {
    console.error('[Seed Plans Error]:', err);
    throw err;
  }
}

/** Name of the tenant that owns the platform identity domain. Not a customer — it exists so the
 *  globally-unique Domain row has an owner, since Domain.tenantId is required. */
export const PLATFORM_TENANT_NAME = 'Toowix Platform Identities';

/**
 * Every self-service signup gets a login identity at `username@<config.platformMailDomain>`,
 * which is a real mailbox. That needs a Domain row, and Domain.domainName is globally unique
 * with a required tenantId — so one system tenant owns it and every signup mailbox hangs off it.
 * Mailboxes here deliberately sit outside any customer tenant: no seat billing, no quota, and
 * they survive a customer's suspension so recovery mail still arrives.
 */
export async function seedPlatformIdentityDomain(): Promise<void> {
  try {
    const tenant = await TenantModel.findOneAndUpdate(
      { name: PLATFORM_TENANT_NAME },
      {
        $setOnInsert: {
          status: 'active',
          // Not a real quota — the platform provisioner bypasses the seat gate entirely.
          mailboxLimit: 1_000_000,
          mailboxCount: 0,
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    await DomainModel.findOneAndUpdate(
      { domainName: config.platformMailDomain },
      {
        $setOnInsert: {
          tenantId: tenant!._id,
          status: 'active',
          // Real deliverability still depends on DNS (MX/SPF/DKIM/DMARC) being published for
          // this domain; 'active' here only stops internal gates from blocking provisioning.
          dnsStatus: 'active',
          isPrimary: true,
          mailboxLimit: 1_000_000,
        },
      },
      { upsert: true }
    );

    console.log(`[Seed] Platform identity domain ready: ${config.platformMailDomain}`);
  } catch (err) {
    console.error('[Seed Platform Identity Domain Error]:', err);
    throw err;
  }
}

export async function seedAll(): Promise<void> {
  console.log('[Seed] Seeding database defaults...');
  await seedInitialAdmin();
  await seedSystemSettings();
  await seedDefaultPlans();
  await seedPlatformIdentityDomain();
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
