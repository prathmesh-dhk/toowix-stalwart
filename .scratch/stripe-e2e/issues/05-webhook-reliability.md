# 05: Webhook reliability

**What to build:** Scenario 9. Resending an already-delivered webhook event (from the Stripe dashboard or CLI) changes nothing in the app. A forged or unsigned request is rejected. A handler failure returns an error status so Stripe retries, and the retried delivery then succeeds once. Fix whatever fails, with a regression test per fix.

**Blocked by:** 02: First mailbox starts the Trial, and a coupon extends it

**Status:** ready-for-agent

- [ ] Resending a processed event leaves Tenant, domain subscription and mailbox state unchanged and sends no duplicate email
- [ ] A bad signature returns 400 and changes nothing
- [ ] A forced handler failure returns 500; the retried delivery is applied exactly once
- [ ] Every fix has a regression test
- [ ] Runbook section for scenario 9 written
