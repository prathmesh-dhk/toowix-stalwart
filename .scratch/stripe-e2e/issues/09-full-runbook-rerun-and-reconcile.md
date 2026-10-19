# 09: Full runbook re-run and reconcile check

**What to build:** Prove the whole set holds together. From a freshly seeded database, run all ten scenarios from the runbook in order. Then run the reconcile job and confirm it finds no drift between the app and Stripe, and that the billing summaries in the tenant-admin and super-admin apps match what Stripe actually charged. Fix whatever fails, with a regression test per fix.

**Blocked by:** 02, 03, 04, 05, 06, 07, 08

**Status:** ready-for-agent

- [ ] All ten scenarios pass in one run from a fresh database, following only the runbook
- [ ] The reconcile job reports no drift
- [ ] Tenant-admin billing summary and invoice list match Stripe
- [ ] Super-admin tenant billing status matches Stripe
- [ ] Full backend and frontend test suites pass
- [ ] Every fix has a regression test
