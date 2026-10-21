# 02: Tenant Admin changes a domain's Plan

**What to build:** On the Billing page, each billed domain has **Change plan**. It opens a dialog listing every active Plan with its price per Active User and what this domain would cost a month at its current Active Users, with the current Plan marked. Plans whose user limit is below the domain's Active Users are disabled with the reason.

- A higher-priced Plan says "Starts now; the difference is prorated on your next invoice". Picking it upgrades the domain, and the row shows the new Plan and price straight away.
- A lower-priced Plan says "Starts on <period end>". Picking it schedules the downgrade. The summary returns each domain's pending downgrade (target Plan and the date it takes effect), and the row shows "Moves to <Plan> on <date>". The monthly total keeps showing today's charges.
- An upgrade while a downgrade is pending removes the badge; a second downgrade replaces it.
- A refusal (for example the backend's Active User limit check) shows the backend's message and leaves the Plan unchanged.
- The action is hidden when billing is disabled or the domain has no billed subscription yet.

Uses the existing upgrade and downgrade endpoints. Upgrade vs downgrade is decided by comparing price per Active User with the current Plan, as the backend does.

Spec: `.scratch/billing-ui/spec.md`, stories 1–12 and 15–17.

**Blocked by:** 01: Prefactor: shared domain-billing row, and summary types match the backend

**Status:** done

- [x] The dialog lists active Plans with price per Active User and the domain's monthly cost; current Plan marked
- [x] Plans below the domain's Active Users are disabled with the reason
- [x] Upgrade calls the upgrade endpoint and the row shows the new Plan
- [x] Downgrade calls the downgrade endpoint and the row shows "Moves to <Plan> on <date>"
- [x] The summary returns each domain's pending downgrade (Plan id, name, effective date); a route test covers it
- [x] An upgrade after a pending downgrade clears the badge; a second downgrade replaces it
- [x] A refusal shows its message and the Plan is unchanged
- [x] Available in both Billing views; hidden without billing or a billed subscription
- [x] Component tests with the API mocked for each case above
