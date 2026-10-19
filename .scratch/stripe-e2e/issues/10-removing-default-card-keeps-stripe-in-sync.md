# 10: Removing the default card keeps Stripe in sync

**What to build:** When a Tenant Admin removes their default card on the Billing page, the app picks the first remaining card as the new default, but only in its own records. Stripe isn't told. The removed card is detached from the customer, so neither the customer nor the subscription may have a usable default left. If so, the next invoice either fails or is charged to a card the app doesn't show as default. Make removal of the default card leave Stripe charging the card the app now shows as default, the same way **Set default** does since issue 03. Check against Stripe test mode first: after a default card is detached, what are the customer's `invoice_settings.default_payment_method` and the subscription's `default_payment_method`? Fix whatever that shows, with a regression test at the mocked-`stripeClient` seam.

Found during issue 03. Spec story 21: "I want to add, remove and set a default card in the app, so that I can keep payment details current."

**Blocked by:** 03: Trial ends and the first invoice is paid

**Status:** ready-for-agent

- [ ] Live check recorded: Stripe's customer and subscription defaults after the default card is removed
- [ ] After removing the default card, the next invoice is charged to the card the Billing page shows as default
- [ ] Removing a card that isn't the default changes nothing in Stripe beyond detaching it
- [ ] Removing the only card is handled deliberately (refused, or the outcome made clear to the Tenant Admin)
- [ ] Every fix has a regression test
