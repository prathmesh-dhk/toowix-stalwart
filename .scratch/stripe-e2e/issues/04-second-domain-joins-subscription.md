# 04: A second domain joins the same subscription

**What to build:** Scenario 4. A Tenant that already has a subscription adds a second domain on a different Plan. It attaches as another item on the existing subscription rather than creating a new one, and the Tenant gets one combined invoice listing both domains. Fix whatever fails, with a regression test per fix.

**Blocked by:** 02: First mailbox starts the Trial, and a coupon extends it

**Status:** done

- [x] The Tenant still has exactly one Stripe subscription after adding the second domain
- [x] Each domain appears as its own item at its own Plan's per-user rate
- [x] The next invoice is a single invoice covering both domains
- [x] The tenant-admin billing summary shows both domains correctly
- [x] Every fix has a regression test
- [x] Runbook section for scenario 4 written

**Notes (2026-10-19):** Live run executed against Stripe test mode with a test clock, using an API-created subscription of Checkout's shape adopted via adoptActivationSession, and in-memory mock stubs for Stalwart. Adding a second domain on a different plan attached a second subscription item to the existing subscription; advancing the clock past trial end produced a single paid combined invoice (₹197 total covering ₹98 for Starter and ₹99 for Pro). Fixed: (1) `stripeClient.addDomainSubscriptionItem` creating products first instead of passing invalid `price_data[product_data]`, (2) `ensureDomainSubscription` calling `addDomainSubscriptionItem` rather than failing on metered quantity rejection, (3) `adoptActivationSession` counting actual active mailboxes, and (4) `POST /api/tenants/me/domains` immediately attaching to an ongoing subscription when created with `planId`. Regression tests added in `stripe-client.test.ts` and `billing.routes.test.ts`.
