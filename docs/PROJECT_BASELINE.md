# Toowix Mail Platform — Current State & Project Baseline

**Evaluation Date:** September 2026  
**Document Purpose:** Baseline technical assessment of the existing repository as implemented today, establishing what works, what is incomplete, what is planned, and technical discrepancies between early documentation and current code.

---

## 1. Executive Summary & Core Mission

**Toowix Mail Platform** is a multi-tenant SaaS email management control plane designed around a shared, self-hosted **Stalwart Mail Server (Community Edition)**. 

Because Stalwart Community Edition is flat (it does not include native multi-tenancy, per-tenant quotas, or delegated tenant administration—which are restricted to Stalwart Enterprise), Toowix implements the complete multi-tenant control plane in its own application and database layer. Stalwart is utilized strictly as the low-level delivery and storage engine via its JMAP/REST Management API.

The project currently has a **substantially built, highly operational codebase** featuring:
- A full **Node.js/Express/TypeScript** backend with **MongoDB (Mongoose)** as the primary persistence layer.
- Two dedicated React 18 / Vite single-page applications:
  - `apps/super-admin` (Super Admin portal on port `5174` / `5173`)
  - `apps/tenant-admin` (Tenant Admin, Moderator & Onboarding portal on port `5175` / `5174`)
- Automated integrations with Stalwart Mail Server, Stripe (Checkout & Billing meters), DNS automation providers (GoDaddy, Hostinger, Cloudflare), and custom SMTP transactional email dispatch.
- A comprehensive automated test suite across backend and frontends (**71 test files, 675 passing automated tests** in Vitest).

---

## 2. Source of Truth: Implemented Features vs. Early Documentation

A crucial discovery during this baseline inspection is that **the codebase has evolved far beyond its earliest planning documentation** (`docs/ARCHITECTURE.md` and `docs/IMPLEMENTATION_STATUS.md`):

1. **Database Migration (PostgreSQL → MongoDB):**
   - *Old Docs:* Documented PostgreSQL 15 with raw SQL constraints, `SELECT ... FOR UPDATE` row locks, and table schemas.
   - *Actual Code:* Complete transition to **MongoDB (Mongoose 9.9.5 / MongoDB 7.0)**. Concurrency is handled via atomic MongoDB conditional updates (`$expr` + `$inc`), TTL indexes for tokens and rate limits, and compound unique indexes.
2. **Domain Model Evolution (1:1 Tenant-to-Domain → Multi-Domain per Tenant):**
   - *Old Docs:* Stated strict invariant "1 Tenant = exactly 1 Domain" enforced by unique DB constraints.
   - *Actual Code:* The active backend and tenant portal have been generalized to support **Multi-Domain management per Tenant** (`tenantId` on `DomainModel` is a non-unique foreign key; `isPrimary` flag designates the default domain; multiple domains can be added, activated via DNS, deleted, or scoped to moderators).
3. **Role Architecture (Dual Roles → Three Distinct Roles):**
   - *Old Docs:* `SUPER_ADMIN` and `TENANT_ADMIN`.
   - *Actual Code:* Added **`TENANT_MODERATOR`** with granular domain-level scoping (`scopedDomainIds`).
4. **Subscription & Plan Model (Fixed Limits → Stripe Metered/Fixed Billing):**
   - *Old Docs:* Hardcoded per-tenant mailbox limits set by Super Admin.
   - *Actual Code:* Multi-tier subscription model (`PlanModel`, `DomainSubscriptionModel`), supporting both fixed and metered billing via Stripe with trial periods (default 60 days) and grace periods (7 days).
5. **Self-Service Public Onboarding & Platform Identity Mailbox:**
   - *Old Docs:* Tenant creation only by Super Admin manual approval.
   - *Actual Code:* Direct public registration wizard (`public.routes.ts`, `RegisterView.tsx`) allowing users to sign up and receive a platform identity mailbox (`username@PLATFORM_MAIL_DOMAIN`, default `dhkmail.com`) before bringing custom domains.

---

## 3. Component & Structural Overview

```text
toowix-mail-platform/
├── apps/
│   ├── super-admin/            # Platform Super Admin SPA (Vite + React 18)
│   │   ├── src/components/     # PlatformAdminDashboard, SuperAdminLoginView, etc.
│   │   └── src/api.ts          # Client communication with /api/super-admin, /api/platform/tenants, etc.
│   └── tenant-admin/           # Tenant Admin & User Onboarding SPA (Vite + React 18)
│       ├── src/components/     # TenantAdminDashboard, DomainSetupModal, RegisterView, BillingView, etc.
│       └── src/api.ts          # Client communication with /api/tenants, /api/mailboxes, etc.
├── backend/
│   ├── src/
│   │   ├── api/                # Express REST routes (14 route files)
│   │   ├── auth/               # Argon2id password hashing, JWT/OIDC tokens, TOTP 2FA, RBAC
│   │   ├── cloudflare/         # Cloudflare DNS API client (bearer token auth)
│   │   ├── config.ts           # Typed environment variables and defaults
│   │   ├── db/
│   │   │   ├── models/         # 19 Mongoose schemas and models
│   │   │   ├── connection.ts   # MongoDB connection handling & index synchronization
│   │   │   └── seed.ts         # Seeding for Super Admin, default plans, system settings
│   │   ├── dns-providers/      # DNS detection & multi-provider dispatch (GoDaddy, Hostinger, Cloudflare)
│   │   ├── godaddy/            # GoDaddy DNS API client (Key/Secret auth)
│   │   ├── hostinger/          # Hostinger DNS API client (API Token auth)
│   │   ├── jobs/               # Periodic sweep jobs (DNS propagation, billing grace)
│   │   ├── services/           # 20 business logic services (mailbox, billing, lifecycle, deletion, etc.)
│   │   ├── stalwart/           # Stalwart JMAP/REST client and error translation
│   │   └── stripe/             # Stripe SDK wrapper, checkout sessions, billing meters
│   └── tests/                  # 40 backend test suites (unit + integration)
├── deploy/
│   ├── docker-compose.dev.yml  # Dev compose (Mongo 7.0, Stalwart latest, Bulwark webmail)
│   ├── docker-compose.prod.yml # Production compose configuration
│   └── stalwart-bootstrap/     # Setup scripts for Stalwart initial user/auth
└── docs/                       # Project documentation & architectural notes
```

---

## 4. What Exists & Works (Complete Functionality)

Based on the code analysis and verified by the passing test suite (675 passing tests across 71 files), the following subsystems are fully implemented and operational:

### 4.1 Authentication & Security (`backend/src/auth`, `backend/src/api/auth.routes.ts`)
- **Password Security:** Hashes passwords using **Argon2id**. Mailbox passwords are sent directly to Stalwart and never stored in plain text in MongoDB.
- **Dual Portal / Role-Based Access Control:**
  - `SUPER_ADMIN`: Accesses `apps/super-admin`, system status, tenant lifecycle, plans, coupons, audit logs.
  - `TENANT_ADMIN`: Accesses `apps/tenant-admin`, company profile, domain management, mailbox CRUD, moderators, billing.
  - `TENANT_MODERATOR`: Restricted within tenant to specific domains (`scopedDomainIds`).
- **Two-Factor Authentication (2FA):**
  - TOTP via `otplib` with QR code generation (`qrcode`).
  - Emergency single-use backup codes (10 hashed codes per user) with email delivery on generation.
  - Pre-login check (`POST /api/auth/check-2fa`) to route users seamlessly into 2FA flows.
  - Email-based OTP login alternative.
- **Session Management:**
  - Tracked in `AdminSessionModel` (records IP, User-Agent, browser, OS, device type, geo-location, activity time).
  - Active session listings and remote session revocation (`POST /api/auth/sessions/:id/revoke`).
- **Account Recovery & Forgot Password:**
  - Multi-path password recovery: security questions, email OTP, recovery token.
- **Rate Limiting:**
  - MongoDB-backed rate limiter (`RateLimitEntryModel`) with automatic TTL expiry to protect against brute-force attacks across restarts.

### 4.2 Tenant & Domain Management (`backend/src/api/tenant.routes.ts`, `platform-tenant.routes.ts`)
- **Tenant Lifecycle:** Creation, status transitions (`pending_review`, `approved_pending_setup`, `active`, `suspended`, `pending_deletion`, `archived`).
- **Multi-Domain Capability:** Tenants can register and maintain multiple domains.
- **Automated DNS Setup & Verification:**
  - Automated DNS provider detection (`detect-provider.ts`) via NS lookups.
  - Direct API provisioning for **GoDaddy**, **Hostinger**, and **Cloudflare**.
  - Generated records: MX, SPF (TXT), DKIM (TXT from Stalwart public key), DMARC (TXT), SRV, CAA, and full BIND zone file generation.
  - Conflict detection & resolution for colliding DNS entries.
  - Background sweep (`dns-propagation-sweep.job.ts`) for asynchronous DNS verification with 48h timeout.
- **IP Security Rules:** Domain-level IP whitelisting (`allowedIps`) and blacklisting (`blockedIps`) with CIDR validation.

### 4.3 Mailbox Management & Quota Enforcement (`backend/src/services/mailbox.service.ts`)
- **Atomic Quota Reservation:** Uses MongoDB atomic conditional update:
  ```typescript
  TenantModel.findOneAndUpdate(
    { _id: tenantId, status: 'active', $expr: { $lt: ['$mailboxCount', '$mailboxLimit'] } },
    { $inc: { mailboxCount: 1 } },
    { returnDocument: 'after' }
  );
  ```
  Rolls back automatically if subsequent Stalwart mailbox creation fails.
- **Stalwart Account Synchronization:** Provisions Stalwart principals with JMAP credentials, handles email aliases, password resets, and account suspension.
- **Mailbox Aliases:** Full alias support per mailbox; aliases are verified for domain ownership and synchronized to Stalwart.
- **Cross-Mailbox Migration:** Background mailbox migration (`MailboxMigrationJobModel`) for transferring messages between mailboxes before deletion.

### 4.4 Multi-Tier Billing & Stripe Integration (`backend/src/services/billing.service.ts`)
- **Stripe Integration:**
  - Webhook processing with raw body signature verification (`/api/webhooks/stripe`).
  - Checkout session creation, SetupIntents for saving customer payment methods.
  - Plan selection (`PlanModel`) supporting both fixed seats and metered (usage-based via Stripe Billing Meters with peak usage tracking).
- **Grace Period & Suspension Sweep:**
  - 60-day default trial period.
  - 7-day grace period on failed renewal (`billing-grace-sweep.job.ts` automatically suspends delinquent domains).
  - Can be toggled on/off via environment configuration (`ENABLE_BILLING` / `SKIP_BILLING`).

### 4.5 7-Day Multi-Stage Organisation Deletion (`backend/src/services/organisation-deletion.service.ts`)
- Deliberate, secure decommissioning pipeline:
  1. Deletion request initiated with justification.
  2. Exact organisation name confirmed (triggers immediate suspension of all services).
  3. Mandatory 7-day safety lock.
  4. Final OTP generated and emailed to tenant admin.
  5. 24-hour final lock before verification.
  6. Final OTP verification executes permanent purge of Stalwart accounts/domains and marks the registration identity as permanently blocked (`BlockedRegistrationIdentityModel`).
  7. Permanent audit trail retained in `OrganisationDeletionModel`.
- Immediate forced deletion available only to Super Admin (`DELETE /api/platform/tenants/:id`).

### 4.6 Telemetry, Drift Reconciliation & Backups
- **Prometheus Metrics:** Standard `/metrics` endpoint exposing HTTP metrics via `metrics.service.ts`.
- **Stalwart Drift Reconciliation:** Compares MongoDB domain and mailbox state against Stalwart's live JMAP directory to detect orphaned accounts or missing configurations (`reconciliation.service.ts`).
- **Encrypted Backups:** Full database backup generation with SHA-256 checksums and optional local or S3 storage (`backup.service.ts`).

---

## 5. What Is Incomplete or Needs Work

1. **Email Service Configuration & Delivery:**
   - `emailService` (`backend/src/services/email.service.ts`) logs OTPs and notification emails to the console (`[EMAIL DISPATCH: SUCCESS]`) when live SMTP transport fails or is in development. Proper production SMTP credentials and bounce handling need verification in staging.
2. **Webmail Integration (Bulwark):**
   - `deploy/docker-compose.dev.yml` includes Bulwark JMAP webmail, but it is not deeply integrated into the tenant admin portal (tenant admin has links/placeholders pointing to webmail URL, but lacks automatic single sign-on / deep-link session handover).
3. **Keycloak / OIDC External Identity Migration:**
   - The token payload structure is named `OidcAuthTokenPayload` with fields like `iss: 'toowix-auth'`, `aud: 'toowix-api'`, and `sub`. However, all authentication is currently local in-app (Mongoose + Argon2id). External OIDC/OAuth2 login federation (Keycloak / Google / GitHub) is prepared in data structures but not yet wired to external identity provider endpoints.
4. **Stripe Billing Setup in Live Mode:**
   - The Stripe implementation is architecturally complete (Webhooks, SetupIntents, Subscriptions, Meter events), but depends on actual Stripe API keys and configured product prices in production.

---

## 6. What Exists Only in Documentation vs. Reality

| Topic / Requirement | Old Documentation Claim | Actual Codebase Reality |
|---|---|---|
| **Database** | PostgreSQL 15 with SQL migrations & DDL constraints (`UNIQUE (tenant_id)`) | **MongoDB 7.0** using Mongoose 9.9.5 models and MongoDB indexes. |
| **Concurrency Locking** | PostgreSQL `SELECT ... FOR UPDATE` row locks | MongoDB **Atomic conditional queries** (`findOneAndUpdate` with `$expr` and `$inc`). |
| **Tenant Domain Cardinality** | Strictly 1 Tenant = 1 Domain | **Multi-Domain support** per Tenant (`TenantModel` has many `DomainModel`s; primary domain flag). |
| **Admin Roles** | 2 roles (`SUPER_ADMIN`, `TENANT_ADMIN`) | **3 roles** (`SUPER_ADMIN`, `TENANT_ADMIN`, `TENANT_MODERATOR` with domain scoping). |
| **Tenant Onboarding** | Super Admin manually creates tenant, generates activation link | **Self-service direct public registration** with platform identity mailbox allocation. |
| **Frontend Setup** | Single monolithic frontend mentioned in early docs | Two distinct Vite apps (`apps/super-admin` and `apps/tenant-admin`). |
| **Coupon Logic** | Percentage/fixed monetary discounts | Coupons strictly provide **extra trial days** (`CouponModel.extraTrialDays`). |

---

## 7. Data Model Overview (MongoDB Collections)

| Collection / Model | Key Responsibilities | Relationships & Constraints |
|---|---|---|
| **`tenants`** (`TenantModel`) | Company identity, overall mailbox quota (`mailboxLimit`), current `mailboxCount`, Stripe customer ID, status. | Parent to Domains, AdminUsers, Mailboxes. |
| **`domains`** (`DomainModel`) | Custom domain names, Stalwart domain reference, DNS status (`dnsStatus`), generated DNS records, DKIM public key, IP whitelist/blacklist. | References `Tenant` via `tenantId`. `domainName` is unique. |
| **`admin_users`** (`AdminUserModel`) | Login identities for Super Admin, Tenant Admin, and Tenant Moderator. Holds Argon2id password hash, 2FA secret, backup codes, recovery OTPs. | References `Tenant` via `tenantId` (nullable for Super Admin). Scoped domain IDs for moderators. |
| **`mailboxes`** (`MailboxModel`) | End-user mailboxes (`address`, `localPart`). Security profile (temporary password flags, 2FA). Embedded array of aliases. | References `Tenant` (`tenantId`) and `Domain` (`domainId`). Compound unique on `{tenantId, localPart}` and `{domainId, localPart}`. |
| **`domain_subscriptions`** (`DomainSubscriptionModel`) | Tracks Stripe subscription status (`trialing`, `active`, `past_due`, `grace`), period end, peak mailbox usage for metered billing. | 1:1 with `Domain` via unique `domainId`. References `Tenant` and `Plan`. |
| **`plans`** (`PlanModel`) | Available tiers (`Starter`, `Pro`, `Enterprise`) with seat counts, price in paise, billing mode (`fixed` vs. `metered`), storage quotas. | Referenced by `Domain` and `DomainSubscription`. |
| **`organisation_deletions`** (`OrganisationDeletionModel`) | Permanent security record and audit timeline for 7-day decommissioning workflow. Retained even after tenant purge. | Contains plain `tenantId` (no cascade deletion). Unique on active stages. |
| **`blocked_registration_identities`** (`BlockedRegistrationIdentityModel`) | Prevents re-registration using emails belonging to previously deleted organisations. | Indexed by normalized lowercase email. |
| **`tenant_dns_credentials`** (`TenantDnsCredentialModel`) | Tenant-wide vault for encrypted provider credentials (GoDaddy, Hostinger, Cloudflare). | Unique on `{tenantId, provider}`. AES-256 encrypted secrets. |
| **`domain_dns_credentials`** (`DomainDnsCredentialModel`) | Ephemeral per-domain DNS credentials used during domain activation wizard; deleted on success. | Unique on `domainId`. |
| **`audit_logs`** (`AuditLogModel`) | Immutable log of administrative actions, actor IP, role, action, target resource, metadata. | Indexed by `tenantId` and `timestamp`. |
| **`admin_sessions`** (`AdminSessionModel`) | Active administrative sessions with device/browser fingerprint and revocation status. | Indexed by `userId` and `expiresAt` with TTL cleanup. |
| **`mailbox_migration_jobs`** (`MailboxMigrationJobModel`) | Tracks progress of mailbox message migrations across accounts. | References source and destination mailboxes. |
| **`coupons`** (`CouponModel`) | Promotional codes granting additional trial days. | Unique `code`, tracks redemption list. |
| **`system_settings`** (`SystemSettingsModel`) | Global platform settings: alerts webhook, mail limits (attachment size), DNS sweep timings. | Key-value store. |
| **`backup_records`** (`BackupRecordModel`) | History of platform database backups with checksums and status. | Stores backup file metadata and record counts. |
| **`rate_limit_entries`** (`RateLimitEntryModel`) | Persistent store for rate limiting login/registration attempts. | TTL-indexed on `resetAt`. |

---

## 8. Security Architecture & Threat Defenses

1. **Stalwart Credential Seclusion:** Stalwart administrative credentials are known only to the backend server process. Neither Super Admins nor Tenant Admins have direct access to Stalwart's REST/JMAP ports.
2. **Cross-Tenant IDOR Defense:** Access checks verify that the requesting tenant ID matches the resource's tenant ID. If an unauthorized tenant requests a mailbox or domain belonging to another company, the API intentionally returns `404 Not Found` (rather than `403 Forbidden`) to prevent enumeration of valid IDs.
3. **Privilege Boundary Enforcement:**
   - Super Admin routes guarded by `requireSuperAdmin`.
   - Tenant Admin routes guarded by `requireTenantAdmin`.
   - Moderator routes guarded by `requireTenantAdminOrModerator` with sub-resource checks (`isDomainInScope`).
4. **Credential Encryption at Rest:** DNS provider API keys and tokens are encrypted before storage in MongoDB using AES-256-GCM (`backend/src/utils/crypto.ts`) with a dedicated encryption key.
5. **No Password Persistence for Mailboxes:** Mailbox creation passes passwords straight to Stalwart's internal credential store. MongoDB stores only the account metadata and security flags.
6. **Immutable Audit Trail:** All tenant state mutations, deletions, password resets, and permission changes emit structured audit logs to MongoDB.

---

## 9. Technical Debt & Inconsistencies to Reconcile

1. **Obsolete Root Documentation:**
   - `docs/ARCHITECTURE.md` and `docs/IMPLEMENTATION_STATUS.md` describe a PostgreSQL-based system with 1:1 domain cardinality and 43 tests. The actual system is MongoDB-based with multi-domain support and 675 passing tests. These docs create confusion for new developers and should be marked as legacy or updated to reflect the actual architecture.
2. **Leftover `super-admin.routes.ts` Artifact:**
   - `backend/src/api/super-admin.routes.ts` contains an incomplete single-line commented file with unreferenced imports. Super Admin operations are actually handled in `platform-tenant.routes.ts`, `system.routes.ts`, `plans.routes.ts`, and `coupon.routes.ts`.
3. **Hardcoded Port Mappings in Docs vs. Compose:**
   - In `docker-compose.dev.yml`, Stalwart management is exposed on `8085`, whereas some comments in docs refer to `8080`.
4. **Stripe Webhook in Development:**
   - When running locally without Stripe CLI or live webhooks, billing events rely on synchronous test bypasses (`SKIP_BILLING=true` or test helpers). Local developer setup guidelines need documentation.

---

## 10. Open Decisions for Future Development

Before proceeding with next implementation phases, the following decisions should be confirmed:

1. **Documentation Alignment:** Should `docs/ARCHITECTURE.md` and `docs/IMPLEMENTATION_STATUS.md` be formally updated to reflect the MongoDB + Multi-Domain + 3-Tier Billing architecture, or will BMAD artifacts serve as the new architecture baseline?
2. **Bulwark Webmail SSO Handover:** How should end-users transition from the Tenant Portal to the Bulwark Webmail interface? (Options: direct link to webmail login vs. automated token/cookie exchange).
3. **OIDC/Keycloak Timeline:** The backend auth token format is already aligned with OIDC (`OidcAuthTokenPayload`), but authentication is currently handled internally with Argon2id and Mongoose. Is Keycloak federation required in the near term, or should the in-app auth engine remain primary?
4. **Stripe Production Configuration:** For deployment to staging/production, what currency and pricing schedule should be configured in Stripe (INR paise vs. USD cents)?

---

## 11. Recommended Next BMAD Step

Now that the complete project baseline is established and verified:

> **Recommended Next Step:** Run **`bmad-spec`** (or **`bmad-prd`** if feature scope needs product refinement) to create the formal specifications for the upcoming work, building directly on this verified MongoDB/Multi-Domain/Stripe architecture baseline.
>
> *(Note: As requested, no implementation work or code changes have been performed in this step.)*
