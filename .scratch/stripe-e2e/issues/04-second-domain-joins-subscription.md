# 04: A second domain joins the same subscription

**What to build:** Scenario 4. A Tenant that already has a subscription adds a second domain on a different Plan. It attaches as another item on the existing subscription rather than creating a new one, and the Tenant gets one combined invoice listing both domains. Fix whatever fails, with a regression test per fix.

**Blocked by:** 02: First mailbox starts the Trial, and a coupon extends it

**Status:** ready-for-agent

- [ ] The Tenant still has exactly one Stripe subscription after adding the second domain
- [ ] Each domain appears as its own item at its own Plan's per-user rate
- [ ] The next invoice is a single invoice covering both domains
- [ ] The tenant-admin billing summary shows both domains correctly
- [ ] Every fix has a regression test
- [ ] Runbook section for scenario 4 written
