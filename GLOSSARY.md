# Toowix Mail Platform

A multi-tenant hosted email platform: companies bring their domains, create mailboxes, and pay for the active users on them.

## Billing

**Tenant**:
The company that signs up and pays. One Tenant is one billing customer, covering all of its domains.
_Avoid_: Account, customer, user (when meaning the payer)

**Tenant Admin**:
A person who manages a Tenant and is the only one who sees or changes its billing.
_Avoid_: Owner, billing user

**Plan**:
A super-admin-defined offering assigned to a domain, with a user ceiling and a monthly price per active user.
_Avoid_: Package, tier, Standard/Pro (names from an unrelated product)

**Active User**:
A mailbox that counts toward a domain's bill for the month; suspended mailboxes are not Active Users.
_Avoid_: Seat (a Plan's ceiling is not what is billed)

**Trial**:
The Tenant's single 60-day free period, starting when its first mailbox is created on any domain.
_Avoid_: Free plan

**Grace Period**:
The 7 days after a failed payment before the Tenant's mailboxes are suspended.
_Avoid_: Dunning window, past-due period
