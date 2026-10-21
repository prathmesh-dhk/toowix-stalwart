# 08: Super Admin sees a Tenant's billing state

**What to build:** On a Tenant's Billing tab, the Super Admin can answer billing questions without the Stripe dashboard.

- The tab shows the Trial end, the current period end, whether the subscription cancels at period end (and when), and the Grace Period end while a payment has failed.
- Each domain row shows its pending downgrade (Plan and date) and whether it was cancelled on its own.
- The tab stays read-only apart from the existing **Sync with Stripe**.

The data comes from the Tenant billing summary the detail page already reuses, extended in tickets 02, 04 and 05. The detail page still loads if billing fails.

Spec: `.scratch/billing-ui/spec.md`, stories 38–43 and 46–47.

**Blocked by:** 02: Tenant Admin changes a domain's Plan; 04: Cancel this domain, and Choose a plan again; 05: Grace Period end in the payment-failed banner

**Status:** done

- [x] Tenant detail returns the new summary fields (route test)
- [x] The Billing tab shows Trial end, period end, cancel-at-period-end with its date, and Grace Period end when present
- [x] Domain rows show the pending downgrade and cancelled state
- [x] Sync with Stripe is unchanged; the detail page renders when billing is null
- [x] Component tests with the API mocked
