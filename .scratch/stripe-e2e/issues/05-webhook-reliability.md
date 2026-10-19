# 05: Webhook reliability

**What to build:** Scenario 9. Resending an already-delivered webhook event (from the Stripe dashboard or CLI) changes nothing in the app. A forged or unsigned request is rejected. A handler failure returns an error status so Stripe retries, and the retried delivery then succeeds once. Fix whatever fails, with a regression test per fix.

**Blocked by:** 02: First mailbox starts the Trial, and a coupon extends it

**Status:** done

- [x] Resending a processed event leaves Tenant, domain subscription and mailbox state unchanged and sends no duplicate email
- [x] A bad signature returns 400 and changes nothing
- [x] A forced handler failure returns 500; the retried delivery is applied exactly once
- [x] Every fix has a regression test
- [x] Runbook section for scenario 9 written

**Notes (2026-10-19):** Live run executed against Stripe test mode with real webhook signature generation and stubbed Stalwart calls. Confirmed missing/bad signatures are rejected with 400 without touching database state, duplicate deliveries return 200 without re-applying state changes or sending duplicate emails, and forced handler failures return 500 while releasing the event ID from StripeEventModel so retried deliveries succeed once. Added `StripeEventModel.createIndexes()` in `connectDatabase` to ensure the unique index is explicitly built. Comprehensive regression tests added in `stripe-webhook.routes.test.ts`.
