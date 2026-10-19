# 08: Cancel and resume

**What to build:** Scenario 8. On a Tenant with two domains, cancelling one domain affects only that domain's subscription item; cancelling the whole Tenant ends the subscription. Resuming before the cancellation takes effect undoes either. In every case the domains and mailboxes end up in a consistent state, and cancellation only ever happens through the app (ADR-0001). Fix whatever fails, with a regression test per fix.

**Blocked by:** 04: A second domain joins the same subscription

**Status:** done

- [x] Cancelling one domain removes or schedules removal of only its item; the other domain keeps billing
- [x] Cancelling the Tenant schedules the whole subscription to end
- [x] Resuming before the effective date restores billing for a domain and for the Tenant
- [x] When a cancellation takes effect (test clock), domain and mailbox state match what the app promised
- [x] Every fix has a regression test
- [x] Runbook section for scenario 8 written

**Notes:** 2026-10-20. Live run as in runbook scenario 8, using a test clock, a separate database and stubbed Stalwart. Fixed four things: subscription events reviving a domain that was cancelled on its own, the Billing page's per-domain cancel loop, domain deletion cancelling the whole shared subscription, and cancelled domains keeping mail running. On cancellation, domains are suspended (the user's choice), using the non-payment suspension, so audit logs record `DOMAIN_SUSPENDED_NONPAYMENT`. A single domain cancelled off a shared subscription is suspended at once, because its item is removed then. Resume is covered for the Tenant and for the last domain on the subscription. A domain cancelled while others remain is taken off the bill at once, so it has no resume window. Loose ends, not fixed: the grace sweep still suspends by `domainId` without the ownership check that the cancellation path now has. Also: `retentionEndsAt` is set from the wall clock, not the event time, and nothing reads it yet. No per-domain resume exists. Picking a Plan again for a cancelled domain re-adds its billing item but does not un-suspend it.
