# 14: A Tenant can subscribe again after its cancellation took effect

**What to build:** Once a Tenant's whole subscription has ended (`customer.subscription.deleted`), its domains are suspended and `tenants.stripeSubscriptionId` still points at the cancelled Stripe subscription. Picking a Plan or activating from the Cart then tries to add an item to that subscription, and Stripe refuses ("A subscription must have at least one active plan" / cancelled subscription). The Tenant can't come back without support. Detect an ended subscription and send the Tenant Admin through a fresh Checkout that creates a new subscription for all their planned domains. On adoption, the domains and mailboxes become active again (`reactivateDomainForPayment`).

Found during issues 08 and 13. Spec story 34: "I want to resume a cancellation before it takes effect, so that I can change my mind." This extends that story to after the cancellation takes effect.

**Open question (needs-info):** a returning Tenant has already used its 60-day Trial (`trialStartedAt` is set, one Trial per Tenant and per card fingerprint). Should the new Checkout charge straight away with no Trial (the suggested default), or grant a new Trial?

**Blocked by:** 13: Suspension stays inside the Tenant; choosing a Plan again restores a cancelled domain

**Status:** needs-info

- [ ] After a cancellation takes effect, the Cart offers a Checkout instead of failing at Stripe
- [ ] Paying creates one new subscription with an item per planned domain, on the agreed Trial rule
- [ ] The Tenant's domains and billed mailboxes are active again; held mailboxes stay held
- [ ] Every fix has a regression test; runbook scenario 8 gains a "come back" step
