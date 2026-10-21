# 04: Cancel this domain, and Choose a plan again

**What to build:** A Tenant Admin can cancel one domain from the Billing page and bring it back later.

- **Cancel this domain** opens a confirm. With other billed domains, it says the domain's mail stops now and it comes off the bill. As the only billed domain, it says this cancels the subscription at the end of the period (with the date) and mail keeps working until then. The backend's existing behaviour doesn't change.
- The summary now includes domains cancelled on their own, marked cancelled with a zero subtotal and left out of the monthly total.
- A cancelled domain shows as cancelled with **Choose a plan again**, which uses the existing Plan selection path. The domain goes back on the bill and its mail switches back on, while mailboxes the Tenant Admin suspended stay suspended.
- A Tenant whose whole subscription has ended still goes through the Cart's fresh Checkout; this ticket doesn't change that. Whole-subscription Cancel and Resume are unchanged.

Spec: `.scratch/billing-ui/spec.md`, stories 18–24.

**Blocked by:** 01: Prefactor: shared domain-billing row, and summary types match the backend

**Status:** done

- [x] The summary includes cancelled domains, marked cancelled and excluded from the total (route test)
- [x] The confirm wording differs for "other domains billed" vs "only domain", with the period-end date
- [x] Confirming calls the per-domain cancel endpoint and the row shows cancelled
- [x] **Choose a plan again** picks a Plan through the existing selection path and the row is billed again
- [x] Component tests for both wordings, cancel, and choose again
