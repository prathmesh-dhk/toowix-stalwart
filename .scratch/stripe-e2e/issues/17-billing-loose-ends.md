# 17: Billing loose ends after the 09 run

**What to build:** Loose ends from the 09 run and its review.

1. `POST /api/tenants/me/billing/domains/:id/checkout` (`startCheckout`) still attaches a second domain with the Plan's shared price (`resolvePriceForDomainAttachment` + `addSubscriptionItem`). Since 09, every other path gives each domain its own licensed price (`addDomainSubscriptionItem`, `createDomainPrice`). The shared price collides when two domains are on one Plan, its fallback is a metered price Stripe won't take a quantity on, and its product carries no `domainId`, so the super-admin **Sync with Stripe** (`platform-tenant.routes.ts`, which matches items by product metadata) skips it. The Tenant Admin no longer calls `startDomainCheckout` (`apps/tenant-admin/src/api.ts`). Either route it through `ensureDomainSubscription`, or delete the endpoint, the client call and the meter-era helpers if nothing needs them.
2. When a Checkout is refused because its card already started another Tenant's Trial, the `checkout.session.completed` webhook answers 500, so Stripe retries it for days. Each retry is harmless (the subscription is already cancelled), but it is noise. Decide whether a `TRIAL_ALREADY_USED_FOR_CARD` refusal should be acknowledged with 200.

3. A pending downgrade's schedule copies the subscription's items when it is made, so an upgrade, a domain added, or a quantity change before the phase starts is undone when it does (Stripe applies the copied phase). Keep the schedule's next phase in step with those changes, or apply downgrades from the renewal webhook instead of a schedule.
4. Items still on a shared Plan price (point 1) have no `domainId` on their product, so `customer.subscription.updated` can't follow them onto a replacement item.
5. The reconcile job, like every quantity sync, sets a `fixed` Plan's item to the domain's Active Users, where `startCheckout` billed `seatCount`. Seeded Plans are all `metered`; decide whether `fixed` Plans still exist.
6. If point 2 acknowledges the refusal with 200, the cancel of Checkout's subscription (now only logged when it fails) must still be retried, or that subscription charges at trial end.

**Blocked by:** 09: Full runbook re-run and reconcile check

**Status:** needs-triage

- [ ] No billing path attaches a domain with a shared or metered Plan price, or the endpoint is gone
- [ ] Super-admin Sync with Stripe matches every item to its domain
- [ ] A refused-card checkout webhook is not retried by Stripe (if agreed)
- [ ] A plan change, new domain or quantity change made while a downgrade is pending survives the phase change
- [ ] Every fix has a regression test
