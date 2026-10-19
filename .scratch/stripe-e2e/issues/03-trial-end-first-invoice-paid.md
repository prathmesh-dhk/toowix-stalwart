# 03: Trial ends and the first invoice is paid

**What to build:** Scenario 2. With the Tenant's Stripe customer on a test clock, advance past the Trial's end; Stripe charges the default card, the webhook updates the app, and the paid invoice appears in the tenant-admin app's invoice list. The trial reminder sweep, run on demand before the end, sends its reminder. Fix whatever fails, with a regression test per fix.

**Blocked by:** 02: First mailbox starts the Trial, and a coupon extends it

**Status:** done

- [x] Trial reminder email is sent before the Trial ends
- [x] Advancing the test clock past Trial end produces a paid invoice charged to the default card
- [x] The app shows the domain as active and paid, with the next period end matching Stripe
- [x] The paid invoice appears in the tenant-admin invoice list with the correct amount
- [x] Every fix has a regression test
- [x] Runbook section for scenario 2 written, including the test clock steps

**Notes (2026-10-19):** The live run used Stripe test mode and a test clock. An API-created subscription of Checkout's shape stood in for the hosted Checkout, because there was no browser. Three fixes, each with a regression test: the sweep CLI takes an as-of date; a reminder whose email failed is retried; and **Set default** now also sets the subscription's card, with the Billing page marking the real default. Loose ends are filed as 10 (removing the default card), 11 (a test for the CLI date argument) and 12 ("Set default" failing halfway).
