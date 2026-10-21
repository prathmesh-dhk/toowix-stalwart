# 05: Grace Period end in the payment-failed banner

**What to build:** A Tenant Admin whose payment failed sees "Mail stops on <date> unless you pay" in the banner, with **Update card** where it is now. The summary returns each domain's Grace Period end and, at the top level, the Tenant's earliest one while a Grace Period is open. The 3-D Secure and suspended banners are unchanged.

Spec: `.scratch/billing-ui/spec.md`, stories 25–28.

**Blocked by:** 01: Prefactor: shared domain-billing row, and summary types match the backend

**Status:** done

- [x] The summary returns the Grace Period end per domain and the earliest at the top level; null when none is open (route test)
- [x] The banner shows the date, and falls back to the current wording if the date is missing
- [x] The 3-D Secure and suspended banners are unchanged (existing tests pass)
- [x] Component test for the dated banner
