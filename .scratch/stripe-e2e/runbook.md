# Runbook: Stripe billing end-to-end in test mode

Re-run all of this after any billing change. Commands run from `backend/` unless noted.

## Setup

1. **Stripe CLI.** Install it (https://docs.stripe.com/stripe-cli), then run `stripe login` and pick your **test** account.
2. **Keys.** Rotate the test keys in the Stripe Dashboard (Developers → API keys → Roll). The old ones appeared in a chat transcript. Put the new keys in `backend/.env` only, since it's git-ignored:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   ENABLE_BILLING=true
   ```
   Remove `SKIP_BILLING=true` if it's there. With billing off, the app runs in sandbox mode (no Stripe Checkout) and the grace/reconcile sweeps do nothing.
   Don't use the reference product's price IDs or webhook secret.
3. **Fresh database.** Run `npm run db:clear`. It wipes Tenants, Domains, Mailboxes, Plans, DomainSubscriptions and StripeEvents, then re-seeds the default Plans with no Stripe IDs. Prices and meters are re-created lazily under your account on first use.
   ⚠️ `db:clear` also deletes every non-system domain and account on whatever Stalwart `STALWART_URL` points at. If that is a shared or live server (e.g. `smtp.dhkmail.com`), **don't run it**. Wipe only the Mongo collections listed above, then restart the backend, which re-seeds on startup.
   Check: in Mongo, `db.plans.find({ stripePriceId: { $ne: null } })` and `db.tenants.find({ stripeCustomerId: { $ne: null } })` both return nothing.
4. **Webhooks.** In a second terminal:
   ```
   stripe listen --all-snapshot --forward-to localhost:4000/api/webhooks/stripe
   ```
   Copy the `whsec_...` that it prints into `backend/.env` as `STRIPE_WEBHOOK_SECRET`. It stays the same across `listen` sessions for the same account and device.
5. **Start the backend** with `npm run dev`. `.env` is only read at startup, so restart after any change to it. Until the webhook secret is set, the webhook returns 503.
6. **Smoke checks** (in PowerShell, type `curl.exe`; plain `curl` is a different command):
   - `stripe trigger customer.created` → the `listen` terminal shows `[200]`.
   - A missing signature returns 400:
     `curl.exe -i -X POST localhost:4000/api/webhooks/stripe -H "Content-Type: application/json" --data-raw "{}"`
   - A bad signature returns 400: run the same command plus `-H "Stripe-Signature: t=1,v1=bad"`.

## Running sweep jobs on demand

Use these instead of waiting for the jobs' intervals. Each one runs once against `MONGODB_URI` and prints its result:

```
npm run job -- grace       # Grace Period expiry, day-3/day-6 notices, payment retry
npm run job -- trial       # Trial reminders (days 45/55/59)
npm run job -- reconcile   # Stripe quantity vs Active User drift
```

For Trial-end and Grace-Period scenarios, attach the Tenant's Stripe customer to a test clock, advance the clock, wait for the webhooks, then run the job.

## Scenarios

### 1. First mailbox requires a card and starts the Trial

Use a new Tenant with no card. Domains on the shared Stalwart are real, so pick a throwaway name such as `stripe-e2e-<tag>.example.com`.

1. Add the domain on a Plan, then switch its Plan once (`POST /api/tenants/me/domains`, then `POST /api/tenants/me/billing/domains/:id/select-plan`).
   Check: the Tenant has `trialStartedAt: null` and `stripeCustomerId: null`, there is no `domain_subscriptions` row, and Stripe has no customer with the Tenant's email (`stripe customers list --email <contact email>`).
2. Create the first mailbox.
   Check: the response has `billingHold: true` and `status: suspended`. The dashboard shows "waiting for activation" and the Cart badge counts it. There is still no Stripe customer.
3. Click **Ready for checkout** twice quickly in the Cart (or send two `POST /api/tenants/me/cart/checkout` at once).
   Check: there is exactly **one** Stripe customer for the email. Expire the extra session with `stripe checkout sessions expire cs_...`.
4. Pay the Checkout with `4242 4242 4242 4242`. The `listen` terminal shows `checkout.session.completed [200]`.
   Check: the mailbox is `active` with `billingHold: false`, and nothing was re-entered.
5. Compare the dates. `tenants.trialStartedAt`/`trialEndsAt`, `domain_subscriptions.trialEnd` (status `trialing`), the Cart's "Ends …" and `GET /api/tenants/me/billing/summary` should all equal the subscription's `trial_start`/`trial_end` (`stripe subscriptions retrieve sub_...`). The Trial runs 60 days.
6. Revisit the return URL (`POST /api/tenants/me/cart/complete` with the session id).
   Check: the response has `alreadyStarted: true`, and nothing changes.

Last run 2026-10-19. Two fixes came out of it. A double-clicked checkout used to create two Stripe customers; it now uses a per-Tenant idempotency key. A ₹0 trial invoice used to flip the domain to `active` while Stripe still said `trialing`; that's fixed too.

### 2. Trial ends (test clock) and the first invoice is paid

A customer can only join a test clock when it is created, so use a **new** Tenant. One card starts one Trial: a card already used for another Tenant's Trial is refused at Checkout's return (`TRIAL_ALREADY_USED_FOR_CARD`), and Stripe's subscription is cancelled. Scenario 1 used 4242, so pay this Checkout with Visa debit `4000 0566 5566 5556` and create its Stripe customer on the clock before its first Checkout. The app reuses `tenants.stripeCustomerId` when it is set. Stripe CLI times are Unix seconds. In PowerShell, `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()` gives the current time and `[DateTimeOffset]::FromUnixTimeSeconds(<t>)` turns one back into a date.

1. Create the clock and the customer:
   ```
   stripe test_helpers test_clocks create --frozen-time=<now> --name="e2e <tag>"
   stripe customers create --email=<contact email> --name="<tenant name>" --test-clock=clock_...
   ```
   In Mongo, run `db.tenants.updateOne({ _id: ObjectId("<tenant id>") }, { $set: { stripeCustomerId: "cus_..." } })`.
2. Run scenario 1, steps 1 to 4: add a domain, create a mailbox (or two), then pay Checkout with `4000 0566 5566 5556`.
   Check: the Trial dates equal the subscription's `trial_start` and `trial_end`, which follow the clock's time.
3. **Default card.** On the Billing page, click **Change card** and pay with `5555 5555 5555 4444`. Then click **Set default** on the 5556 card.
   Check: the Billing page marks 5556 as default, and `stripe subscriptions retrieve sub_...` shows `default_payment_method` set to the 5556 card's `pm_...`.
4. **Reminder.** Advance the clock to day 46 (`stripe test_helpers test_clocks advance clock_... --frozen-time=<trial_start + 46 days>`). Wait until `stripe test_helpers test_clocks retrieve clock_...` shows `"status": "ready"`. Then run the sweep as of the clock's time:
   ```
   npm run job -- trial 2026-12-04T13:00:00Z
   ```
   Check: it prints `{ reminded: 1 }` and logs `[EMAIL DISPATCH: SUCCESS] Billing notice "Reminder: Your Toowix trial ends in 14 days"`. A `FALLBACK` line means the email wasn't delivered and the reminder isn't recorded, so the next run retries it. Locally, port 2525 is the Stalwart container, which refuses relay to outside addresses. Point `SMTP_HOST`/`SMTP_PORT` at any local SMTP sink for this one command.
5. **Trial end.** Advance the clock to one hour past `trial_end`, then wait for `ready` again. The `listen` terminal shows `invoice.payment_succeeded` and `customer.subscription.updated`, both `[200]`.
   Check:
   - `stripe invoices list --customer=cus_...` has a `subscription_cycle` invoice, `paid`, for Active Users × the Plan's per-user price (2 × ₹49 = ₹98 on Starter).
   - `stripe charges list --customer=cus_... --limit=1` shows the 5556 card from step 3, not the newer 5555 card.
   - `domain_subscriptions` has status `active`, and its `currentPeriodEnd` equals the subscription item's `current_period_end`. `GET /api/tenants/me/billing/summary` returns the same values.
   - The Billing page's invoice list shows the ₹98.00 paid invoice above the ₹0 trial invoice.
6. Optionally, advance one more month. The renewal is charged to the same card, and `currentPeriodEnd` moves with it.
7. Clean up: `stripe test_helpers test_clocks delete clock_...` also deletes the clock's customer and subscription.

Last run 2026-10-19. Hosted Checkout was replaced by an API-created subscription of the same shape, which was then passed to the app's own adoption code, because no browser was available. The domain and mailboxes were seeded in Mongo, so nothing touched the shared Stalwart. Fixed:
- `npm run job` couldn't run a sweep as of a test clock's time, so the reminder couldn't fire before the Trial ended. It now takes an optional date.
- A reminder whose email failed to send was still marked as sent, and was never retried.
- **Set default** changed only the customer's default card. Stripe kept charging the subscription's card from Checkout or the last card update. The Billing page also always marked the newest card as default. Both now follow the card the Tenant Admin picks.

### 3. Adding and suspending mailboxes changes the billed Active User count

Run this on a Tenant with an active subscription (or past trial) on a plan with a seat ceiling (e.g. Starter, ceiling 10 mailboxes). Active mailboxes are billed per user; mailboxes on billing hold or suspended are not billed, and the plan's ceiling is never billed.

1. **Active mailboxes.** Start with 1 active mailbox on the domain (`quantity: 1` in Stripe). Add 2 more mailboxes (`POST /api/mailboxes` under the domain).
   Check: each added mailbox increments the Stripe subscription item's quantity (`quantity: 3`). `GET /api/tenants/me/billing/summary` and the Billing page show Active Users: 3, Subtotal: ₹147 (3 × ₹49), not the plan ceiling of 10.
2. **Upcoming invoice.** Retrieve the upcoming invoice in Stripe (`stripe invoices retrieve upcoming --customer=cus_... --subscription=sub_...`).
   Check: the line item for the next period has quantity 3 and amount ₹147.00. The preview also lists "Unused time" / "Remaining time" proration lines for each quantity change.
3. **Suspend a mailbox.** Suspend one of the mailboxes in the Tenant Admin (or `POST /api/mailboxes/:id/suspend`; `POST /api/mailboxes/:id/reactivate` undoes it).
   Check: the subscription item in Stripe immediately updates to `quantity: 2`. `GET /api/tenants/me/billing/summary` drops to 2 active users (₹98). The suspended mailbox does not count toward billable quantity.
4. **Reactivate or add.** Reactivate the suspended mailbox (or create another active mailbox).
   Check: the subscription item updates back to `quantity: 3`. Mailboxes created before checkout (in `billingHold: true` status) do not increment the billed quantity until activated.
5. **Invoice generation.** When the invoice is generated or the test clock advances to cycle billing, Stripe bills Active Users × per-user price (3 × ₹49 = ₹147), never the plan ceiling (10).

Last run 2026-10-19. Live run executed against Stripe test mode with a test clock. Fixed:
- `stripeClient.getOrCreatePrice` created prices with `usage_type: 'metered'`, which Stripe rejected when updating licensed subscription items or setting item quantity (`You cannot set the quantity for metered plans`). It now creates `usage_type: 'licensed'` recurring monthly prices.
- `billingService.syncDomainActiveUserCount` counted all mailboxes with `status: 'active'`, potentially including mailboxes still on billing hold. It now explicitly filters `billingHold: false`.

### 4. A second domain joins the same subscription and the same invoice

Run this on a Tenant that already has a running subscription (from scenario 1 or 2, e.g. domain 1 on Starter with active mailboxes).

1. Add a second domain in the Tenant Admin (or via `POST /api/tenants/me/domains` with a different Plan, e.g. Pro, or select the Plan via `POST /api/tenants/me/billing/domains/:id/select-plan`).
   Check: the domain row has `planId` set and joins the tenant's existing subscription (`stripeSubscriptionId` matches domain 1). The Stripe subscription (`stripe subscriptions retrieve sub_...`) now contains two items (`items.data.length == 2`), one for each domain with metadata carrying `domainId` and `planId`.
2. Add mailboxes to the second domain.
   Check: active mailboxes increment the subscription item's quantity in Stripe (`quantity: 1`).
3. Check the Billing summary (`GET /api/tenants/me/billing/summary` or view the Billing page).
   Check: both domains appear with their respective Plan names, active mailbox counts, per-user rates (e.g. ₹49/user on Starter and ₹99/user on Pro), and calculated monthly subtotals.
4. Preview the upcoming invoice (`stripe invoices retrieve upcoming --customer=cus_... --subscription=sub_...` or advance the test clock past the trial end).
   Check: Stripe returns a single invoice containing line items for both domains (e.g. 2 × ₹49 = ₹98 for Starter, and 1 × ₹99 = ₹99 for Pro, total ₹197). Advancing past trial end pays this single invoice automatically via the tenant's default card.

Last run 2026-10-19. Live run executed against Stripe test mode with a test clock. Fixed:
- `stripeClient.addDomainSubscriptionItem` passed `price_data.product_data` directly into `stripe.subscriptionItems.create`, which Stripe rejected (`Received unknown parameter: price_data[product_data]`). It now creates `stripe.products.create` first and supplies the product ID.
- `ensureDomainSubscription` called `addSubscriptionItem` with a quantity on metered plans, which Stripe rejected (`You cannot set the quantity for metered plans`). It now routes through `addDomainSubscriptionItem`, carrying over the sibling's trial and period dates.
- `adoptActivationSession` hardcoded `activeUserCount: 0` instead of counting the domain's existing active mailboxes.
- Creating a domain with `planId` while the tenant already had an active subscription didn't attach the domain subscription item immediately; it now attaches immediately.

### 5. Upgrade and downgrade a domain's Plan

Run this on a Tenant with an active domain subscription (e.g. on Starter @ ₹49/user, ceiling 10 users).

1. **Upgrade.** In the Tenant Admin (or via `POST /api/tenants/me/billing/domains/:id/upgrade` with `{ "planId": "<Pro>" }`; `select-plan` answers 409 `PLAN_ALREADY_SELECTED` once a domain is billed). Try it with another domain of the Tenant already on Pro:
   Check:
   - The Stripe subscription item (`items.data[0]`) immediately updates its price to the Pro price, retaining the current active user quantity.
   - `DomainSubscription` updates `pricePerUserMonthlyPaise: 9900` and `maxUsers: 50`.
   - `Domain` updates `planId`, `planName: "Pro"`, and `mailboxLimit: 50`.
   - `GET /api/tenants/me/billing/summary` and the Billing page reflect the Pro plan and ₹99/user rate immediately.
   - Stripe upcoming invoice (`stripe invoices retrieve upcoming --customer=cus_...`) immediately reflects line items charged at ₹99/user × active users.
2. **Downgrade below current Active Users is refused.** With e.g. 5 active mailboxes on the domain, attempt to downgrade to a plan whose ceiling is below 5 (or seed/create active mailboxes exceeding the target plan's ceiling, e.g. 12 active users attempting to downgrade to Starter with ceiling 10).
   Check: the request returns 400 Bad Request with error code `ACTIVE_USERS_EXCEED_PLAN_LIMIT` and message `"Cannot downgrade to <Plan>: domain has X active mailboxes, which exceeds the plan limit of Y."`. Stripe is not touched and the plan remains unchanged.
3. **Valid downgrade.** With active mailboxes within the target plan ceiling (e.g. 2 active mailboxes downgrading from Pro to Starter):
   Select the lower plan (`POST /api/tenants/me/billing/domains/:id/downgrade` with `{ "planId": "<Starter>" }`).
   Check:
   - The downgrade is scheduled via Stripe Subscription Schedule for the end of the current billing period (`current_period_end`).
   - Sibling domain items on multi-domain subscriptions are preserved in phase 2 so other domains are not dropped.
   - `DomainSubscription` sets `pendingDowngradePlanId` to the target plan ID. Current plan and rates remain active until period end.
4. **Renewal applies the downgrade.** Advance the test clock past the current period end (`stripe test_helpers test_clocks advance clock_... --frozen-time=<period_end + 1 hour>`).
   Check:
   - The `listen` terminal shows `invoice.payment_succeeded` and `customer.subscription.updated` `[200]`.
   - The renewal invoice charges the downgraded rate (e.g. 2 × ₹49 = ₹98).
   - The webhook handler applies `pendingDowngradePlanId`: `DomainSubscription` and `Domain` reflect Starter plan and ₹49/user, and `pendingDowngradePlanId` is cleared (`null`).
   - Stripe replaces the downgraded domain's subscription item when the phase starts. `domain_subscriptions.stripeSubscriptionItemId` follows it to the new `si_...`.
5. **A second downgrade.** Downgrade another domain of the same Tenant (the first downgrade's schedule is still attached for one period), then renew again.
   Check: the request returns 200 and the renewal applies it, as in step 4.

Last run 2026-10-19. Live run executed against Stripe test mode with a test clock. Fixed:
- `stripeClient.scheduleDowngrade` only put the downgraded domain's item into `phases[1].items`, dropping all sibling domain subscription items on multi-domain subscriptions upon phase change. It now carries over all other subscription items.
- `billingService.requestDowngrade` did not check whether current active mailbox count exceeded the target plan's user ceiling, silently allowing downgrades that violate plan limits. It now validates and returns 400 `ACTIVE_USERS_EXCEED_PLAN_LIMIT`.
- `billingService.requestUpgrade` did not update `DomainSubscription.pricePerUserMonthlyPaise` or `maxUsers`, leaving `getTenantBillingSummary` showing stale pricing. It now updates them immediately.
- `billingService` webhook handler for `invoice.payment_succeeded` now updates `Domain` and `DomainSubscription` with the pending downgrade plan when the renewal invoice pays.

### 6. Failed payment opens the Grace Period; suspension after 7 days; paying restores

Test cards: `4000 0000 0000 0341` (`pm_card_chargeCustomerFail`) attaches fine but declines every charge; `4242 4242 4242 4242` to pay. Use a Tenant on a test clock (scenario 2) whose Trial has ended and first invoice is paid.

1. **Declining card.** On the Billing page, click **Change card** and pay with `4000 0000 0000 0341`. It becomes the subscription's default (scenario 2, step 3).
2. **Renewal fails.** Advance the clock to one hour past the subscription's `current_period_end` and wait for `ready`. The `listen` terminal shows `invoice.payment_failed`, `customer.subscription.updated` (`past_due`) `[200]`, in either order.
   Check:
   - `domain_subscriptions` has status `grace`, `lastPaymentFailedInvoiceId` set, and `gracePeriodEndsAt` exactly 7 days after the failed invoice's `created` (clock time, not today's date).
   - One `[EMAIL DISPATCH] Billing Grace Started` line per domain on the subscription, each naming its domain, with that deadline.
   - The Billing page shows the amber **Payment failed** banner. Mail still works.
3. **Nothing is suspended early.** Advance the clock 3 days, then 5 days, running the sweep as of the clock's time each time (`npm run job -- grace <clock time>`).
   Check: `{ suspended: 0 }` both times; the day-3 reminder goes out once. Stripe's own retries send more `invoice.payment_failed` events; `gracePeriodEndsAt` does not move and no further Grace Started email is sent. The sweep's daily retry logs `Your card was declined.`
4. **Suspension.** Advance the clock to 8 days after the failure and run the sweep as of that time.
   Check: `{ suspended: 1 }`; the domain, its `domain_subscriptions` row and its mailboxes are `suspended`; the Billing page shows the red **Suspended** banner. Later retries failing do not move it back to `grace`.
5. **Paying restores.** Click **Resolve Payment** and pay with `4242 4242 4242 4242`. Completing the card update charges the outstanding invoice straight away.
   Check: `stripe invoices retrieve in_...` is `paid`; the `listen` terminal shows `invoice.payment_succeeded` and `customer.subscription.updated` (`active`) `[200]`, in either order; the domain and mailboxes are `active` again, `gracePeriodEndsAt` and `lastPaymentFailedInvoiceId` are `null`, and the Billing page shows no banner.

Last run 2026-10-19, with the Tenant's rows in a separate database and Stalwart stubbed; the subscription was created by API and adopted, and the card update's charge was made with `stripeClient.payInvoice` after setting the new default card, because no browser was available. Fixed:
- The Grace Period deadline was 7 days from the wall clock, so under a test clock the sweep suspended mailboxes 3 days in. Every retry by Stripe also restarted the 7 days and resent the Grace Started email. It now runs 7 days from the failed invoice, and opens once.
- A retry failing after suspension moved the domain back to `grace`.
- `customer.subscription.updated` overwrote the app's status. Arriving after the failure, `past_due` replaced `grace` and the sweep never suspended; arriving before the payment, `active` replaced `suspended` and the mailboxes were never restored. Stripe's `past_due`/`active` no longer overwrite `grace`/`suspended`; the invoice events own those.
- Updating the card didn't charge the outstanding invoice, and the sweep only retries domains still in `grace`, so a suspended Tenant stayed suspended after fixing their card.

### 7. 3-D Secure card triggers action-required; authentication marks the invoice paid

Test card: `4000 0027 6000 3184` (`pm_card_authenticationRequired`) asks for authentication on every charge, including off-session renewals. Use a Tenant on a test clock whose first invoice is paid.

1. **3-D Secure card.** Click **Change card** and pay with `4000 0027 6000 3184` (complete the challenge Checkout shows).
2. **Renewal needs authentication.** Advance the clock past `current_period_end` and wait for `ready`. The `listen` terminal shows `invoice.payment_failed`, `invoice.payment_action_required` and `customer.subscription.updated` (`past_due`) `[200]`.
   Check:
   - `domain_subscriptions` has status `grace` (scenario 6's 7 days apply) and `paymentActionUrl` set to the invoice's `hosted_invoice_url`. `GET /api/tenants/me/billing/summary` returns the same `paymentActionUrl`.
   - Emails: Billing Grace Started, and "Payment authorization required for your Toowix subscription" with the payment link.
   - The Billing page shows **Your bank needs you to approve this payment** with an **Authenticate payment** button, instead of the Payment failed banner.
3. **Authenticate.** Click **Authenticate payment**. On Stripe's invoice page, pay with the card on file and click **Complete** in the test challenge.
   Check: the invoice is `paid`; `invoice.payment_succeeded` `[200]`; status `active`, `paymentActionUrl` `null`; the banner is gone.

Last run 2026-10-19, with the same setup as scenario 6. Steps 1–2 ran live. Browser step verified 2026-10-20: step 3 was run with the Playwright MCP on the hosted invoice link. On **Confirm payment**, Stripe's test challenge opened, and **Complete** paid the invoice; the app returned to `active` with the link cleared. Fixed:
- The Tenant Admin was only emailed; the app had no prompt. The action-required webhook now stores the hosted invoice link, the summary returns it, and the Billing page shows it.

### 8. Cancel one domain, cancel the whole Tenant, and resume each

Test card: `4242 4242 4242 4242`. Use a Tenant on a test clock (scenario 2) with **two** domains on the same subscription (scenario 4), each with an active mailbox. Cancellation only ever happens in the app (ADR-0001); never cancel in the Stripe Dashboard.

1. **Cancel the Tenant.** On the Billing page click **Cancel subscription** and confirm.
   Check: `stripe subscriptions retrieve sub_...` has `cancel_at_period_end: true` and **both** items still present. Both `domain_subscriptions` rows have `cancelAtPeriodEnd: true`. The Billing page shows "Cancels at the end of the current period (…)" and a **Resume subscription** button. Domains and mailboxes stay `active`.
2. **Resume the Tenant.** Click **Resume subscription**.
   Check: `cancel_at_period_end: false` in Stripe and on both rows; the banner is gone. `customer.subscription.updated` `[200]`.
3. **Cancel one domain.** `POST /api/tenants/me/billing/domains/:id/cancel` for the second domain (there is no button for this).
   Check: the Stripe subscription now has one item; the other domain's item and `cancel_at_period_end: false` are untouched. The cancelled domain's row is `canceled` and **stays** `canceled` after `customer.subscription.updated` arrives. That domain and its mailboxes are `suspended` straight away (in Stalwart too), since its item is no longer billed. The other domain is still `active`. There is no per-domain resume: once the item is removed the cancellation has already taken effect. To bring the domain back, pick a Plan for it again (`POST /api/tenants/me/billing/domains/:id/select-plan`). Check: a new item is added with the domain's active users as its quantity, and the domain and its mailboxes are `active` again.
4. **Cancel the last domain, then resume.** Cancel the remaining domain the same way.
   Check: the subscription gets `cancel_at_period_end: true` (it is not deleted, and the item is kept); the domain stays `active` until period end. Clicking **Resume subscription** clears it again.
5. **Cancellation takes effect.** Cancel the Tenant again, then advance the clock to one hour past `current_period_end` and wait for `ready`. The `listen` terminal shows `customer.subscription.deleted` `[200]`.
   Check: Stripe status `canceled`; every row still on the subscription `canceled` with `retentionEndsAt` set (a domain cancelled on its own in step 4 was already `canceled`, without one); every domain and its mailboxes `suspended` in the app and in Stalwart. Data is kept.
6. **Come back.** Before this step, suspend one mailbox yourself on the Users page. Open the Cart: it says "Your subscription has ended", shows today's charge, and has no trial or promo code. Picking a Plan for a domain now saves the Plan without touching Stripe. Click **Ready for Checkout** and pay with `4242 4242 4242 4242`.
   Check: the Checkout page shows a charge today and no trial. `checkout.session.completed` `[200]`. `tenants.stripeSubscriptionId` is the new `sub_...`, and `trialStartedAt` and `cardFingerprint` are unchanged. The new subscription is `active` with one item per planned domain that has users, and its quantity excludes the mailbox you suspended. Every row is on the new subscription with status `active`, `trialEnd: null` and `retentionEndsAt: null`. The domains and their mailboxes are `active` again in the app and in Stalwart, except the one you suspended, which stays `suspended`. The first invoice is `paid`.

Last run 2026-10-20, set up like scenario 6 (separate database, Stalwart stubbed, subscription created by API and adopted, service calls in place of the buttons). Fixed:
- `customer.subscription.updated` set a domain cancelled on its own back to `active` (and the invoice events could put it in grace or reactivate it). Cancelling the last remaining domain then saw a phantom sibling and tried to remove its item, which Stripe rejects ("A subscription must have at least one active plan"). Subscription events now leave `canceled` rows alone.
- **Cancel subscription** on the Billing page cancelled each domain one at a time before cancelling the Tenant, so every domain but the last was removed from billing immediately and **Resume** couldn't bring them back. Errors were swallowed. It now only schedules the Tenant cancellation and shows any error.
- Deleting a domain cancelled the whole shared subscription at once, ending billing for every other domain of the Tenant (and, with the next fix, it would have suspended them). It now removes only that domain's item while other domains remain.
- A cancellation taking effect left the domains and mailboxes `active`, so mail kept working unbilled. Cancelling one domain off a shared subscription now suspends it at once; `customer.subscription.deleted` suspends every domain it covered that the Tenant owns. It skips domains already cancelled on their own and rows on the shared platform domain.
- (Issue 13) Picking a Plan again for a cancelled domain billed it again but left its mail suspended. It now reactivates the domain, and suspends it again if Stripe refuses the new item. Suspension and reactivation now only touch a domain the row's own Tenant owns, so they never reach the shared platform domain. Payment no longer switches on mailboxes still on billing hold.

### 9. Replaying a delivered webhook produces no further change

Run this against the backend HTTP API using either the Stripe CLI (`stripe events resend evt_...`) or signed HTTP POST requests to `/api/webhooks/stripe`.

1. **Missing and invalid signatures.** Send a POST to `/api/webhooks/stripe` without a `Stripe-Signature` header, and then with a signature generated from an attacker secret.
   Check: both requests return 400 (`MISSING_SIGNATURE` and `STRIPE_WEBHOOK_SIGNATURE_INVALID`). No row is added to `stripe_events` and no app state changes.
2. **First delivery.** Send a signed webhook event with a new event ID (e.g. `customer.subscription.trial_will_end` or `invoice.payment_failed`).
   Check: the endpoint responds 200 `{ "received": true }`. The event ID is recorded in `stripe_events`, the domain/subscription state is updated, and the expected email notice is dispatched.
3. **Replaying the delivered event.** Resend the exact same signed event (same `id`).
   Check: the endpoint responds 200 `{ "received": true }`. The duplicate insert on `stripe_events.eventId` is caught (E11000), leaving Tenant, DomainSubscription, and Mailbox state unchanged and sending no duplicate email.
4. **Forced handler failure & retry.** Send an event whose processing throws an error (e.g. transient network or database failure).
   Check: the endpoint logs the error and responds 500 `{ "error": "WEBHOOK_HANDLER_ERROR" }`, telling Stripe to retry. The event ID is cleaned up from `stripe_events`. When the retry arrives and succeeds, it responds 200 and records the event ID. A subsequent replay of the retried event is skipped cleanly.

Last run 2026-10-19. Live run executed against Stripe test mode and verified with mocked regression suite. Fixed:
- `StripeEventModel.createIndexes()` was omitted from `connectDatabase`, risking missing unique indexes when `autoIndex` is disabled.

### 10. A coupon extends the Trial

Run this on the Tenant from scenario 1 while its Trial is running.

1. Create a coupon in super-admin (Coupons → New, for example 15 extra days).
2. In the tenant-admin Cart, open **Have a promo code?**, enter the code and click **Apply**.
   Check: the notice says "Added 15 bonus trial days", the Cart's "Ends …" moves by 15 days, and `tenants.trialEndsAt` and `domain_subscriptions.trialEnd` equal the subscription's new `trial_end`. Stripe shows status `trialing` and a ₹0 `subscription_update` invoice; nothing is charged.
3. Wait for the webhooks (`customer.subscription.updated` and `invoice.payment_succeeded`, both `[200]`).
   Check: the domain row is still `trialing`, not `active`.
4. Apply the same code again, and then a made-up one.
   Check: the first is refused with "This coupon has reached its redemption limit." and the second with "Invalid coupon code.". `trial_end` doesn't move.
5. Before a Trial starts, a code is entered in the Cart before Checkout instead: Checkout opens with `60 + N` trial days, and the code is recorded when the session is adopted.

Last run 2026-10-19. Fixed: redeeming during a Trial used to change nothing, either in the app or in Stripe.

## Reconcile and billing views (after all ten scenarios)

1. Run `npm run job -- reconcile`.
   Check: `driftCorrected: 0` and no `Failed reconciling` line.
2. Prove it can see drift: set a domain's item quantity in Stripe by hand (`stripe subscription_items update si_... --quantity=5 --proration-behavior=none`), run it again.
   Check: `driftCorrected: 1`, a `Drift detected` line, and the item is back to the domain's Active User count.
3. For each Tenant, compare `GET /api/tenants/me/billing/summary`, `GET /api/tenants/me/billing/invoices` and the super-admin `GET /api/platform/tenants/:id` (its `billing`) with `stripe subscriptions retrieve sub_...` and `stripe invoices list --customer=cus_...`.
   Check: status, cancel-at-period-end, period end, each domain's Active Users × per-user price, and the total all match the subscription's items; the invoice list is Stripe's, same ids, amounts and statuses. A cancelled Tenant shows no subscription and a total of 0.

Last full run 2026-10-20, all ten scenarios in order from a fresh database, with real Checkout (including the 3-D Secure challenge and the hosted invoice) in a browser via Playwright. As in scenarios 6–8, rows were in a separate database (`toowix_e2e09`), Stalwart and outbound email were stubbed, the Tenant Admin's buttons were their API calls, and domains were created through the API without DNS. Fixed:
- The reconcile job never matched an item to its domain (it read domain metadata off an unexpanded product), so it always reported no drift. It now finds each item's domain through `domain_subscriptions`, and skips cancelled subscriptions, which Stripe refuses to change.
- A card already used for another Tenant's Trial was refused only after the Trial dates were saved, so the Tenant looked trialing, the return trip released its held mailboxes, and Checkout's subscription would have charged at trial end. It is now refused before anything is saved, and the subscription is cancelled.
- Two mailbox changes in quick succession sent concurrent quantity updates to Stripe; when they landed out of order Stripe kept the older count (billed 3 with 4 active). Each domain's syncs now run in order.
- Upgrading to a Plan another domain of the Tenant was already on failed in Stripe ("You cannot set the quantity for metered plans"), and a downgrade to such a Plan would have reused the same price, which Stripe refuses on one subscription. Plan changes now give the domain its own per-user price, like a newly added domain.
- A scheduled downgrade replaced the first item of the subscription, not necessarily the domain's own.
- When the downgrade started, Stripe's replacement item was not followed, so later quantity syncs, reconcile and cancel pointed at a deleted item.
- A second downgrade while the first one's schedule was still attached failed ("already attached to a schedule"); it now reuses that schedule, and a domain downgraded twice before renewal gets the later Plan.

