# 16: What an expired Grace Period does on the shared platform domain

**What to build:** Since issue 13, suspension only touches a domain the row's own Tenant owns. On the shared platform domain, a Tenant's `domain_subscriptions` row (keyed `{domainId, tenantId}`, `mailboxLimit` from the Plan's seat count) goes to `suspended` when its Grace Period expires, but nothing else happens: that Tenant's platform mailboxes stay on. Decide what the consequence should be, then implement it scoped to that Tenant's own mailboxes (`MailboxModel` `{ domainId, tenantId }`), never the domain itself.

**Open question (needs-info):** what do platform-domain rows bill for? The Tenant Admin's login identity is a mailbox on the platform domain (`public.routes.ts`, `createPlatformIdentityMailbox`). Suspending it in Stalwart could lock the Tenant Admin out of the app they need to pay in. Options:
- Suspend only that Tenant's non-identity platform mailboxes.
- Make them read-only.
- Leave them on and rely on the Tenant's own domains being suspended.

**Blocked by:** 13: Suspension stays inside the Tenant; choosing a Plan again restores a cancelled domain

**Status:** needs-info

- [ ] The agreed consequence applies to that Tenant's platform mailboxes only; the platform domain and other Tenants are untouched
- [ ] The Tenant Admin can still sign in and pay
- [ ] Payment restores exactly what was suspended
- [ ] Every fix has a regression test
