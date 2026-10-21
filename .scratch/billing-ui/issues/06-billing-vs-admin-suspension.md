# 06: Billing vs admin suspension on mailboxes

**What to build:** A Tenant Admin can tell why a mailbox is suspended, and can't switch a billing-suspended one back on without paying.

- The mailbox list sends the existing admin-suspended flag.
- A suspended mailbox is labelled **Suspended – by admin** when the flag is set and **Suspended – billing** otherwise. Mailboxes waiting for activation keep their existing label and behaviour.
- **Reactivate** is hidden on billing-suspended mailboxes, with a hint that paying restores them.
- The backend refuses to reactivate a suspended mailbox that is neither admin-suspended nor on activation hold, with `402` `PAYMENT_REQUIRED` ("Pay the outstanding invoice to restore this mailbox"). Billing's own reactivation (payment recovered, Plan chosen again) is unaffected.

Spec: `.scratch/billing-ui/spec.md`, stories 29–33. Extends stripe-e2e issue 15.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The mailbox list includes the admin-suspended flag (route test)
- [x] Reactivating a billing-suspended mailbox returns 402 `PAYMENT_REQUIRED`; an admin-suspended one still reactivates; activation hold is unchanged (route tests)
- [x] Payment recovery still restores billing-suspended mailboxes (existing tests pass)
- [x] Labels and hidden Reactivate in the mailbox list (component test)
