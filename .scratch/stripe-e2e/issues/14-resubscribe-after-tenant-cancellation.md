# 14: A Tenant can subscribe again after its cancellation took effect

**What to build:** Once a Tenant's whole subscription has ended (`customer.subscription.deleted`), its domains are suspended and `tenants.stripeSubscriptionId` still points at the cancelled Stripe subscription. Picking a Plan or activating from the Cart then tries to add an item to that subscription, and Stripe refuses ("A subscription must have at least one active plan" / cancelled subscription). The Tenant can't come back without support. Detect an ended subscription and send the Tenant Admin through a fresh Checkout that creates a new subscription for all their planned domains. On adoption, the domains and mailboxes become active again (`reactivateDomainForPayment`).

Found during issues 08 and 13. Spec story 34: "I want to resume a cancellation before it takes effect, so that I can change my mind." This extends that story to after the cancellation takes effect.

**Decided (2026-10-20):** a returning Tenant has already used its 60-day Trial (`trialStartedAt` is set, one Trial per Tenant and per card fingerprint). The new Checkout charges straight away, with no Trial.

**Blocked by:** 13: Suspension stays inside the Tenant; choosing a Plan again restores a cancelled domain

**Status:** done

- [x] After a cancellation takes effect, the Cart offers a Checkout instead of failing at Stripe
- [x] Paying creates one new subscription with an item per planned domain, on the agreed Trial rule
- [x] The Tenant's domains and billed mailboxes are active again; held mailboxes stay held
- [x] Every fix has a regression test; runbook scenario 8 gains a "come back" step

**Done (2026-10-20):** "Ended" means a cancelled row on the Tenant's subscription and no live one (`hasEndedSubscription`). Picking a Plan then saves it without calling Stripe. The Cart offers a Checkout with no Trial and no promo code, and adoption reactivates the covered domains on the new subscription. Planned domains with no users join the new subscription right after adoption, as in the first Checkout. The Trial dates and the first card's fingerprint stay as they were. Not covered: not tried in Stripe test mode yet (runbook scenario 8 step 6). If cancelled rows are ever purged, an ended Tenant would no longer be detected.
