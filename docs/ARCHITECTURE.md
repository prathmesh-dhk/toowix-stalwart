# Toowix Multi-Tenant Mail Management Platform
## Architecture & Implementation Plan (Phase 0 Deliverable — Pre-Code)

**Status:** Research & architecture complete. No code has been written. This document is the approval gate for Phase 1.

---

## A. Executive Summary

Toowix is building a control plane that lets multiple independent companies ("tenants") share one self-hosted **Stalwart Mail Server (Community Edition)** safely — each tenant with exactly one dedicated email domain, a per-tenant mailbox limit, and strict isolation between tenants — **without** buying Stalwart's Enterprise license.

**Domain model note (updated):** each tenant is tied to **exactly one** email domain, not several. This is a deliberate simplification from an earlier draft of this document, which allowed multiple domains per tenant — that flexibility is dropped for V1. One consequence worth calling out: because a mailbox's domain is now always its tenant's own (single) domain, an entire class of "does this domain belong to this tenant" checks disappears by construction — see Sections F, I, J, and K below for where this simplifies the design.

Stalwart's own multi-tenancy (the `Tenant` object, per-tenant quotas, per-tenant admins, per-tenant branding) is confirmed to be an **Enterprise-only, paid feature**, unavailable in the Community Edition. Community Edition Stalwart is, from the outside, a **single flat mail server**: one pool of accounts, groups, and domains, with one set of server-wide administrators. It has no native concept of "tenant."

Toowix's job is to build that missing concept ourselves, entirely in our own application and database, and to use Stalwart purely as a mail-delivery engine that we drive through its supported, documented management interfaces (its REST/JMAP Management API, and optionally its CLI for operational tasks). Stalwart never sees "tenants" — it only ever sees individual accounts and domains that Toowix created on a tenant's behalf. All tenant boundaries, quotas, and admin scoping are enforced by Toowix before a single Stalwart API call is made.

---

## B. Problem Definition

Stalwart ships two editions from the same codebase: **Community** (AGPL-3.0, free, self-hosted) and **Enterprise** (paid subscription). Both implement the same core mail protocols (SMTP, IMAP, POP3, JMAP, CalDAV/CardDAV/WebDAV). The Enterprise edition adds a set of operational features aimed at hosting providers and large deployments — multi-tenancy with per-tenant quotas and admins, per-tenant branding, SCIM provisioning, archiving/undelete, AI-assisted spam filtering, read replicas, and live telemetry/dashboards. **Multi-tenancy is explicitly and repeatedly called out by Stalwart's own documentation as an Enterprise-exclusive capability, not included in Community Edition.**

If we ran a Community Edition server for several companies without an external control plane, we would have no boundary at all: any account with Stalwart admin rights could see, modify, or delete any other account or domain, and there would be no way to cap how many mailboxes a given company could create. Toowix exists to close that gap: it is the tenant boundary that Community Edition Stalwart does not provide on its own, so that a single free, self-hosted Stalwart deployment can be safely resold or shared across many companies.

---

## C. Capability Research — Stalwart Community vs. Enterprise

Verified against the current official documentation at `stalw.art/docs` (accessed today). Classification key: **CONFIRMED** (directly stated in current docs), **RECOMMENDED** (our architectural choice, not a doc claim), **ASSUMPTION** (reasonable inference, not explicitly documented), **NEEDS VERIFICATION** (should be re-checked against the live server / OpenAPI spec before build).

| Capability | Free/Community Edition | Enterprise/Paid | How Toowix Handles It |
|---|---|---|---|
| Native multi-tenancy (`Tenant` object, `memberTenantId`, tenant quotas, tenant branding) | **Not included** — CONFIRMED | Included | Toowix builds its own Tenant concept in PostgreSQL; never uses Stalwart's `Tenant` object |
| Account (mailbox) creation/deletion, password reset | Included — CONFIRMED | Included | Toowix drives this via Stalwart's REST Management API (`/api/principal`) |
| Domain creation/deletion (Domain principal) | Included — CONFIRMED | Included | Toowix creates a Stalwart Domain principal only after verifying tenant ownership in its own DB |
| REST Management API (accounts, domains, groups, lists, DKIM, queue, config) | Included — CONFIRMED | Included | Primary integration surface for the Toowix backend |
| `stalwart-cli` (schema-driven CRUD, bulk `apply`, `snapshot` export) | Included — CONFIRMED | Included | Used for operator tooling (bulk import, backup/export), not for per-request backend calls |
| Roles & Permissions system (built-in `user`/`admin`/`tenant-admin` roles, custom Role objects) | Included — CONFIRMED ("available in all versions") | Included | Used to scope the Toowix service account tightly; **not** used to give tenant admins direct Stalwart access |
| API Key principal type (for external app access to the Management API) | Included — CONFIRMED | Included | The Toowix backend authenticates to Stalwart as a dedicated API Key principal, never as a mailbox account |
| Per-account (per-mailbox) quota | Included — CONFIRMED (core feature, quotas per user) | Included | Optional secondary control; not our primary quota mechanism (see below) |
| Per-tenant disk quota / per-tenant principal-count quota | **Not included (part of `Tenant` object)** — CONFIRMED | Included | Toowix enforces the mailbox-count limit itself in PostgreSQL before calling Stalwart |
| Per-tenant admins / tenant-scoped delegated administration enforced *by Stalwart itself* | **Not included** — CONFIRMED (scoping requires the `Tenant` object) | Included | Toowix enforces tenant scoping in its own authorization layer; Tenant Admins never get a Stalwart credential of any kind |
| Per-domain directory backends | **Not included** — CONFIRMED | Included | Single shared Internal directory (backed by our chosen data store) for the whole server; fine, because Toowix — not Stalwart — is the tenant boundary |
| SCIM provisioning (`/scim/v2`) | **Not included** — returns `403 Forbidden` — CONFIRMED | Included | Not used. Provisioning goes through the Management API instead |
| Branding / custom logo (WebUI) | Domain-level logo field exists on the Domain principal — NEEDS VERIFICATION whether unrestricted in Community; coordinated multi-tenant branding is Enterprise — CONFIRMED for the Enterprise feature | Included | Out of scope for V1 either way |
| OAuth 2.0 / OpenID Connect (authorization code, device flow, dynamic client registration) | Included — CONFIRMED | Included | Not used for platform login in V1 (see Section H); may be relevant to a later Toowix SSO integration |
| Two-factor auth, app passwords | Included — CONFIRMED | Included | Available to mailbox end-users via Stalwart's own self-service portal; out of scope for Toowix V1 UI |
| Access Control Lists (ACLs), rate limiting, fail2ban-style auto-banning | Included — CONFIRMED | Included | Left at Stalwart's defaults; hardened per Section M |
| Read replicas, sharded blob/in-memory stores | **Not included** — CONFIRMED | Included | Not needed for V1 (single Stalwart node, per Section 27 of the brief) |
| Archiving / un-deletion, live telemetry dashboards, AI spam classifier | **Not included** — CONFIRMED | Included | Not depended upon; Toowix's own audit log and telemetry cover V1 needs |

**Overall conclusion:** everything the Toowix control plane needs from Stalwart — creating/deleting accounts and domains, resetting passwords, reading current account/domain state — is available through the Management API and CLI in the Community Edition. The only things we are deliberately *not* using are the ones that are Enterprise-gated, and in every one of those cases Toowix's own application logic replaces the missing capability.

---

## D. Recommended Architecture

```text
                         Internet
                            │
                            ▼
                 ┌─────────────────────┐
                 │  Toowix Frontend     │  (Platform Admin UI, Tenant Admin UI)
                 └──────────┬──────────┘
                            │ HTTPS / JSON, session or bearer token
                            ▼
                 ┌─────────────────────┐
                 │  Toowix Backend      │  (owns tenants, domains, mailboxes,
                 │  (API + auth +       │   quotas, audit log; the ONLY
                 │   authorization)     │   component that talks to Stalwart)
                 └───────┬─────────┬────┘
                         │         │
                         ▼         ▼
                  ┌───────────┐ ┌────────────────────┐
                  │ PostgreSQL │ │ Stalwart Mail Server │
                  │ (source of │ │ (Community Edition)  │
                  │  truth for │ │ REST Mgmt API /       │
                  │  tenancy)  │ │ CLI (ops only)        │
                  └───────────┘ └────────────────────┘
```

Stalwart is never exposed directly to the internet on its management surface; only the Toowix backend can reach it (Section 22 / L below). End users' mail clients (IMAP/JMAP/SMTP) connect straight to Stalwart, because that traffic is mail protocol traffic Toowix has no reason to intercept — Toowix's job is *provisioning*, not *mail delivery*.

---

## E. Trust Boundaries

```text
User (browser)
   │  HTTPS, credentials never touch Stalwart
   ▼
Frontend (SPA)                         — Trust boundary 1: never holds Stalwart credentials
   │  HTTPS + session/bearer auth
   ▼
Backend API                            — Trust boundary 2: authenticates & authorizes every request
   │  tenant-ownership check, quota check, input validation
   ▼
PostgreSQL                             — Trust boundary 3: single source of truth for tenant/domain/mailbox ownership
   │  (backend only; no direct external access)
   ▼
Stalwart Management API (API-key auth) — Trust boundary 4: backend authenticates as one privileged service principal
   │
   ▼
Stalwart internal state (accounts/domains/mail)
```

Each arrow is a boundary the backend re-validates on every request; nothing upstream of the backend (frontend, browser, tenant admin) is ever trusted to have already done that validation. Tenant Admins authenticate only to the Toowix backend — never to Stalwart's own admin surface.

---

## F. Tenant Isolation Strategy

Cross-tenant access is prevented by re-deriving tenant scope from the authenticated identity on every single request, at every layer, rather than trusting anything the client sends:

1. **Authentication layer** — the backend authenticates the caller (Platform Admin or Tenant Admin) and attaches their `tenant_id` (null for Platform Admins) to the request context from server-side session/token data, never from a client-supplied field.
2. **Authorization layer** — a single shared middleware/guard runs before every tenant-scoped handler: it loads the target resource (domain or mailbox), reads *its* `tenant_id`, and compares it to the caller's `tenant_id`. A mismatch is a `403`/`404` (see Section M on IDOR) before any business logic runs. Platform Admins bypass this check explicitly and only through an audited "admin override" code path.
3. **Database layer** — every tenant-owned table (`domains`, `mailboxes`, `tenant_admins`) has a mandatory, indexed, non-nullable `tenant_id` foreign key. `domains.tenant_id` additionally carries a `UNIQUE` constraint, so the database itself enforces "exactly one domain per tenant" — a second domain row for the same tenant is a constraint violation, not merely an application-level rule that could be bypassed by a bug. All queries issued by tenant-scoped endpoints include `WHERE tenant_id = :caller_tenant_id` — never `WHERE id = :id` alone. Because each tenant has exactly one domain, `mailboxes.domain_id` (kept for DNS/DKIM metadata lookups) is always derivable from `mailboxes.tenant_id`; an application-level (and, if the DB supports it, a `CHECK`/trigger-based) guarantee keeps the two in agreement, so a mailbox can never be silently attached to a domain owned by a different tenant.
4. **API layer** — tenant-scoped routes are namespaced under the authenticated tenant context (e.g. `/api/tenants/me/...` for Tenant Admins) rather than accepting an arbitrary `:tenantId` path parameter from a non-platform-admin caller, removing an entire class of IDOR by construction.
5. **Service/business logic layer** — quota checks, domain-ownership checks, and mailbox-creation logic are implemented once, in a shared service module, and always take the caller's tenant context as a mandatory argument — never as an optional one — so it is structurally difficult to add a new code path that forgets the check.
6. **Stalwart integration layer** — the Stalwart client used by that shared service module is the *only* code in the system with a Stalwart credential. It receives already-validated, already-scoped requests ("create `john@acme.com` for tenant `T1`, who owns `acme.com`") and has no independent notion of tenants at all; it cannot be reached by a Tenant Admin directly, only through the service layer above it.
7. **Frontend layer** — the frontend hides UI for other tenants' data as a UX convenience only; it is never treated as an enforcement point, and every backend endpoint behaves correctly even if the frontend is bypassed entirely (e.g. via `curl`).

---

## G. Critical Security Question — Preventing Tenant A From Touching Tenant B's Stalwart Resources

Because Community Edition Stalwart has no native tenant boundary, the only safe design is: **Tenant Admins never receive a Stalwart credential of any kind — session, API key, basic-auth password, or OAuth token.** All Stalwart access flows through one path:

```text
Tenant Admin
      │  (authenticates only to Toowix, never to Stalwart)
      ▼
Toowix Backend
      │
      ├── Verify caller is an active Tenant Admin for tenant T
      ├── Resolve the target address using tenant T's own (single) domain
      │    — there is no domain to "choose," so nothing to verify ownership of
      ├── Verify tenant T is under its mailbox quota
      ├── Validate the requested mailbox name/address
      └── Call Stalwart Management API using the backend's own
          single service-level API Key principal
```

The alternative — giving each Tenant Admin their own Stalwart credential, even one restricted by a custom Role — was evaluated and rejected, because Community Edition's Role/Permission system can restrict *which actions* a principal may take (e.g. "manage accounts," "manage domains") but, without the Enterprise `Tenant` object, it **cannot restrict which accounts or domains those actions apply to**. A Community Edition principal with "manage accounts" permission can manage *any* account on the server, not just accounts under one domain. Handing that out to a Tenant Admin — even wrapped in a custom role — would mean Tenant A's admin could, at the Stalwart layer, create, modify, or delete Tenant B's mailboxes. The proxy-through-backend approach avoids this entirely: the backend's Stalwart credential is powerful, but only the backend holds it, and the backend never issues a Stalwart-level command it hasn't already tenant-scoped itself.

---

## H. Authentication & Authorization

**Recommendation for V1: application-managed authentication in the Toowix backend, not Keycloak.**

Keycloak is a strong general-purpose IdP and is already used elsewhere in the Toowix ecosystem (see the separate Toowix identity/SSO platform), but for this specific control plane it adds real deployment and operational weight — another stateful service, another database, another set of realms/clients to configure and keep patched — for a V1 role model that is deliberately just two roles (`PLATFORM_ADMIN`, `TENANT_ADMIN`) with no self-service signup and no end-user-facing login flows. Application-managed auth (password hashing with a modern KDF such as Argon2id, server-side sessions or short-lived JWTs, standard password-reset-by-email flow) is simpler to build, simpler to reason about for tenant isolation, and has no external dependency that could become a single point of failure for provisioning.

This is a V1 scoping choice, not a rejection of Keycloak forever: if Toowix later wants Tenant Admins to log in via their own company's SSO, or wants a unified login across every Toowix app (mail platform included), migrating this control plane onto the existing Keycloak-based Toowix identity platform is a reasonable Phase-2+ project, using the same OAuth2/OIDC resource-server pattern already adopted for the rest of Toowix.

Authorization is a simple two-role RBAC check performed on every request (Section F): `PLATFORM_ADMIN` may act on any tenant; `TENANT_ADMIN` may act only within their own `tenant_id`. No Stalwart-side authorization is ever delegated to the end user (Section G).

---

## I. Stalwart Integration

**Chosen mechanism: Stalwart's REST Management API over HTTPS, authenticated as a dedicated API Key principal.** (Option A from the brief.)

- **Why not the CLI (Option B) for the request path:** `stalwart-cli` is a genuinely capable, schema-driven tool (`get`/`query`/`create`/`update`/`delete`/`apply`/`snapshot`) that speaks the same underlying JMAP management objects as the REST API, and it is a good fit for *operational* tasks — bulk imports, scripted backups via `snapshot`, disaster-recovery exports — but shelling out to an external binary per HTTP request from a backend service is unnecessary process overhead and a worse security boundary than calling the same API directly over HTTPS from the backend's own HTTP client. **Recommendation: use the CLI for ops/runbooks, not for the live request path.**
- **Why not direct database manipulation (Option C):** explicitly excluded per the brief, and there is no documented recommendation from Stalwart to write to its internal store directly; doing so would bypass validation, indexing, and event/audit hooks the server itself relies on, and would break on any future Stalwart schema change. Rejected.
- **How to authenticate:** create one Stalwart **API Key** principal for the Toowix backend service (`type: "apiKey"`), scoped via a custom Role to the minimum set of permissions needed to manage accounts and domains (not full `admin` if a narrower role proves sufficient — **NEEDS VERIFICATION** against the live permissions list at `/docs/ref/permissions/` during Phase 5 build). Per Stalwart's own documentation, API Key principals **cannot** be used to authenticate to JMAP/IMAP/POP3, so this credential is unusable for reading tenant mail even if leaked to the wrong internal context — it only opens Management API endpoints. Store this key in the platform's secret manager / environment, never in application code or version control.
- **How to create/delete accounts:** `POST /api/principal` with `{"type": "individual", ...}` for a mailbox; `DELETE` (or the CLI-equivalent `delete`) against the principal's id to remove it.
- **How to create/delete domains:** since each tenant has exactly one domain, the Stalwart Domain principal is created once, as part of tenant provisioning — `POST /api/principal` with `{"type": "domain", "name": "acme.com", ...}` — rather than through a repeatable "add another domain" flow. Changing a tenant's domain later is a rare, Platform-Admin-only, heavily audited operation (delete the old Domain principal, create the new one, and re-provision the tenant's existing mailboxes under it), never a self-service Tenant Admin action. Domain deletion follows the same one-time pattern, typically as part of tenant deletion.
- **How to change passwords:** `PATCH`/update the target principal's `secrets` field (password hash) via the Management API — never store or transmit the tenant's chosen password in Toowix's own database; treat Stalwart as the sole source of truth for mailbox credentials.
- **How to retrieve/detect existing accounts:** `GET /api/principal/{id}` for a known id, or `query`-style filtering for existence checks before create, to make creation idempotent.
- **Idempotency & failure handling:** before calling Stalwart, check Toowix's own DB for an existing mapping; treat a Stalwart "already exists" error on create as non-fatal if Toowix's DB also believes the resource exists (reconciliation, not duplication); treat network/5xx errors from Stalwart as retryable with backoff, and anything else as a hard failure surfaced to the caller (Section L).
- **NEEDS VERIFICATION before Phase 5 build:** the exact current JSON field names/shape for the `individual` principal variant (the doc excerpt available during this research showed the `domain` variant in detail); the precise permission-id strings needed for a minimal "account + domain management only" custom Role; whether the Management API exposes a bulk/batch endpoint or whether N calls are required for N mailboxes.

---

## J. API Specification (V1 — summary; full OpenAPI-style spec to be produced in Phase 3/4)

All endpoints require authentication; tenant-scoped endpoints additionally require the caller's `tenant_id` to match the resource, enforced server-side per Section F.

| Endpoint | Method | Role required | Tenant scope | Notes |
|---|---|---|---|---|
| `/api/tenants` | POST, GET | PLATFORM_ADMIN | — (global) | Create/list tenants; `domain` is required at creation — every tenant has exactly one, set once here |
| `/api/tenants/:id` | GET, PATCH, DELETE | PLATFORM_ADMIN | — | View/update/delete a tenant; delete is soft-delete + suspend cascade |
| `/api/tenants/:id/suspend`, `/reactivate` | POST | PLATFORM_ADMIN | — | Suspend blocks new mailbox creation for the tenant without touching existing Stalwart accounts |
| `/api/tenants/:id/mailbox-limit` | PATCH | PLATFORM_ADMIN | — | Update quota |
| `/api/tenants/:id/domain` | PATCH | PLATFORM_ADMIN | — | Change a tenant's domain — rare, destructive (re-provisions the Stalwart Domain principal and every existing mailbox); heavily audited, never exposed to Tenant Admins |
| `/api/tenants/:id/admins` | POST, GET | PLATFORM_ADMIN | — | Create/list Tenant Admins for a tenant |
| `/api/tenants/:id/admins/:adminId/reset-password`, `/disable`, `/enable` | POST | PLATFORM_ADMIN | — | |
| `/api/tenants/me` | GET | TENANT_ADMIN | self | Tenant Admin's own tenant summary, including their single assigned domain |
| `/api/tenants/me/mailboxes` | POST, GET | TENANT_ADMIN or PLATFORM_ADMIN | own tenant | Create/list mailboxes; create takes only a local-part (the domain is always the tenant's own) and is quota-checked (Section K) |
| `/api/mailboxes/:id` | GET, DELETE | TENANT_ADMIN or PLATFORM_ADMIN | owning tenant | |
| `/api/mailboxes/:id/reset-password` | POST | TENANT_ADMIN or PLATFORM_ADMIN | owning tenant | Never returns the old password; sets a new one via Stalwart |
| `/api/audit-logs` | GET | PLATFORM_ADMIN (all), TENANT_ADMIN (own tenant only) | filtered | Paginated, filterable by actor/action/date |
| `/api/system/status` | GET | PLATFORM_ADMIN | — | Stalwart reachability, tenant/mailbox/domain counts |

Every endpoint: validates input (address syntax, domain syntax, name length), returns structured error codes (`TENANT_SUSPENDED`, `QUOTA_EXCEEDED`, `DOMAIN_NOT_OWNED`, `MAILBOX_EXISTS`, `STALWART_UNAVAILABLE`), and writes an audit log entry on success *and* on authorization failure (the latter without leaking whether the target resource exists, to avoid enumeration).

---

## K. Mailbox Creation Flow & Concurrency

```text
Tenant Admin → POST /api/tenants/me/mailboxes {local_part}
      │
      ├── AuthN: resolve caller → tenant_id = T
      ├── AuthZ: caller has TENANT_ADMIN role, tenant T not suspended
      ├── Resolve address = local_part + "@" + tenant T's single domain
      │    (no domain_id in the request at all — a Tenant Admin never
      │     chooses a domain, so there is no "wrong domain" to check)
      ├── Validate mailbox name/address syntax; check not already taken
      │
      ├── BEGIN transaction (Postgres, SERIALIZABLE or SELECT ... FOR UPDATE
      │    on the tenant's row) — see below
      ├── Count current mailboxes for tenant T
      ├── If count >= mailbox_limit → ROLLBACK, return 409 QUOTA_EXCEEDED
      ├── Insert mailbox row with status = 'provisioning'
      ├── COMMIT
      │
      ├── Call Stalwart: POST /api/principal {type: individual, ...}
      │     ├── success → UPDATE mailbox row status = 'active'
      │     └── failure → UPDATE mailbox row status = 'failed' (see Section L)
      └── Return result to Tenant Admin
```

**Concurrency protection (the "49/50, two admins race" scenario):** the quota check and the row insert must happen inside the *same* database transaction, with either `SERIALIZABLE` isolation or an explicit row-level lock on the tenant's own row (`SELECT ... FOR UPDATE` on `tenants` before counting `mailboxes`) so two concurrent creation requests for the same tenant are serialized by Postgres itself rather than by application code. A `UNIQUE` constraint on `(tenant_id)` combined with a partial/aggregate check is not sufficient on its own — the count-then-insert must be atomic, which is exactly what the row lock guarantees. This is the standard, well-understood way to avoid the classic check-then-act race and is the recommended approach over an application-level mutex, which would not work correctly across multiple backend instances.

---

## L. Failure & Consistency Strategy

- **Stalwart unavailable at request time:** the mailbox-creation transaction above only inserts the local `mailboxes` row with `status = 'provisioning'` *before* calling Stalwart. If the Stalwart call then fails (timeout, connection refused, 5xx), the row is updated to `status = 'failed'` rather than left `provisioning` forever or silently deleted — the API returns `503 STALWART_UNAVAILABLE` and the tenant's quota is **not** counted against a `failed` row (only `active`/`provisioning` count toward quota, with `provisioning` rows older than a short timeout — e.g. 2 minutes — treated as failed by a background sweep). This avoids the "phantom mailbox that eats quota forever" failure mode.
- **Database succeeds, Stalwart fails:** handled by the state machine above (`provisioning` → `failed`). No distributed transaction/2PC is attempted — this is a **compensating-action / saga-lite** pattern: local state is provisional until the remote call confirms, and a scheduled reconciliation job (Section 21/M below) periodically re-attempts or flags any `failed`/stuck `provisioning` rows for admin attention, rather than silently retrying forever.
- **Stalwart succeeds, database update fails:** rarer, but handled the same way — a scheduled reconciliation job queries Stalwart for accounts under Toowix-owned domains and cross-checks against the local `mailboxes` table; a Stalwart account with no matching local row is flagged (not auto-deleted) for Platform Admin review, since deleting mail data automatically on a reconciliation mismatch is too destructive for V1.
- **Duplicate mailbox / domain request:** rejected with `409` if the local row already exists; if Toowix's local state says "doesn't exist" but Stalwart returns "already exists" on create, this is treated as drift and surfaced via the reconciliation job rather than silently overwritten.
- **Recommended V1 reconciliation approach:** a lightweight, scheduled (e.g. hourly) job that lists Stalwart domains/accounts and diffs them against Toowix's own tables, logging and (for Platform Admins only) surfacing any drift. **Direct administration of Stalwart outside Toowix should be disabled in production** (Section 22/L continued below) specifically to keep this drift rare; the reconciliation job exists as a safety net, not as the primary correctness mechanism.

---

## Direct Stalwart Administration (Bypass Risk)

Anyone with credentials to Stalwart's own WebUI/CLI/Management API can act on any account or domain, completely outside Toowix's tenant boundary, quota checks, and audit log. This is expected — Stalwart Community Edition has no other model — but it means the production deployment must ensure **only the Toowix backend, and a small, tightly controlled set of human operators (platform operators, not customers), can ever reach Stalwart's management surface.**

Recommended production topology: Stalwart's HTTP management/JMAP listener is **not** exposed on the public internet at all; it is reachable only on an internal Docker network from the Toowix backend container, plus (optionally) a bastion/VPN path for platform operators doing break-glass maintenance. Stalwart's mail-protocol listeners (SMTP/IMAP/JMAP-for-mail-clients) remain publicly exposed, since that is the actual product being delivered to end users — but the *management* surface is not the same as the *mail* surface, and only the former needs to be locked down this tightly.

```text
Internet ──▶ Toowix Platform ──▶ Stalwart (mail protocols: public; management API: internal-only)
```

---

## M. Security Threat Model

| Threat | Mitigation |
|---|---|
| Broken access control / IDOR (Tenant A guesses Tenant B's mailbox/domain id) | Every tenant-scoped query filters by `tenant_id` derived server-side from the authenticated caller (Section F); IDs alone never authorize an action |
| Privilege escalation (Tenant Admin tries to call a Platform Admin endpoint) | Role check is a separate, mandatory middleware layer, checked before tenant-ownership; Platform-only routes reject non-platform tokens outright |
| Cross-tenant Stalwart access | No Tenant Admin ever holds a Stalwart credential (Section G); the single backend service credential is never exposed to any client |
| Stalwart API-key leakage | Stored only in the platform secret manager/environment; scoped to the minimum viable Role; rotated on a schedule and immediately on suspected compromise; never logged |
| Password storage | Tenant/Platform Admin passwords hashed with Argon2id in Toowix's own DB; mailbox passwords are **not** stored in Toowix at all — Stalwart is the sole holder of mailbox credentials, so a Toowix DB breach does not expose mail passwords |
| Session/token security | Short-lived access tokens + refresh tokens (or server-side sessions with `HttpOnly`, `Secure`, `SameSite=Strict` cookies); tokens invalidated on password change/admin disable |
| CSRF | `SameSite=Strict` cookies plus a CSRF token on state-changing requests if cookie-based sessions are used; not needed if using bearer tokens exclusively from a separate frontend origin with strict CORS |
| CORS | Explicit allow-list of the Toowix frontend origin(s) only; no wildcard `*` on any authenticated endpoint |
| Rate limiting / brute force | Login and password-reset endpoints rate-limited per IP and per account; general API rate-limited per authenticated principal |
| SQL injection | Parameterized queries / ORM exclusively; no string-concatenated SQL anywhere near tenant-scoped filters |
| API abuse / scraping | Standard auth + rate limiting; audit log flags unusual volumes of creation/deletion from a single Tenant Admin |
| Audit log integrity | Audit log is append-only at the application layer (no update/delete endpoint exposed); consider a DB-level trigger or separate write-only role for the audit table in a later hardening pass |
| Secret management | Stalwart API key, DB credentials, and session-signing keys live in environment variables / a secret manager, never in the repo; `.env` files git-ignored |
| Container security | Backend, frontend, and Stalwart run as separate least-privilege containers; Stalwart's management network is internal-only (see above); images pinned to specific versions, not `:latest`, for reproducible security patching |
| Network exposure | Only the frontend and Stalwart's mail-protocol ports are internet-facing; Postgres and Stalwart's management API are never bound to a public interface |
| Enumeration via error messages | `404`/`403` responses for cross-tenant access attempts are indistinguishable from "resource does not exist," so a Tenant Admin cannot use error differences to enumerate other tenants' resource IDs |

---

## N. Deployment Architecture (Docker)

```text
docker-compose.yml (illustrative, not final)

services:
  frontend:       # Toowix SPA, public
  backend:        # Toowix API, public (only its own API surface)
  postgres:       # internal network only, named volume for data
  stalwart:       # mail ports public (SMTP/IMAP/JMAP-for-clients);
                   # management HTTP port internal-only, reachable
                   # only by `backend` on the internal network

networks:
  public: {}       # frontend + backend + stalwart's mail ports
  internal: {}     # backend <-> postgres, backend <-> stalwart mgmt API
```

- **Environment variables / secrets:** `STALWART_API_URL`, `STALWART_API_KEY`, `DATABASE_URL`, `SESSION_SECRET` (or JWT signing key) — injected via the orchestrator's secret mechanism, never baked into images.
- **Persistent volumes:** Postgres data directory; Stalwart's data/blob/index stores (per Stalwart's own storage-backend configuration — RocksDB or an external Postgres/S3-compatible store, chosen during Phase 5).
- **Health checks:** backend `/healthz` (checks DB connectivity and, non-blockingly, Stalwart reachability); Postgres and Stalwart use their own standard health checks.
- **Startup dependencies:** backend waits for Postgres to be ready before running migrations; Stalwart's own first-run bootstrap (per its installation docs) is a one-time step, ideally scripted so the Stalwart API key/service principal is created automatically as part of environment setup rather than by hand.
- **Dev vs. production:** dev compose file exposes Stalwart's management port on localhost for debugging; production compose file removes that mapping entirely, matching the "management API internal-only" rule above.

---

## O. Project Structure (recommended repository layout)

```text
toowix-mail-platform/
├── backend/
│   ├── src/
│   │   ├── api/            # route handlers (thin)
│   │   ├── services/        # tenant, domain, mailbox, quota logic (thick)
│   │   ├── stalwart/         # the ONLY module holding the Stalwart client/credential
│   │   ├── db/                # models/migrations
│   │   ├── auth/               # authn/authz middleware
│   │   └── audit/               # audit logging
│   └── tests/
├── frontend/
│   └── src/ (Platform Admin views, Tenant Admin views)
├── deploy/
│   ├── docker-compose.dev.yml
│   ├── docker-compose.prod.yml
│   └── stalwart-bootstrap/     # scripted first-run setup (API key creation, etc.)
└── docs/
    └── this architecture document, kept up to date as source of truth
```

---

## P. Implementation Phases

```text
Phase 0 — Research & Validation                (this document)
Phase 1 — Project Foundation                   (repo scaffolding, CI, Docker skeleton, Postgres schema/migrations)
Phase 2 — Authentication                       (Platform/Tenant Admin login, sessions/tokens, password reset)
Phase 3 — Tenant Management                    (Platform Admin: create/update/suspend tenant, set mailbox limit)
Phase 4 — Domain Management                    (add/remove domain, ownership checks)
Phase 5 — Stalwart Integration                 (API key/service-principal bootstrap, Stalwart client module,
                                                  verify exact principal field shapes & minimal permission set)
Phase 6 — Mailbox Management                   (create/delete/reset password, quota-checked transaction)
Phase 7 — Tenant Isolation & Security Hardening (cross-tenant test suite, rate limiting, audit log completeness)
Phase 8 — Frontend                             (Platform Admin dashboard, Tenant Admin dashboard)
Phase 9 — Testing                              (unit, integration against a real Stalwart Community instance,
                                                  concurrency test for the mailbox-limit race)
Phase 10 — Deployment                          (prod Docker Compose, secret management, reconciliation job,
                                                   internal-only Stalwart management network)
```

---

## Final Decision Section

### Recommended V1 Architecture
A three-tier system — Toowix Frontend, Toowix Backend, PostgreSQL — sitting in front of one self-hosted **Stalwart Community Edition** server. The Toowix Backend is the sole holder of a Stalwart API-key credential and the sole caller of Stalwart's REST Management API; it enforces tenant ownership, mailbox quotas, and role-based access before every Stalwart call. `stalwart-cli` is available for operational/administrative tasks (bulk import, backup export) but is not part of the live request path.

### Why This Architecture
It solves the paid-multi-tenancy problem by never depending on Stalwart's `Tenant` object, per-tenant quotas, per-tenant admins, or SCIM provisioning — all confirmed Enterprise-only. Every one of those capabilities is re-implemented in Toowix's own PostgreSQL-backed application logic, and Stalwart is used only for what Community Edition genuinely and confirmedly provides: account/domain CRUD, password management, and mail delivery.

### What We Must NOT Depend On
- Stalwart's `Tenant` object / `memberTenantId` scoping
- Stalwart's per-tenant disk and principal-count quotas
- Stalwart's per-tenant delegated administration
- Stalwart's per-tenant branding
- Stalwart's SCIM provisioning (`/scim/v2`)
- Any other feature documented as Enterprise-exclusive

### V1 Components
Toowix Frontend (SPA) · Toowix Backend (API, auth, authorization, Stalwart client, audit log) · PostgreSQL · Stalwart Community Edition (mail engine only) · Docker Compose deployment.

### V1 Database Entities
`users`/`admins` (platform_admins + tenant_admins, or a single `admins` table with a `role` + nullable `tenant_id`) · `tenants` · `domains` (1:1 with `tenants` — `tenant_id` is `UNIQUE`, so every tenant has exactly one domain, enforced at the database level) · `mailboxes` · `audit_logs` · `platform_settings`.

### V1 Roles
`PLATFORM_ADMIN`, `TENANT_ADMIN` — nothing else.

### V1 Implementation Order
Phase 1 (foundation) → Phase 2 (auth) → Phase 3 (tenants) → Phase 4 (domains) → Phase 5 (Stalwart integration) → Phase 6 (mailboxes) → Phase 7 (isolation/security hardening) → Phase 8 (frontend) → Phase 9 (testing) → Phase 10 (deployment).

### First Implementation Task
**Stand up a local Stalwart Community Edition instance (Docker) and create one API Key principal by hand through the Management API/CLI**, then confirm — against the live server, not just the docs — the exact JSON shape of the `individual` and `domain` principal variants and the minimal permission set a custom Role needs for "create/delete accounts and domains only." This single step de-risks Phase 5 (the integration this entire architecture depends on) before any Toowix application code is written.

---

*Sources: current official Stalwart documentation at stalw.art/docs (Access Control → Principals, Authentication, Authorization → Permissions/Roles/Administrators/Tenants; Management → CLI and Web-based Administration; API Reference → Management API), and stalw.art/compare and stalw.art/docs/server/enterprise for edition differences. Items flagged NEEDS VERIFICATION should be re-confirmed against the live server/OpenAPI spec during Phase 5, since exact field-level JSON schemas were not fully enumerable from the documentation pages retrieved during this research pass.*
