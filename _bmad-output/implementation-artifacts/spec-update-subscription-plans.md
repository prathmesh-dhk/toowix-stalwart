---
title: 'Implement Updated 3-Tier Subscription Plans'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'oneshot'
route_source: 'pinned'
review: 'quick'
review_source: 'pinned'
baseline_commit: 'dff489a2dee016c9eb891b79696396678d4a24e8'
lenses_ran: ['quick']
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The platform's seeded subscription plans currently have stale tiers and prices (Starter ₹199, Pro ₹299, Business ₹399, Enterprise ₹599) instead of the user's defined 3-tier structure: Starter (₹49, email only, 5GB), Pro (₹99, apps + email, 20GB), Enterprise (₹149, apps + email, 30GB).

**Approach:** Update `DEFAULT_PLANS` in `backend/src/db/seed.ts` with the exact 3 tiers (Starter, Pro, Enterprise) reflecting ₹49, ₹99, and ₹149 prices, their respective storage quotas (5GB, 20GB, 30GB), apps (`['email']` vs `['email', 'meet', 'sign']`), and retire the legacy `Business` plan along with previously retired tiers. Re-run seed to reconcile DB defaults and verify test suites pass cleanly.

</frozen-after-approval>

## Implementation Notes

- Updated `backend/src/db/seed.ts`:
  - `Starter`: ₹49/month (4,900 paise), 5 GB storage, Email Only.
  - `Pro`: ₹99/month (9,900 paise), 20 GB storage, Email + Meet + Sign (isDefault: true).
  - `Enterprise`: ₹149/month (14,900 paise), 30 GB storage, Email + Meet + Sign.
  - Added legacy `'Business'` to `RETIRED_PLAN_NAMES` so it is safely deactivated upon next seed run.
- Updated `docs/BILLING_IMPLEMENTATION_PLAN.md` with new tier pricing and quotas.
- Fixed `backend/tests/billing-phase0.test.ts` environment variable cleanup so test suites remain completely hermetic.
- Verification: Ran `npm test` across all 79 test files (744 tests) with 100% passing.

## Review Triage Log
- All acceptance criteria satisfied.
- Clean pass on all 744 tests with zero regressions.
