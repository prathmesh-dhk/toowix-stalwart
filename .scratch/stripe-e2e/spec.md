# Spec: Prove Stripe billing end-to-end in test mode

Status: ready-for-agent

## Problem Statement

Toowix already has a full billing implementation: a Tenant is one Stripe customer, each domain carries a Plan billed per Active User per month in INR, there's a 60-day Trial, a Grace Period with suspension, coupons, saved cards, upgrade/downgrade/cancel/resume, and a webhook handler. It has a large mocked test suite, but nobody has proven it works against a real Stripe account. The Tenant Admin can't trust that signing up, being charged, failing a payment or cancelling will behave as designed until it's been run for real, and the developer has no repeatable way to check.

A reference Stripe controller from an unrelated product (per-user Standard/Pro flat plans, Customer Portal, yearly prices) prompted this work. Its model doesn't apply here and isn't being adopted.

## Solution

Connect the existing billing to the developer's Stripe test account, run ten end-to-end scenarios against real Stripe test mode (webhooks forwarded by the Stripe CLI, time advanced with test clocks), and fix every failure found. Each fix lands with a regression test at the existing mocked-`stripeClient` seam, so the behaviour stays proven after this work ends. The ten scenarios are kept as a repeatable runbook.

## User Stories

### Setup

1. As a developer, I want the backend to run locally against my Stripe test account, so that I can see real Stripe objects created by the app.
2. As a developer, I want to start from a freshly seeded local database, so that no Stripe IDs from another Stripe account are left on Plans or Tenants.
3. As a developer, I want webhooks delivered to my local backend through the Stripe CLI, so that I can exercise the webhook handler without deploying.
4. As a developer, I want the webhook signing secret to come from the Stripe CLI session, so that signature verification is exercised for real.
5. As a developer, I want Stripe prices and meters for each Plan to be created lazily on first use under my account, so that I don't have to configure price IDs by hand.
6. As a developer, I want a written runbook for the ten scenarios, so that I can re-run the whole check after any billing change.

### Trial and first mailbox

7. As a Tenant Admin, I want to create domains and pick Plans without entering a card, so that I can set up before committing.
8. As a Tenant Admin, I want to be asked for a card when I create my first mailbox, so that the Trial only starts when I actually use the product.
9. As a Tenant Admin, I want the mailbox I was creating to be created once my card is saved, so that I don't lose what I typed.
10. As a Tenant Admin, I want my Trial to start when my first mailbox is created on any domain, so that the 60 days aren't consumed while I'm still configuring.
11. As a Tenant Admin, I want to see when my Trial ends, so that I know when I'll first be charged.
12. As a Tenant Admin, I want a reminder before my Trial ends, so that I'm not surprised by the first charge.
13. As a Tenant Admin, I want a valid coupon to add days to my Trial, so that a promotion I was given takes effect.

### Charging

14. As a Tenant Admin, I want to be charged automatically when my Trial ends, so that my service continues without action.
15. As a Tenant Admin, I want to be billed only for Active Users, not for my Plan's user ceiling, so that I pay for what I use.
16. As a Tenant Admin, I want suspending a mailbox to stop it counting toward my bill, so that I'm not charged for people who've left.
17. As a Tenant Admin, I want all my domains on one combined monthly invoice, so that I deal with one bill.
18. As a Tenant Admin, I want a second domain to join my existing subscription rather than start a new one, so that billing stays consolidated.
19. As a Tenant Admin, I want to see my past invoices in the app, so that I can check what I paid.
20. As a Tenant Admin, I want my saved default card to be used for charges, so that I control which card pays.
21. As a Tenant Admin, I want to add, remove and set a default card in the app, so that I can keep payment details current.

### Plan changes

22. As a Tenant Admin, I want to upgrade a domain's Plan, so that I can raise its user ceiling.
23. As a Tenant Admin, I want to downgrade a domain's Plan, so that I can pay a lower per-user rate when I need fewer users.
24. As a Tenant Admin, I want a downgrade to be refused or flagged when the domain has more Active Users than the new Plan allows, so that I don't end up over the ceiling silently.
25. As a Tenant Admin, I want plan changes reflected on my next invoice, so that the price I see matches what I pay.

### Payment failure

26. As a Tenant Admin, I want to be told when a payment fails, so that I can fix my card.
27. As a Tenant Admin, I want a 7-day Grace Period after a failed payment before anything is suspended, so that a temporary card problem doesn't cut off email.
28. As a Tenant Admin, I want my mailboxes suspended only after the Grace Period ends without payment, so that suspension is predictable.
29. As a Tenant Admin, I want paying during the Grace Period to clear it and restore normal status, so that I'm not penalised once I've paid.
30. As a Tenant Admin, I want a payment needing 3-D Secure to prompt me to authenticate, so that Indian card mandates don't silently fail.
31. As a Tenant Admin, I want a payment completed after authentication to be treated as paid, so that my account returns to good standing.

### Cancel and resume

32. As a Tenant Admin, I want to cancel billing for one domain, so that I can stop paying for a domain I no longer use.
33. As a Tenant Admin, I want to cancel billing for my whole Tenant, so that I can leave the platform.
34. As a Tenant Admin, I want to resume a cancellation before it takes effect, so that I can change my mind.
35. As a Tenant Admin, I want cancellation to apply the same in-app consequences however it's triggered, so that domains and mailboxes end up in a consistent state.

### Reliability

36. As a developer, I want a webhook delivered twice to change nothing the second time, so that Stripe retries can't double-apply effects.
37. As a developer, I want a webhook with a bad signature rejected, so that forged events can't change billing.
38. As a developer, I want a transient handler failure to return an error status, so that Stripe retries the delivery.
39. As a developer, I want the nightly reconcile job to agree with Stripe after all scenarios run, so that the app's state and Stripe's state haven't drifted.
40. As a developer, I want every fix to come with a regression test, so that the end-to-end behaviour stays proven without a live Stripe account.

### Visibility

41. As a super admin, I want to see a Tenant's billing status accurately in the super-admin app, so that support can answer billing questions.
42. As a Tenant Admin, I want my billing summary to match what Stripe actually charged, so that I trust the numbers.

## Implementation Decisions

- **No new billing model.** Billing stays Tenant-level, per domain, per Active User, monthly, INR. Plans remain database records managed in super-admin, with Stripe prices and meters created lazily per Plan.
- **No Customer Portal** (ADR-0001). All billing changes go through the tenant-admin app so domain-level consequences (Grace Period, suspension, holds) always run.
- **Reference product artefacts are unused.** The Standard/Pro product and price IDs and the pasted webhook secret belong to another product and are not configured anywhere.
- **Environment.** Test-mode secret and publishable keys go in the backend's local env file only. The webhook secret is the one printed by the Stripe CLI's listen session forwarding to the backend's Stripe webhook endpoint.
- **Fresh data.** The local database is dropped and re-seeded before the run, so lazily-created Stripe IDs are all minted under the current account.
- **Time-based scenarios use Stripe test clocks.** The Tenant's Stripe customer is attached to a test clock for the Trial-end and Grace-Period scenarios; the app's own sweep jobs (grace sweep, trial reminder, reconcile) are triggered on demand by their run-once entry points rather than waiting for their intervals.
- **Scope of change is fixes only.** Modules expected to change are the billing service, the Stripe client wrapper, the webhook route and its event handling, the sweep jobs, and the tenant-admin billing UI. Public API contracts change only where a scenario proves them wrong.
- **One ticket per failing scenario**, filed under this spec's `issues/` folder. A scenario that passes needs no ticket.
- **The ten scenarios** (the definition of done):
  1. First mailbox requires a card and starts the Trial.
  2. Trial ends (test clock) and the first invoice is paid.
  3. Adding and suspending mailboxes changes the billed Active User count.
  4. A second domain joins the same subscription and the same invoice.
  5. Upgrade and downgrade a domain's Plan.
  6. Failed payment opens the Grace Period; after 7 days (test clock + grace sweep) mailboxes are suspended; paying restores them.
  7. A 3-D Secure card triggers the action-required flow and completing authentication marks the invoice paid.
  8. Cancel one domain, cancel the whole Tenant, and resume each.
  9. Replaying a delivered webhook produces no further change.
  10. A coupon extends the Trial.

## Testing Decisions

- **A good test checks external behaviour**: given a Stripe event or a billing-service call, assert the resulting Tenant, DomainSubscription and Mailbox state and any emails sent. Don't assert which internal helpers ran or how many Stripe calls were made unless the call itself is the observable effect.
- **Live seam (discovery only):** the backend HTTP API plus the Stripe webhook endpoint, against real Stripe test mode. Used to run the ten scenarios; not automated in CI.
- **Regression seam (every fix):** the existing `stripeClient` module boundary, mocked with `vi.mock`, on an in-memory MongoDB. Each fix's test feeds the billing service or webhook handler the event shape observed during the live run. No new seam is introduced and no automated test calls Stripe.
- **Prior art:** the backend's billing service, billing routes, billing phase 0/3/4-5 and grace sweep tests already use this exact pattern, along with the shared test factories.
- **Frontend fixes** follow the tenant-admin component tests for the billing view and cart.

## Out of Scope

- Stripe Customer Portal (ADR-0001).
- Yearly billing or prepaid seats.
- The reference product's Standard/Pro plans, per-user billing, storage tiers and file retention.
- Live-mode launch, Stripe India account activation, and RBI e-mandate setup beyond what test mode exercises.
- Deployed-environment webhook endpoint configuration.
- Pricing or Plan catalogue changes.

## Further Notes

- The pasted Stripe test keys appeared in a chat transcript and should be rotated before use.
- The reference controller's defects are a useful list of things to verify are absent here: unchecked session ownership on post-checkout verification, unsigned webhook fallback, unknown plans defaulting to the top tier, duplicate payment records from both a verify endpoint and a webhook, and payment failure with no Grace Period.
- Glossary: Tenant, Tenant Admin, Plan, Active User, Trial, Grace Period.
