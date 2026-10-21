# 01: Prefactor: shared domain-billing row, and summary types match the backend

**What to build:** No behaviour change. Make the later tickets easy. The Tenant Admin's billing summary type gains the fields the backend already sends (monthly total; per domain: Active Users, user limit, price per Active User, subtotal; Trial start), so the Billing page stops working around missing fields. Both views of the Billing page (organisation-wide and a single domain) render each domain through one shared domain-billing row component, which tickets 02–04 add actions to.

Spec: `.scratch/billing-ui/spec.md` (developer story 48; "One shared domain-billing component").

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The summary type matches what the summary endpoint returns today, with no casts needed in the Billing page
- [x] Both Billing views render domains through the same row component
- [x] The Billing page looks and behaves the same as before
- [x] Existing Billing page and Cart page tests pass unchanged (fixtures updated only for the new type fields)
