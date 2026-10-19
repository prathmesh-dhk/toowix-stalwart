# 12: "Set default" can't leave Stripe half-updated

**What to build:** Since issue 03, **Set default** on the Billing page makes two Stripe calls in a row: it sets the customer's default card, then the subscription's. If the first succeeds and the second fails, the Tenant Admin sees a `STRIPE_ERROR`, and the app keeps the old card as default. Stripe, though, now has the new card on the customer and the old one on the subscription. A retry fixes it, but until then the three disagree. Make a failed **Set default** leave Stripe and the app agreeing on one card, for example by undoing the first call or by ordering the calls so the one that decides the charge goes last. Regression test at the mocked-`stripeClient` seam, with the subscription call rejecting.

Found during the issue 03 review. Spec story 20: "I want my saved default card to be used for charges, so that I control which card pays."

**Blocked by:** 03: Trial ends and the first invoice is paid

**Status:** ready-for-agent

- [ ] When the subscription update fails, the card Stripe will charge and the card the Billing page shows as default are the same
- [ ] The Tenant Admin still sees a clear error and can retry
- [ ] The success path is unchanged: both Stripe defaults and the app move to the chosen card
- [ ] Every fix has a regression test
