# 07: Failed payment and Grace Period, plus 3-D Secure

**What to build:** Scenarios 6 and 7. With a declining test card as default, a renewal fails: the Grace Period opens and the Tenant Admin is notified. Advancing the test clock past 7 days and running the grace sweep suspends the mailboxes; paying restores them and clears the Grace Period. Separately, with a 3-D Secure test card, a renewal triggers the action-required flow, the Tenant Admin is prompted to authenticate, and completing it marks the invoice paid and returns the account to good standing. Fix whatever fails, with a regression test per fix.

**Blocked by:** 03: Trial ends and the first invoice is paid

**Status:** ready-for-agent

- [ ] A declined renewal opens the Grace Period and sends the failure notice
- [ ] Nothing is suspended before the Grace Period ends
- [ ] After 7 days (test clock + grace sweep), the Tenant's mailboxes are suspended
- [ ] Paying the outstanding invoice restores mailboxes and clears the Grace Period
- [ ] A 3-D Secure renewal prompts the Tenant Admin to authenticate in the app
- [ ] Completing authentication marks the invoice paid and the account in good standing
- [ ] Every fix has a regression test
- [ ] Runbook sections for scenarios 6 and 7 written, including which test cards to use
