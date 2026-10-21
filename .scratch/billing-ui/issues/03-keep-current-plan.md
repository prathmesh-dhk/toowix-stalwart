# 03: Keep current plan

**What to build:** A Tenant Admin with a pending downgrade can click **Keep current plan** on the badge, and the downgrade is gone in the app and in Stripe, so the renewal charges the Plan they're on.

A new Tenant Admin endpoint on the domain's downgrade cancels it. It clears the domain's pending Plan and pending price, rebuilds the subscription schedule from the live items through the existing pending-prices path (releasing the schedule when nothing else is pending), and writes an audit entry. With nothing pending it succeeds and changes nothing. A domain of another Tenant is refused.

Spec: `.scratch/billing-ui/spec.md`, stories 13–14; "New endpoint: keep current plan".

**Blocked by:** 02: Tenant Admin changes a domain's Plan

**Status:** done

- [x] The endpoint clears the pending downgrade and calls the pending-prices rebuild (route test, Stripe mocked)
- [x] With another domain still pending, that domain's downgrade stays in the schedule
- [x] No-op success when nothing is pending; another Tenant's domain is refused
- [x] An audit entry is recorded
- [x] **Keep current plan** on the badge calls the endpoint and the badge disappears (component test)
