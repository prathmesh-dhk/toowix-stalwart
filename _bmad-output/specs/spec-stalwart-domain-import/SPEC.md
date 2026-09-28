---
id: SPEC-stalwart-domain-import
companions: []
sources: []
---

> **Canonical contract.** This SPEC is the complete, preservation-validated contract for what to build, test, and validate.

# Import Pre-Existing Stalwart Domains and Mailboxes

## Why

Some clients already have domains and mailboxes configured directly on Stalwart, set up manually through Stalwart's own admin UI before this platform existed. The platform now lets tenants self-manage domains and mailboxes, but has no path for these pre-existing clients to get in: they'd otherwise have to register and start from zero while their real domains/mailboxes keep living outside the platform's view. This is a mandate to meet the platform's own onboarding promise for a known, non-empty backlog of existing Stalwart clients — solved by letting the platform Super-Admin, from a tenant's detail view in the admin panel, search Stalwart for domains that aren't tracked by any tenant yet and pull them (with their mailboxes) into that tenant's account.

## Capabilities

- **CAP-1**
  - **intent:** Platform Super-Admin, from a given tenant's detail view in the admin panel, can search for domains that already exist on Stalwart but aren't yet tracked by any tenant.
  - **success:** A name/substring search returns a plain list of domain names — no extra metadata (mailbox count, creation date, etc.) — restricted to Stalwart domains (via the Stalwart domain list) that have no local domain record for any tenant; a domain already claimed by any tenant never appears in results.

- **CAP-2**
  - **intent:** Super-Admin can select one or more searched, unclaimed domains and import them into the tenant being viewed, in a single action.
  - **success:** After import, each selected domain has exactly one local domain record owned by that tenant and linked to its existing Stalwart domain id; no write is made to Stalwart itself.

- **CAP-3**
  - **intent:** Importing a domain also discovers and attaches that domain's existing Stalwart mailboxes to the tenant.
  - **success:** After import, every existing Stalwart account belonging to the imported domain has exactly one local mailbox record linked to it and owned by the tenant; any account already claimed by another tenant is skipped, never duplicated or reassigned.

- **CAP-4**
  - **intent:** Once imported, the tenant admin manages the domain and its mailboxes through the same views and actions used for platform-created domains and mailboxes.
  - **success:** An imported domain or mailbox appears in the normal domains/mailboxes list and detail views and supports the same actions (status toggle, DKIM view, mailbox settings, etc.) as a platform-created one, with no separate "imported" screen or reduced capability set.

## Constraints

- Domain name and mailbox address uniqueness stays global, not per-tenant: an unmanaged Stalwart domain or mailbox is eligible for import by exactly one tenant, ever, and a domain/mailbox already claimed locally (by this tenant or another) must never resurface as importable or be reassignable through this feature.
- Import makes no Stalwart-side writes (no create/update/delete calls) — it only reads Stalwart's domain and account lists and writes local records pointing at the existing Stalwart ids, the same read-then-adopt pattern already used when domain creation collides with an existing Stalwart domain.
- Imported mailboxes keep whatever password already exists on their Stalwart account, unchanged. The platform does not need to know or store the plaintext password, must not invent or reset one at import time, and the mailbox is immediately usable with its existing Stalwart credentials after import.
- The search/import action is Super-Admin-only, performed from a tenant's detail view in the admin panel (extending the existing Super-Admin-gated unmanaged-domains surface), not a tenant-admin self-service action — the Super-Admin's manual selection is what stands in for domain-ownership verification, so results must never include a domain or mailbox already claimed by any tenant.

## Non-goals

- Migrating or copying mail content (existing messages, IMAP folders/labels) — import registers existing Stalwart domain/account ids as local metadata only; mail data stays on Stalwart untouched.
- A general bulk sync/reconciliation engine — this is a one-time, admin-triggered import of an admin's selection, not an ongoing sync process.
- Reclaiming, transferring, or moving a domain or mailbox already owned by another tenant's local record.

## Success signal

A Super-Admin, given a Stalwart domain that was configured manually outside the platform, opens the target tenant's detail view, searches for that domain, selects it (and optionally others), imports it in one action, and the domain and its pre-existing mailboxes immediately appear in that tenant's normal domains/mailboxes views, manageable by the tenant admin exactly like a platform-created domain — with zero Stalwart-side changes made in the process.

