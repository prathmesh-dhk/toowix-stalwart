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

A customer can only join a test clock when it is created, so use a **new** Tenant and create its Stripe customer on the clock before its first Checkout. The app reuses `tenants.stripeCustomerId` when it is set. Stripe CLI times are Unix seconds. In PowerShell, `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()` gives the current time and `[DateTimeOffset]::FromUnixTimeSeconds(<t>)` turns one back into a date.

1. Create the clock and the customer:
   ```
   stripe test_helpers test_clocks create --frozen-time=<now> --name="e2e <tag>"
   stripe customers create --email=<contact email> --name="<tenant name>" --test-clock=clock_...
   ```
   In Mongo, run `db.tenants.updateOne({ _id: ObjectId("<tenant id>") }, { $set: { stripeCustomerId: "cus_..." } })`.
2. Run scenario 1, steps 1 to 4: add a domain, create a mailbox (or two), then pay Checkout with `4242 4242 4242 4242`.
   Check: the Trial dates equal the subscription's `trial_start` and `trial_end`, which follow the clock's time.
3. **Default card.** On the Billing page, click **Change card** and pay with `5555 5555 5555 4444`. Then click **Set default** on the 4242 card.
   Check: the Billing page marks 4242 as default, and `stripe subscriptions retrieve sub_...` shows `default_payment_method` set to the 4242 card's `pm_...`.
4. **Reminder.** Advance the clock to day 46 (`stripe test_helpers test_clocks advance clock_... --frozen-time=<trial_start + 46 days>`). Wait until `stripe test_helpers test_clocks retrieve clock_...` shows `"status": "ready"`. Then run the sweep as of the clock's time:
   ```
   npm run job -- trial 2026-12-04T13:00:00Z
   ```
   Check: it prints `{ reminded: 1 }` and logs `[EMAIL DISPATCH: SUCCESS] Billing notice "Reminder: Your Toowix trial ends in 14 days"`. A `FALLBACK` line means the email wasn't delivered and the reminder isn't recorded, so the next run retries it. Locally, port 2525 is the Stalwart container, which refuses relay to outside addresses. Point `SMTP_HOST`/`SMTP_PORT` at any local SMTP sink for this one command.
5. **Trial end.** Advance the clock to one hour past `trial_end`, then wait for `ready` again. The `listen` terminal shows `invoice.payment_succeeded` and `customer.subscription.updated`, both `[200]`.
   Check:
   - `stripe invoices list --customer=cus_...` has a `subscription_cycle` invoice, `paid`, for Active Users × the Plan's per-user price (2 × ₹49 = ₹98 on Starter).
   - `stripe charges list --customer=cus_... --limit=1` shows the 4242 card from step 3, not the newer 5555 card.
   - `domain_subscriptions` has status `active`, and its `currentPeriodEnd` equals the subscription item's `current_period_end`. `GET /api/tenants/me/billing/summary` returns the same values.
   - The Billing page's invoice list shows the ₹98.00 paid invoice above the ₹0 trial invoice.
6. Optionally, advance one more month. The renewal is charged to the same card, and `currentPeriodEnd` moves with it.
7. Clean up: `stripe test_helpers test_clocks delete clock_...` also deletes the clock's customer and subscription.

Last run 2026-10-19. Hosted Checkout was replaced by an API-created subscription of the same shape, which was then passed to the app's own adoption code, because no browser was available. The domain and mailboxes were seeded in Mongo, so nothing touched the shared Stalwart. Fixed:
- `npm run job` couldn't run a sweep as of a test clock's time, so the reminder couldn't fire before the Trial ended. It now takes an optional date.
- A reminder whose email failed to send was still marked as sent, and was never retried.
- **Set default** changed only the customer's default card. Stripe kept charging the subscription's card from Checkout or the last card update. The Billing page also always marked the newest card as default. Both now follow the card the Tenant Admin picks.

### 3. Adding and suspending mailboxes changes the billed Active User count

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

### 6. Failed payment opens the Grace Period; suspension after 7 days; paying restores

### 7. 3-D Secure card triggers action-required; authentication marks the invoice paid

### 8. Cancel one domain, cancel the whole Tenant, and resume each

### 9. Replaying a delivered webhook produces no further change

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
