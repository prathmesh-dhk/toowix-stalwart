# 09: Full runbook re-run and reconcile check

**What to build:** Prove the whole set holds together. From a freshly seeded database, run all ten scenarios from the runbook in order. Then run the reconcile job and confirm it finds no drift between the app and Stripe, and that the billing summaries in the tenant-admin and super-admin apps match what Stripe actually charged. Fix whatever fails, with a regression test per fix.

**Blocked by:** 02, 03, 04, 05, 06, 07, 08

**Status:** done

- [x] All ten scenarios pass in one run from a fresh database, following only the runbook
- [x] The reconcile job reports no drift
- [x] Tenant-admin billing summary and invoice list match Stripe
- [x] Super-admin tenant billing status matches Stripe
- [x] Full backend and frontend test suites pass, apart from 16 failures that need a live Stalwart and fail on main too (see notes)
- [x] Every fix has a regression test

Run 2026-10-20 (see the runbook's "Reconcile and billing views" section for the setup and the seven fixes). Notes:
- Scenarios ran as in 06–08: separate database, Stalwart and email stubbed, API calls for the buttons; Checkout, card changes, the 3-D Secure challenge and the hosted invoice ran in a real browser.
- The full suite has 16 failures that also fail without these changes: the live Stalwart client tests, DNS records, domain activation and `/healthz`, which need a reachable Stalwart. Every billing test file passes.
- Runbook corrections: scenario 2 needs a different card from scenario 1 (one Trial per card); mailbox suspend is `POST /api/mailboxes/:id/suspend`; plan changes after billing starts go through `/upgrade` and `/downgrade`; the Grace Started email goes out once per domain.
- Loose ends filed as 17.

