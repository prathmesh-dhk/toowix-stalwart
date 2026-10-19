# 07: Failed payment and Grace Period, plus 3-D Secure

**What to build:** Scenarios 6 and 7. With a declining test card as default, a renewal fails: the Grace Period opens and the Tenant Admin is notified. Advancing the test clock past 7 days and running the grace sweep suspends the mailboxes; paying restores them and clears the Grace Period. Separately, with a 3-D Secure test card, a renewal triggers the action-required flow, the Tenant Admin is prompted to authenticate, and completing it marks the invoice paid and returns the account to good standing. Fix whatever fails, with a regression test per fix.

**Blocked by:** 03: Trial ends and the first invoice is paid

**Status:** done

- [x] A declined renewal opens the Grace Period and sends the failure notice
- [x] Nothing is suspended before the Grace Period ends
- [x] After 7 days (test clock + grace sweep), the Tenant's mailboxes are suspended
- [x] Paying the outstanding invoice restores mailboxes and clears the Grace Period
- [x] A 3-D Secure renewal prompts the Tenant Admin to authenticate in the app
- [x] Completing authentication marks the invoice paid and the account in good standing
- [x] Every fix has a regression test
- [x] Runbook sections for scenarios 6 and 7 written, including which test cards to use

**Notes (2026-10-19):** The live run used Stripe test mode and a test clock, with an API-created subscription adopted by the app, the Tenant's rows in a separate database and Stalwart stubbed. Five fixes, each with a regression test: the Grace Period runs 7 days from the failed invoice (test-clock time) and isn't restarted or re-announced by Stripe's retries; a retry failing after suspension keeps the domain suspended; Stripe's `past_due`/`active` subscription updates no longer overwrite `grace`/`suspended` (they arrive in either order around the invoice events); updating the card charges the outstanding invoice; and a 3-D Secure renewal stores the hosted invoice link, which the Billing page shows as **Authenticate payment**. Completing the 3-D Secure challenge itself needs a browser, so it wasn't run live; the payment it produces is covered by the same webhook path that restored scenario 6. The authentication email is sent once per invoice, and the 3-D Secure banner gives way to the Suspended banner. Loose ends from review: restoring a domain sets all its mailboxes `active`, including ones a Tenant Admin had suspended before the failure; any paid invoice (not only the failed one) clears the Grace Period; a late redelivered `invoice.payment_failed` after the invoice was paid reopens the Grace Period; a second failed invoice while already in grace or suspended is not recorded, so a card update pays only the first; the Grace Started email is still sent per domain, not once per Tenant.

**Notes (2026-10-20):** The browser step was run with the Playwright MCP. On the hosted invoice link (the one **Authenticate payment** opens), the 3-D Secure renewal was confirmed with the card on file (4000 0027 6000 3184), and **Complete** was clicked on Stripe's test challenge. The invoice was paid, and the resulting webhooks returned the app to `active`, with `paymentActionUrl` cleared and the domain and mailboxes active. No code changes were needed.
