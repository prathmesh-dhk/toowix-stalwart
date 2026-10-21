# 10: Runbook covers the new UI and the stripe-e2e fixes; live run

**What to build:** A future live run checks everything this spec added against real Stripe.

- Add runbook steps (`.scratch/stripe-e2e/runbook.md`) for tickets 02–09.
- Add runbook steps for stripe-e2e issues 10 (removing the default card), 12 (failed Set default), 14 (subscribing again after the Tenant's cancellation took effect), 15 (payment leaves admin suspensions alone) and 17 (changes made while a downgrade is pending survive the phase change).
- Update scenario 5's notes to name the current pending-prices path.
- Run the new steps once in Stripe test mode, driving the browser with Playwright.
- Fix whatever fails, with a regression test per fix.

Spec: `.scratch/billing-ui/spec.md`, story 50.

**Blocked by:** 01–09

**Status:** done

- [x] The runbook has steps for tickets 02–09 and stripe-e2e issues 10, 12, 14, 15 and 17
- [x] Scenario 5's notes are current
- [x] The new steps were run once in Stripe test mode, with the date and results recorded
- [x] Every fix has a regression test

## Notes (2026-10-21)

- Runbook scenarios 11–15 cover tickets 02–09 and stripe-e2e issues 10, 12, 14, 15 and 17. Scenario 5's step 3 and notes now name `stripeClient.setPendingPrices` and `pendingDowngradePriceId`.
- Run once in Stripe test mode on test clocks, every Billing page action clicked via Playwright, with the `backend/.e2e09` harness (separate database `toowix_e2e10`, Stalwart and email stubbed). Results and fixes are recorded under scenario 15.
- Fixes, each with a regression test:
  - A downgrade during the Trial ended the Trial and billed at once: `tests/stripe-client.test.ts`, "keeps a running Trial".
  - The Tenant Admin's Billing page reloaded about twice a second and wiped every error message: `apps/tenant-admin/tests/components/BillingView.test.tsx`, "loads once".
  - An ended Tenant couldn't set or remove its default card: `tests/billing.routes.test.ts`, "once the subscription has ended".
  - Plans summary copy said "Per mailbox" (copy only, no test).
- Not checked live: the Keep current plan audit entry (route-tested) and editing an existing Plan. Issue 12's rollback can't be forced live on a running subscription; the runbook points at its route test.
