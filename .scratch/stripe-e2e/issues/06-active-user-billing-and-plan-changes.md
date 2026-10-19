# 06: Billed Active Users, plus upgrade and downgrade

**What to build:** Scenarios 3 and 5. Adding mailboxes and suspending mailboxes changes the Active User count billed on the next invoice; suspended mailboxes are not billed and the Plan's user ceiling is never what's charged. Upgrading or downgrading a domain's Plan is reflected in Stripe and on the next invoice; a downgrade to a Plan whose ceiling is below the domain's current Active Users is refused or flagged. Fix whatever fails, with a regression test per fix.

**Blocked by:** 03: Trial ends and the first invoice is paid

**Status:** ready-for-agent

- [ ] After adding mailboxes, the next invoice quantity equals the Active User count
- [ ] Suspending a mailbox lowers the billed count on the next invoice
- [ ] Upgrade and downgrade change the domain's item price in Stripe and the next invoice amount
- [ ] A downgrade below current Active Users is refused or flagged with a clear message
- [ ] Every fix has a regression test
- [ ] Runbook sections for scenarios 3 and 5 written
