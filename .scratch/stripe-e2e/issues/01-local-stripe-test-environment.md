# 01: Local Stripe test environment

**What to build:** A developer can run the backend locally against their own Stripe test account and receive real, signed webhooks, starting from a freshly seeded database. The time-based scenarios need the app's sweep jobs (grace sweep, trial reminder, reconcile) to be runnable once on demand against the local database, so add that small dev-only entry point here first. Start the runbook that later tickets fill in, in this spec's folder.

The developer must rotate the test keys (they appeared in a chat transcript) and paste the new ones into the backend's local env file; that step is theirs. The webhook secret is the one printed by the Stripe CLI's listen session, not the one from the reference product.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Stripe CLI installed and logged in to the developer's test account
- [x] Rotated test-mode secret and publishable keys in the backend's local env file only (not committed)
- [x] Local database dropped and re-seeded; no Plan or Tenant carries a Stripe ID from another account
- [x] Stripe CLI listen session forwards to the backend's Stripe webhook endpoint; a triggered test event returns 200
- [x] A request with a bad or missing signature returns 400
- [x] Each sweep job can be run once on demand locally, with a regression test for the entry point
- [x] Runbook created with the setup steps and an empty section per scenario
