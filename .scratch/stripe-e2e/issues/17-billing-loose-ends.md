# 17: Billing loose ends after the 09 run

**What to build:** Loose ends from the 09 run and its review.

1. `POST /api/tenants/me/billing/domains/:id/checkout` (`startCheckout`) still attaches a second domain with the Plan's shared price (`resolvePriceForDomainAttachment` + `addSubscriptionItem`). Since 09, every other path gives each domain its own licensed price (`addDomainSubscriptionItem`, `createDomainPrice`). The shared price collides when two domains are on one Plan, its fallback is a metered price Stripe won't take a quantity on, and its product carries no `domainId`, so the super-admin **Sync with Stripe** (`platform-tenant.routes.ts`, which matches items by product metadata) skips it. The Tenant Admin no longer calls `startDomainCheckout` (`apps/tenant-admin/src/api.ts`). Either route it through `ensureDomainSubscription`, or delete the endpoint, the client call and the meter-era helpers if nothing needs them.
2. When a Checkout is refused because its card already started another Tenant's Trial, the `checkout.session.completed` webhook answers 500, so Stripe retries it for days. Each retry is harmless (the subscription is already cancelled), but it is noise. Decide whether a `TRIAL_ALREADY_USED_FOR_CARD` refusal should be acknowledged with 200.

3. A pending downgrade's schedule copies the subscription's items when it is made, so an upgrade, a domain added, or a quantity change before the phase starts is undone when it does (Stripe applies the copied phase). Keep the schedule's next phase in step with those changes, or apply downgrades from the renewal webhook instead of a schedule.
4. Items still on a shared Plan price (point 1) have no `domainId` on their product, so `customer.subscription.updated` can't follow them onto a replacement item.
5. The reconcile job, like every quantity sync, sets a `fixed` Plan's item to the domain's Active Users, where `startCheckout` billed `seatCount`. Seeded Plans are all `metered`; decide whether `fixed` Plans still exist.
6. If point 2 acknowledges the refusal with 200, the cancel of Checkout's subscription (now only logged when it fails) must still be retried, or that subscription charges at trial end.

**Blocked by:** 09: Full runbook re-run and reconcile check

**Status:** done

- [x] No billing path attaches a domain with a shared or metered Plan price, or the endpoint is gone
- [x] Super-admin Sync with Stripe matches every item to its domain
- [x] A refused-card checkout webhook is not retried by Stripe (if agreed)
- [x] A plan change, new domain or quantity change made while a downgrade is pending survives the phase change
- [x] Every fix has a regression test

## Notes (2026-10-20)

- **1, 4:** Deleted `startCheckout`, `POST /billing/domains/:id/checkout`, `startDomainCheckout`, and the helpers only it used (`resolvePriceForDomainAttachment`, `getOrCreatePrice`, `createCheckoutSession`, `addSubscriptionItem`, `createDedicatedMeteredPrice`). Nothing now attaches a shared Plan price, so every new item's product carries `domainId`. Items already on a shared price in Stripe (if any exist) are not migrated. The `checkout.session.completed` branch for `domainId` metadata stays, so an old Checkout still in flight completes.
- **2, 6:** The refused card's subscription is now cancelled before the refusal is thrown. A failed cancel throws, so the webhook answers 500 and Stripe retries; a retry skips the cancel when the subscription is already `canceled`. The webhook acknowledges `TRIAL_ALREADY_USED_FOR_CARD` with 200. In the Tenant Admin, a failed cancel now shows a generic error instead of the card message.
- **3:** Kept the schedule but rebuilt it from live items. `DomainSubscription.pendingDowngradePriceId` stores each pending downgrade. `stripeClient.setPendingPrices` replaces `scheduleDowngrade`: both phases come from the subscription's live items, with the pending prices swapped into the next phase, and the schedule is released once nothing is pending. It runs on every `customer.subscription.updated`, when a schedule is attached or a downgrade is pending, and on downgrade. An upgrade drops the domain's pending downgrade. Not tried against live Stripe yet: rerun runbook steps for a downgrade, then add a domain and an upgrade before the test clock crosses the renewal.
- **5:** Answered by the user (2026-10-20): there are no `fixed` Plans; every Plan bills per Active User. Billing every item at its Active Users count is correct. The leftover `billingMode === 'fixed'` branches are dead code and were left in place.

