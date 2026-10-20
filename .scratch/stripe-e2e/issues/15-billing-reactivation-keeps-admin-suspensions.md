# 15: Billing reactivation doesn't undo a Tenant Admin's own mailbox suspensions

**What to build:** `reactivateDomainForPayment` sets every billed mailbox on the domain back to `active`, both on payment recovery and when a cancelled domain gets a Plan again (issue 13). This includes mailboxes the Tenant Admin suspended deliberately, for example for someone who left. After a late payment, that person's mailbox works again and counts toward the bill. Record why a mailbox was suspended, by billing or by an admin, and have billing reactivation only undo billing suspensions. The billing suspensions are in `suspendDomainForNonPayment` (grace sweep, cancellation, subscription ended).

Spec story 16: "I want suspending a mailbox to stop it counting toward my bill, so that I'm not charged for people who've left."

**Blocked by:** 13: Suspension stays inside the Tenant; choosing a Plan again restores a cancelled domain

**Status:** done

- [x] A mailbox suspended by the Tenant Admin stays suspended after the domain is suspended for non-payment and then restored by payment
- [x] The same holds when a cancelled domain is given a Plan again
- [x] Mailboxes suspended by billing are restored as today
- [x] Billed Active User counts match after restoration
- [x] Every fix has a regression test

**Done (2026-10-20):** admin suspensions are recorded (`Mailbox.adminSuspended`, set by `suspendMailbox`, cleared by `reactivateMailbox`) rather than billing ones, so mailboxes billing suspended before this change still come back. Billing reactivation and the Super Admin Tenant restore both skip flagged mailboxes. Known limit: mailboxes a Tenant Admin suspended before this shipped have no flag, so the next billing restore still revives them.
