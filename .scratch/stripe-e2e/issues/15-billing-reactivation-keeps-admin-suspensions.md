# 15: Billing reactivation doesn't undo a Tenant Admin's own mailbox suspensions

**What to build:** `reactivateDomainForPayment` sets every billed mailbox on the domain back to `active`, both on payment recovery and when a cancelled domain gets a Plan again (issue 13). This includes mailboxes the Tenant Admin suspended deliberately, for example for someone who left. After a late payment, that person's mailbox works again and counts toward the bill. Record why a mailbox was suspended, by billing or by an admin, and have billing reactivation only undo billing suspensions. The billing suspensions are in `suspendDomainForNonPayment` (grace sweep, cancellation, subscription ended).

Spec story 16: "I want suspending a mailbox to stop it counting toward my bill, so that I'm not charged for people who've left."

**Blocked by:** 13: Suspension stays inside the Tenant; choosing a Plan again restores a cancelled domain

**Status:** ready-for-agent

- [ ] A mailbox suspended by the Tenant Admin stays suspended after the domain is suspended for non-payment and then restored by payment
- [ ] The same holds when a cancelled domain is given a Plan again
- [ ] Mailboxes suspended by billing are restored as today
- [ ] Billed Active User counts match after restoration
- [ ] Every fix has a regression test
