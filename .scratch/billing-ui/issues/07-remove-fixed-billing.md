# 07: Remove fixed billing

**What to build:** Every Plan bills per Active User (decided in stripe-e2e issue 17), and the Super Admin can no longer create one that doesn't.

- The Plan form has one "Price per Active User / month" field and a user limit (the most Active Users a domain on this Plan can have), with no billing mode choice.
- New and edited Plans are saved as per-Active-User. Editing an existing Plan keeps its price and limit.
- The Plans list describes every Plan as priced per Active User up to its limit.
- Backend branches that treat a Plan as fixed-price are deleted. The stored field stays in the schema, unread.
- Test fixtures move off `fixed`.
- UI copy that says "seat" for the billed count is replaced.

Spec: `.scratch/billing-ui/spec.md`, stories 34–37 and 49.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The Plan form has no billing mode; price labelled per Active User / month; limit labelled as Active Users (component test)
- [x] Creating or updating a Plan without a billing mode saves it as per-Active-User (route test)
- [x] The Plans list wording is per Active User for every Plan
- [x] No backend code branches on a fixed billing mode
- [x] Test fixtures no longer build fixed Plans; the full backend and app suites pass
