# 08: Cancel and resume

**What to build:** Scenario 8. On a Tenant with two domains, cancelling one domain affects only that domain's subscription item; cancelling the whole Tenant ends the subscription. Resuming before the cancellation takes effect undoes either. In every case the domains and mailboxes end up in a consistent state, and cancellation only ever happens through the app (ADR-0001). Fix whatever fails, with a regression test per fix.

**Blocked by:** 04: A second domain joins the same subscription

**Status:** ready-for-agent

- [ ] Cancelling one domain removes or schedules removal of only its item; the other domain keeps billing
- [ ] Cancelling the Tenant schedules the whole subscription to end
- [ ] Resuming before the effective date restores billing for a domain and for the Tenant
- [ ] When a cancellation takes effect (test clock), domain and mailbox state match what the app promised
- [ ] Every fix has a regression test
- [ ] Runbook section for scenario 8 written
