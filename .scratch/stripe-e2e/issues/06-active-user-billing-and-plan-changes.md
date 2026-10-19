# 06: Billed Active Users, plus upgrade and downgrade

**What to build:** Scenarios 3 and 5. Adding mailboxes and suspending mailboxes changes the Active User count billed on the next invoice; suspended mailboxes are not billed and the Plan's user ceiling is never what's charged. Upgrading or downgrading a domain's Plan is reflected in Stripe and on the next invoice; a downgrade to a Plan whose ceiling is below the domain's current Active Users is refused or flagged. Fix whatever fails, with a regression test per fix.

**Blocked by:** 03: Trial ends and the first invoice is paid

**Status:** done

- [x] After adding mailboxes, the next invoice quantity equals the Active User count
- [x] Suspending a mailbox lowers the billed count on the next invoice
- [x] Upgrade and downgrade change the domain's item price in Stripe and the next invoice amount
- [x] A downgrade below current Active Users is refused or flagged with a clear message
- [x] Every fix has a regression test
- [x] Runbook sections for scenarios 3 and 5 written

**Notes (2026-10-19):** Live run executed against Stripe test mode with a test clock, using an API-created subscription adopted via adoptActivationSession, and in-memory mock stubs for Stalwart. Adding and suspending mailboxes correctly synced Stripe subscription item quantity to active mailbox counts; suspended mailboxes and plan ceilings were never billed. Upgrades immediately updated item price in Stripe and domain subscription rate/limits in MongoDB; downgrades below current active users were refused with 400 `ACTIVE_USERS_EXCEED_PLAN_LIMIT`; valid downgrades were scheduled for period end preserving sibling domain items, and applied to Domain/DomainSubscription on renewal webhook. Fixed: (1) `stripeClient.getOrCreatePrice` creating `usage_type: 'licensed'` monthly prices instead of `metered`, (2) `billingService.syncDomainActiveUserCount` filtering `billingHold: false`, (3) `stripeClient.scheduleDowngrade` preserving all sibling domain items across subscription schedule phases, (4) `billingService.requestDowngrade` enforcing active user limit check, (5) `billingService.requestUpgrade` updating `pricePerUserMonthlyPaise` and `maxUsers`, and (6) `billingService` applying `pendingDowngradePlanId` upon renewal payment. Comprehensive regression tests added to `stripe-client.test.ts` and `billing.routes.test.ts`.
