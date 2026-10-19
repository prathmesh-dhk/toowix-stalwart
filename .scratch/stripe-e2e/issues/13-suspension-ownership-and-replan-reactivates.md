# 13: Suspension stays inside the Tenant; choosing a Plan again restores a cancelled domain

**What to build:** Two loose ends from issue 08.

1. The grace sweep suspends a domain by the `domainId` on the subscription row. On the shared platform domain, rows from many Tenants share one `domainId`, so one Tenant's expired Grace Period would suspend that domain and every Tenant's mailboxes on it. Only suspend a domain the row's own Tenant owns, everywhere suspension happens.
2. When a Tenant Admin picks a Plan again for a domain cancelled on its own, it goes back on the bill, but the domain and its mailboxes stay suspended. Billing restarts while mail stays off. They should be active again.

Regression test at the mocked-`stripeClient` seam for each.

Spec story 35: "I want cancellation to apply the same in-app consequences however it's triggered, so that domains and mailboxes end up in a consistent state."

**Blocked by:** 08: Cancel and resume

**Status:** done

- [x] An expired Grace Period never suspends a domain owned by another Tenant
- [x] Picking a Plan for a cancelled, suspended domain re-adds its billing item and reactivates the domain and its mailboxes
- [x] Every fix has a regression test

**Notes:** 2026-10-20. `suspendDomainForNonPayment` and `reactivateDomainForPayment` now take the Tenant and only touch that Tenant's own domain, so the grace sweep, both cancellation paths and payment recovery share one check. Reactivation no longer switches on mailboxes still on billing hold, since they aren't billed. A row on the platform domain still goes to `suspended`, but the domain and other Tenants' mailboxes are left alone. `ensureDomainSubscription` reactivates a cancelled, suspended domain before counting its users, and suspends it again if Stripe refuses the item. Not covered: re-subscribing after the whole Tenant subscription has ended (Stripe rejects adding an item to a cancelled subscription; that needs a new Checkout). Reactivation also reactivates mailboxes the Tenant Admin had suspended by hand, as payment recovery already did. An expired Grace Period on a platform-domain row marks the row `suspended` but leaves that Tenant's own platform mailboxes on.
