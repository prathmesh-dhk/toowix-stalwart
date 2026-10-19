# No Stripe Customer Portal: the app is the only place billing changes

We don't use the Stripe Customer Portal, even though it would give Tenant Admins self-service cancellation, plan switching and card management for free. Plans attach per domain, and cancelling or downgrading drives in-app consequences (grace period, mailbox suspension, holds) that a portal-side change would bypass and leave the webhook to reconcile after the fact. Everything the portal offers except hosted receipts already exists in the tenant-admin app, so all billing changes go through it.

## Considered Options

- **Full portal**: rejected; plan changes and cancellations made in Stripe skip domain-level logic.
- **Read-only portal (invoices only, cancel and plan switching disabled)**: acceptable later if hosted receipts become worth it; not needed now.
