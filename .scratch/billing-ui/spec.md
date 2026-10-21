# Spec: Billing UI catches up with the billing backend

Status: ready-for-agent

## Problem Statement

The stripe-e2e work made billing behave correctly against real Stripe, but most of it never reached the screens people use.

A Tenant Admin picks a Plan for a domain once, at the end of domain setup, and then can never change it. The upgrade, downgrade and per-domain cancel calls exist on the backend and in the app's API client, but no screen calls them. When a downgrade is scheduled (for example by support), nothing on the Billing page says so. When a payment fails, the banner says mail keeps working "for now" without saying until when, although the backend knows the Grace Period's end. A mailbox suspended because the Tenant didn't pay looks the same as one the Tenant Admin suspended on purpose. The Tenant Admin can even switch a billing-suspended mailbox back on without paying.

The Super Admin's Plan form still offers a "fixed" billing mode, and new Plans default to it, although every Plan now bills per Active User. On a Tenant's Billing tab the Super Admin sees the subscription id, its status and a per-domain table, but not when the Trial or period ends, whether it is cancelling, when the Grace Period runs out, what downgrades are pending, or what the Tenant has been invoiced. Answering a Tenant's billing question means opening the Stripe dashboard.

## Solution

On the Billing page, each domain gets the actions the backend already supports. **Change plan** opens a dialog of Plans with their price per Active User and what the domain would cost a month. An upgrade starts now and is prorated. A downgrade starts at period end and shows on the domain as a pending change, with **Keep current plan** to undo it. **Cancel this domain** says honestly whether mail stops now or at period end. A cancelled domain offers **Choose a plan again**. The payment-failed banner gives the date mail stops.

Suspended mailboxes say whether billing or an admin suspended them. Only admin suspensions can be reactivated from the mailbox list, and the backend enforces the same rule.

The Super Admin's Plan form has a single price per Active User and no billing mode. A Tenant's Billing tab shows the subscription's dates and state, each domain's pending downgrade, and the Tenant's invoices. It stays read-only, apart from the existing **Sync with Stripe**.

## User Stories

### Tenant Admin: changing a domain's Plan

1. As a Tenant Admin, I want a **Change plan** action on each domain in Billing, so that I can move a domain to a different Plan without contacting support.
2. As a Tenant Admin, I want the Change plan dialog to list every active Plan with its price per Active User, so that I can compare them.
3. As a Tenant Admin, I want each Plan in the dialog to show what this domain would cost per month at its current Active Users, so that I know the effect on my bill before I choose.
4. As a Tenant Admin, I want the domain's current Plan marked in the dialog, so that I don't pick it by mistake.
5. As a Tenant Admin, I want a higher-priced Plan to say "Starts now; the difference is prorated on your next invoice", so that I'm not surprised by the charge.
6. As a Tenant Admin, I want a lower-priced Plan to say it starts on the date the current period ends, so that I know I keep the current Plan until then.
7. As a Tenant Admin, I want a Plan whose user ceiling is below the domain's current Active Users to be disabled with the reason shown, so that I understand why I can't pick it and what to change first.
8. As a Tenant Admin, I want an upgrade to show the new Plan and price on the domain straight away, so that I can see it took effect.
9. As a Tenant Admin, I want a refused plan change to show the backend's message, so that I know what went wrong and the domain's Plan is unchanged.
10. As a Tenant Admin, I want the Change plan action available on both the organisation-wide Billing page and a single domain's billing view, so that I find it wherever I'm looking.
11. As a Tenant Admin, I want the Change plan action hidden when billing is disabled or the domain has no billed subscription yet, so that I'm not offered something that can't work.

### Tenant Admin: pending downgrades

12. As a Tenant Admin, I want a domain with a scheduled downgrade to show "Moves to <Plan> on <date>", so that I know a change is coming.
13. As a Tenant Admin, I want a **Keep current plan** action on a pending downgrade, so that I can change my mind before it takes effect.
14. As a Tenant Admin, I want **Keep current plan** to remove the pending change from both the app and Stripe, so that the renewal invoice charges the Plan I'm on.
15. As a Tenant Admin, I want an upgrade made while a downgrade is pending to replace the pending downgrade, so that only my latest choice applies.
16. As a Tenant Admin, I want a second downgrade before renewal to replace the first one in the pending badge, so that the badge always shows what will happen.
17. As a Tenant Admin, I want the monthly total on the Billing page to show today's charges, not the pending Plan's, so that it matches my next invoice until the change takes effect.

### Tenant Admin: cancelling and returning a domain

18. As a Tenant Admin, I want a **Cancel this domain** action on each domain, so that I can stop paying for a domain I no longer need without cancelling everything.
19. As a Tenant Admin with several domains, I want the cancel confirmation to say the domain's mail stops now and it comes off my bill, so that I know the consequence before I confirm.
20. As a Tenant Admin with only one domain, I want the cancel confirmation to say this cancels my subscription at the end of the period, with the date, and that mail keeps working until then, so that I know the consequence before I confirm.
21. As a Tenant Admin, I want a domain I cancelled to show as cancelled with **Choose a plan again**, so that I can bring it back.
22. As a Tenant Admin, I want **Choose a plan again** to put the domain back on the bill and switch its mail back on, so that billing and mail restart together.
23. As a Tenant Admin, I want mailboxes I suspended myself to stay suspended when a domain comes back, so that people who've left don't get their mail back.
24. As a Tenant Admin, I want the whole-subscription Cancel and Resume to keep working as they do now, so that nothing I rely on changes.

### Tenant Admin: payment problems

25. As a Tenant Admin whose payment failed, I want the banner to say "Mail stops on <date> unless you pay", so that I know how long I have.
26. As a Tenant Admin whose payment failed, I want the banner's **Update card** to stay where it is, so that I can fix it in one step.
27. As a Tenant Admin whose bank needs 3-D Secure, I want the existing **Authenticate payment** banner unchanged, so that I can still complete the payment.
28. As a Tenant Admin whose Grace Period has expired, I want the suspended banner unchanged, so that I still see how to restore mail.

### Tenant Admin: suspended mailboxes

29. As a Tenant Admin, I want a mailbox suspended for non-payment labelled **Suspended – billing**, so that I can tell it apart from one I suspended.
30. As a Tenant Admin, I want a mailbox I suspended labelled **Suspended – by admin**, so that I know I can reactivate it.
31. As a Tenant Admin, I want **Reactivate** hidden on billing-suspended mailboxes, with a hint that paying restores them, so that I'm pointed to the right fix.
32. As a Tenant Admin, I want a request to reactivate a billing-suspended mailbox refused with "Pay the outstanding invoice to restore this mailbox", so that mail can't be switched on without paying.
33. As a Tenant Admin, I want mailboxes waiting for activation (cart) to keep their existing label and behaviour, so that activation is unchanged.

### Super Admin: Plans

34. As a Super Admin, I want the Plan form to have a single "Price per Active User / month" field and no billing mode choice, so that I can't create a Plan the billing system doesn't support.
35. As a Super Admin, I want the Plan form's user ceiling labelled as the most Active Users a domain on this Plan can have, so that it isn't mistaken for what's billed.
36. As a Super Admin, I want the Plans list to describe every Plan as priced per Active User up to its ceiling, so that the list matches how Tenants are billed.
37. As a Super Admin, I want editing an existing Plan to keep its price and ceiling, so that removing the billing mode doesn't change any Plan.

### Super Admin: a Tenant's Billing tab

38. As a Super Admin, I want a Tenant's Billing tab to show the Trial end, so that I can answer "when will I first be charged?".
39. As a Super Admin, I want it to show the current period end, so that I know when the next invoice is due.
40. As a Super Admin, I want it to show when the subscription is set to cancel at period end, and the date, so that I know the Tenant is leaving.
41. As a Super Admin, I want it to show the Grace Period's end while a payment has failed, so that I know when the Tenant's mail stops.
42. As a Super Admin, I want each domain row to show a pending downgrade's Plan and date, so that I can explain an upcoming invoice change.
43. As a Super Admin, I want each domain row to show when it was cancelled on its own, so that I can tell it from an active domain.
44. As a Super Admin, I want the Tab to list the Tenant's invoices with date, amount and status, so that I can answer payment questions without the Stripe dashboard.
45. As a Super Admin, I want each invoice to link to Stripe's hosted invoice, so that I can see the full detail when I need it.
46. As a Super Admin, I want the Tenant detail page to load even if Stripe is slow or failing, so that billing problems don't hide the rest of the Tenant.
47. As a Super Admin, I want **Sync with Stripe** to keep working as it does now, so that I can still correct drift.

### Developer

48. As a developer, I want the frontend's billing summary type to match what the backend sends, so that the UI can use the fields that already exist without casting.
49. As a developer, I want the dead "fixed" billing branches removed from the backend, so that the code matches the rule that every Plan bills per Active User.
50. As a developer, I want the runbook to cover the new UI actions and the fixes from stripe-e2e issues 10, 12, 14, 15 and 17, so that a future live run checks them against real Stripe.

## Implementation Decisions

- **Tenant billing summary grows, nothing is removed.** Each domain entry adds its pending downgrade (target Plan id and name, and the date it takes effect, which is the current period end), its own cancelled state, and its Grace Period end. The summary's top level adds the Tenant's earliest Grace Period end while one is open. Existing fields keep their names and meaning. The Super Admin's Tenant detail already reuses this summary, so it gets the same fields.
- **Frontend types catch up.** The Tenant Admin's summary type adds the fields the backend already sends (monthly total, per-domain Active Users, user ceiling, price per Active User, subtotal, Trial start) along with the new ones.
- **Cancelled domains stay in the summary.** Today the summary skips cancelled subscription rows. It will include a domain cancelled on its own, marked cancelled and with a zero subtotal, so the Billing page can offer **Choose a plan again**. The monthly total excludes it.
- **New endpoint: keep current plan.** A Tenant Admin `POST` on a domain's downgrade resource that cancels the pending downgrade. It clears the domain's pending downgrade (both the pending Plan and pending price), rebuilds the subscription schedule from the live items through the existing pending-prices path (releasing it when nothing is pending), and records an audit entry. With no pending downgrade it succeeds and changes nothing. The domain must belong to the caller's Tenant.
- **Plan changes reuse the existing upgrade and downgrade endpoints.** The dialog decides upgrade or downgrade by comparing price per Active User with the current Plan, the same comparison the backend makes. It disables Plans whose ceiling is below the domain's current Active Users. The backend still enforces this, and its refusal message is shown if the two disagree.
- **Choose a plan again reuses the existing Plan selection path** that already reactivates a cancelled domain (stripe-e2e issue 13). A Tenant whose whole subscription has ended still goes through the Cart's fresh Checkout (issue 14). Billing does not duplicate that flow.
- **Cancel wording comes from the summary.** The dialog says "stops now" when the Tenant has other domains still billed, and "cancels your subscription at period end" otherwise, matching the backend's existing behaviour. That behaviour does not change.
- **One shared domain-billing component** carries Change plan, the pending badge with Keep current plan, Cancel this domain and Choose a plan again. Both the organisation-wide view and the single-domain view of the Billing page use it.
- **Mailbox list exposes why a mailbox is suspended.** The mailbox shape sent to the Tenant Admin adds the existing admin-suspended flag. The UI labels a suspended mailbox **by admin** when the flag is set and **billing** otherwise. Mailboxes on activation hold keep their existing label.
- **Reactivation guard.** Reactivating a suspended mailbox that is not admin-suspended and not on activation hold is refused with `402` and code `PAYMENT_REQUIRED`. Billing reactivation (payment recovered, Plan chosen again) is unaffected; it doesn't go through this path.
- **Super Admin invoice list.** A Super Admin `GET` on a Tenant's invoices returns the same shape as the Tenant Admin's invoice list, built on the same Stripe listing. The Billing tab loads it when opened, separately from the detail page, so a Stripe failure only affects that list.
- **No billing mode in the Plan form.** The form sends a Plan's price per Active User and its user ceiling. New and edited Plans are saved as per-Active-User. The stored billing mode field stays in the schema for now, but nothing reads it. Backend branches that treat a Plan as fixed-price are deleted.
- **Glossary terms.** UI copy says Plan, Active User, Trial and Grace Period. Copy that says "seat" for the billed count is replaced. The Plan's ceiling may be called "user limit".
- **ADR-0001 holds.** Every new action goes through the app. No Stripe Customer Portal links are added. Hosted invoice links are receipts, which the ADR allows.

## Testing Decisions

- **Good tests check behaviour from the outside.** A backend test sends a real HTTP request and checks the response, the saved rows and the calls made to the mocked Stripe client. A frontend test renders a page with the API mocked, acts like a user (clicks, reads text) and checks what's shown and which API call was made. Neither reaches into internal functions or component state.
- **Seam 1: backend routes over an in-memory database, with the Stripe client mocked.** This covers the new summary fields (pending downgrade, cancelled domain, Grace Period end), Keep current plan (clears the pending downgrade and calls the pending-prices rebuild; Tenant ownership enforced; no-op when nothing is pending), the `402` reactivation guard (billing-suspended refused, admin-suspended allowed, activation hold unchanged), the admin-suspended flag in the mailbox list, the Super Admin invoice endpoint, and Plan create/update without a billing mode. Prior art: the billing routes, billing service, Plans and platform Tenant route tests.
- **Seam 2: Tenant Admin and Super Admin components with the API module mocked.** Covered behaviours: the Change plan dialog (prices, monthly cost, upgrade vs downgrade wording, ceiling-disabled Plans, refusal message), the pending badge and Keep current plan, the cancel dialog's two wordings, Choose a plan again, the Grace Period date in the banner, the suspended mailbox labels and hidden Reactivate, the Plan form without billing mode, and the Tenant Billing tab's dates, pending downgrades and invoice list (including the list's failure state). Prior art: the existing Billing page, Cart page, Tenant Admin dashboard, Plans management and Tenant detail component tests.
- **Fixtures move off "fixed".** Test fixtures that build Plans with the fixed billing mode switch to per-Active-User Plans.
- **Live check, not automated.** The last ticket adds runbook steps for the new UI actions and for stripe-e2e issues 10, 12, 14, 15 and 17, and runs them once in Stripe test mode, driving the browser with Playwright.

## Out of Scope

- Super Admin billing actions: refunds, cancelling or changing Plans for a Tenant, editing a Tenant's subscription. The Billing tab stays read-only apart from Sync with Stripe.
- An exact proration preview from Stripe in the Change plan dialog.
- Making a single domain's cancellation take effect at period end when the Tenant has other domains.
- Dropping the billing mode field from the database or migrating stored Plans.
- Migrating any existing Stripe items still on a shared Plan price (stripe-e2e issue 17).
- The Stripe Customer Portal (ADR-0001).
- Changes to Trial, coupon, card management or Cart activation behaviour.
- Moderators: billing stays Tenant-Admin-only.

## Further Notes

- Decided in a grilling session on 2026-10-21. The backend behaviour this relies on was proven in `.scratch/stripe-e2e/`, issues 06, 08, 13, 14, 15 and 17.
- Platform-domain mailboxes stay on after the Grace Period expires (stripe-e2e issue 16, wontfix). The Grace Period date in the banner refers to the Tenant's own domains.
- Tickets are in `.scratch/billing-ui/issues/` (01–10), each a vertical slice with its blockers listed.
