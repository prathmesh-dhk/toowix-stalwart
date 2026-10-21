# 09: Super Admin sees a Tenant's invoices

**What to build:** The Tenant's Billing tab lists its invoices with date, amount and status, each linking to Stripe's hosted invoice.

A new Super Admin endpoint returns a Tenant's invoices in the same shape as the Tenant Admin's invoice list, built on the same Stripe listing. The tab loads it when opened, separately from the detail page, so a Stripe failure shows an error in that list only. A Tenant with no Stripe customer gets an empty list.

Spec: `.scratch/billing-ui/spec.md`, stories 44–46; "Super Admin invoice list". Hosted invoice links are receipts, which ADR-0001 allows.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The endpoint returns the Tenant's invoices in the Tenant Admin shape; Super Admin only; empty without a Stripe customer (route tests, Stripe mocked)
- [x] The Billing tab loads the list when opened and shows date, amount, status and the hosted link
- [x] A failed load shows an error in the list; the rest of the tab still renders
- [x] Component tests with the API mocked
