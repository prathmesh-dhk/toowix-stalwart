# 02: First mailbox starts the Trial, and a coupon extends it

**What to build:** Scenarios 1 and 10, run against Stripe test mode. A Tenant Admin with no card creates domains and picks Plans freely; creating the first mailbox asks for a card inline, and once the card is saved the mailbox is created without re-entering details. The Trial starts at that moment, and the Tenant now has a Stripe customer and subscription in trial. Redeeming a valid coupon then extends the Trial end in both the app and Stripe; an invalid coupon is refused. Fix whatever fails, with a regression test per fix at the mocked-Stripe seam.

**Blocked by:** 01: Local Stripe test environment

**Status:** done

- [x] Domains and Plans can be set up with no card and no Trial running
- [x] First mailbox creation prompts for a card in the same flow and creates the mailbox after the card is saved
- [x] Trial start and end shown in the tenant-admin app match the Stripe subscription
- [x] Exactly one Stripe customer exists for the Tenant
- [x] A valid coupon moves the Trial end in the app and in Stripe; an invalid one is refused with a clear message
- [x] Every fix has a regression test
- [x] Runbook sections for scenarios 1 and 10 written

**Notes (2026-10-19):** The live run used Stripe test mode and a throwaway domain on `smtp.dhkmail.com`, which was deleted afterwards. The card prompt stays as it is: the first mailbox is created held, and a toast, banner and Cart badge lead to the Cart's Stripe Checkout (product decision).
