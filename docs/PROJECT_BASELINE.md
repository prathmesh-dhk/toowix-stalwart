# Toowix Mail Platform — Current State & Project Baseline

**Evaluation Date:** October 2026  
**Document Purpose:** Baseline technical assessment of the existing repository as implemented today, establishing what works, what is incomplete, what is planned, and technical discrepancies between early documentation and current code.

---

## 1. Executive Summary & Core Mission

**Toowix Mail Platform** is a multi-tenant SaaS email management control plane designed around a shared, self-hosted **Stalwart Mail Server (Community Edition)**. 

Because Stalwart Community Edition is flat (it does not include native multi-tenancy, per-tenant quotas, or delegated tenant administration—which are restricted to Stalwart Enterprise), Toowix implements the complete multi-tenant control plane in its own application and database layer. Stalwart is utilized strictly as the low-level delivery and storage engine via its JMAP/REST Management API.

The project currently has a **substantially built, highly operational codebase** featuring:
- A full **Node.js/Express/TypeScript** backend with **MongoDB (Mongoose 9.9.5 / MongoDB 7.0)** as the primary persistence layer.
- Two dedicated React 18 / Vite single-page applications:
  - `apps/super-admin` (Super Admin portal on port `5174` / `5173`)
  - `apps/tenant-admin` (Tenant Admin, Moderator & Onboarding portal on port `5175` / `5174`)
- Automated integrations with Stalwart Mail Server, Stripe (Consolidated Subscriptions, Multi-Card Payment Methods, Checkout, SetupIntents, Billing Meters), DNS automation providers (GoDaddy, Hostinger, Cloudflare), and custom SMTP transactional email dispatch.
- A comprehensive automated test suite across backend and frontends (**87 test files, 872 passing automated tests, 10 skipped** in Vitest).

---

## 2. Source of Truth: Implemented Features vs. Early Documentation

A crucial discovery during baseline inspection is that **the codebase has evolved far beyond its earliest planning documentation** (`docs/ARCHITECTURE.md` and `docs/IMPLEMENTATION_STATUS.md`):

1. **Database Migration (PostgreSQL → MongoDB):**
   - *Old Docs:* Documented PostgreSQL 15 with raw SQL constraints, `SELECT ... FOR UPDATE` row locks, and table schemas.
   - *Actual Code:* Complete transition to **MongoDB (Mongoose 9.9.5 / MongoDB 7.0)**. Concurrency is handled via atomic MongoDB conditional updates (`$expr` + `$inc`), TTL indexes for tokens and rate limits, and compound unique indexes.
2. **Domain Model Evolution (1:1 Tenant-to-Domain → Multi-Domain per Tenant):**
   - *Old Docs:* Stated strict invariant "1 Tenant = exactly 1 Domain" enforced by unique DB constraints.
   - *Actual Code:* The active backend and tenant portal support **Multi-Domain management per Tenant** (`tenantId` on `DomainModel` is a non-unique foreign key; `isPrimary` flag designates the default domain; multiple domains can be added, activated via DNS, deleted, or scoped to moderators).
3. **Role Architecture (Dual Roles → Three Distinct Roles):**
   - *Old Docs:* `SUPER_ADMIN` and `TENANT_ADMIN`.
   - *Actual Code:* Added **`TENANT_MODERATOR`** with granular domain-level scoping (`scopedDomainIds`).
4. **Subscription & Plan Model (Fixed Limits → Stripe Metered/Fixed Consolidated Billing):**
   - *Old Docs:* Hardcoded per-tenant mailbox limits set by Super Admin.
   - *Actual Code:* Multi-tier subscription model (`PlanModel`, `DomainSubscriptionModel`), supporting both fixed and metered billing via Stripe with configurable trial periods (managed via `trial-config.service.ts`) and grace periods (7 days).
5. **Multi-Card Payment Methods & Tenant Billing Redesign:**
   - *Old Docs:* Single payment method, limited card management.
   - *Actual Code:* Full multi-card support per tenant (`ITenantPaymentMethod[]`), allowing tenants to add multiple cards via SetupIntents, designate default cards (synced bidirectionally with Stripe Customer defaults), and delete non-default cards. Dedicated full-width Payment Methods table layout and separate domain Plan tabs.
6. **Self-Service Public Onboarding & Platform Identity Mailbox:**
   - *Old Docs:* Tenant creation only by Super Admin manual approval.
   - *Actual Code:* Direct public registration wizard (`public.routes.ts`, `RegisterView.tsx`) allowing users to sign up and receive a platform identity mailbox (`username@PLATFORM_MAIL_DOMAIN`, default `dhkmail.com`) before bringing custom domains.
7. **Safe Cross-Mailbox and Remote Server Migration:**
   - *Old Docs:* Immediate mailbox deletion.
   - *Actual Code:* Built-in "migrate before delete" workflow (`MailboxMigrationJobModel`), plus comprehensive architecture guide for external Stalwart server migration (`docs/REMOTE_STALWART_MIGRATION_GUIDE.md`).

---

## 3. Component & Structural Overview

```text
toowix-mail-platform/
├── apps/
│   ├── super-admin/            # Platform Super Admin SPA (Vite + React 18)
│   │   ├── src/components/     # PlatformAdminDashboard, SuperAdminLoginView, Views (Tenants, Plans, Settings, etc.)
│   │   └── src/api.ts          # Client communication with /api/super-admin, /api/platform/tenants, etc.
│   └── tenant-admin/           # Tenant Admin & User Onboarding SPA (Vite + React 18)
│       ├── src/components/     # TenantAdminDashboard, DomainSetupModal, RegisterView, BillingView, PaymentMethodSelector, CartView, etc.
│       └── src/api.ts          # Client communication with /api/tenants, /api/mailboxes, etc.
├── backend/
│   ├── src/
│   │   ├── api/                # Express REST routes (14 route files: auth, tenant, platform-tenant, public, etc.)
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
│   │   ├── jobs/               # Periodic sweep jobs (DNS propagation, billing grace, held mailboxes)
│   │   ├── services/           # 22 business logic services (mailbox, billing, cart, trial-config, lifecycle, etc.)
│   │   ├── stalwart/           # Stalwart JMAP/REST client and error translation
│   │   └── stripe/             # Stripe SDK wrapper, checkout sessions, customer portal, billing meters
│   └── tests/                  # 48 backend test suites (unit + integration + end-to-end)
├── deploy/
│   ├── docker-compose.dev.yml  # Dev compose (Mongo 7.0, Stalwart latest, Bulwark webmail)
│   ├── docker-compose.prod.yml # Production compose configuration
│   ├── roundcube/              # Roundcube webmail integration assets
│   ├── stalwart-bootstrap/     # Setup scripts for Stalwart initial user/auth
│   └── stripe-go-live.sh       # Production Stripe go-live validation wizard
└── docs/                       # Project documentation, architectural specs & runbooks
```

---

## 4. What Exists & Works (Complete Functionality)

Verified by the passing test suite (**872 passing tests across 87 test files**), the following subsystems are fully implemented and operational:

### 4.1 Authentication & Security (`backend/src/auth`, `backend/src/api/auth.routes.ts`)
- **Password Security:** Hashes passwords using **Argon2id**. Mailbox passwords are sent directly to Stalwart and never stored in plain text in MongoDB.
- **Dual Portal / Role-Based Access Control:**
  - `SUPER_ADMIN`: Accesses `apps/super-admin`, system status, tenant lifecycle, plans, coupons, audit logs, trial configuration.
  - `TENANT_ADMIN`: Accesses `apps/tenant-admin`, company profile, domain management, mailbox CRUD, moderators, billing, payment methods.
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
- **Mailbox Aliases:** Full alias support per mailbox; aliases are verified for domain ownership and synchronized to Stalwart as dictionary maps.
- **Safe Cross-Mailbox Migration:** Background mailbox migration (`MailboxMigrationJobModel`, `mailbox-migration.service.ts`) for transferring messages between mailboxes before deletion. The frontend Delete Mailbox modal highlights migration to avoid data loss.

### 4.4 Multi-Tier Billing & Stripe Integration (`backend/src/services/billing.service.ts`)
- **Stripe Architecture:**
  - Consolidated Tenant Stripe Subscription managing individual domain items.
  - Webhook processing with raw body signature verification and event idempotency (`/api/webhooks/stripe`, `StripeEventModel`).
  - Checkout session creation, SetupIntents for saving customer payment methods.
  - Plan selection (`PlanModel`) supporting both fixed seats and metered (usage-based via Stripe Billing Meters with peak usage tracking).
- **Multi-Card Payment Method Management:**
  - Tenants can attach multiple cards (`TenantModel.paymentMethods`).
  - Bidirectional sync: setting a default card in Toowix updates Stripe Customer `default_payment_method` and vice-versa.
  - Deletion of secondary payment methods with protection on the active default card.
  - Full-width table layout in `PaymentMethodSelector.tsx` displaying card brand, last 4 digits, expiry, default badge, and action menus.
- **Trial & Grace Period Management:**
  - Configurable trial duration managed by Super Admin (`trial-config.service.ts`), replacing hardcoded periods.
  - One card can initiate free trials across multiple legitimate organizations (`cardFingerprint` tracking).
  - 7-day grace period on failed renewal (`billing-grace-sweep.job.ts` automatically suspends delinquent domains).
  - Toggled via environment configuration (`ENABLE_BILLING` / `SKIP_BILLING`).
- **Cart & Upgrade Flow:**
  - Cart only lists unactivated/held mailboxes; automatically empties upon activation payment.
  - Bank-approved upgrades and additional seats are charged immediately; domain restoration charges immediately.
  - Scheduled cancellations handled at period end (`cancelAtPeriodEnd`, `scheduledCancelAt`).
- **Stripe Go-Live Wizard:**
  - `deploy/stripe-go-live.sh` provides step-by-step verification of live API keys, webhook endpoint secrets, customer receipt settings, database connectivity, and live test charges.

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

### 4.7 Mailbox & Server Migration Engine
- **Intra-Tenant Mailbox Migration:** Built-in service (`mailbox-migration.service.ts`) copies messages between accounts on the same cluster using JMAP copy operations.
- **Remote Stalwart Migration Specification:** Detailed engineering guide (`docs/REMOTE_STALWART_MIGRATION_GUIDE.md`) and blueprint for connecting to external Stalwart instances, extracting domains/accounts/aliases, generating secure temporary passwords, provisioning local DKIM keys, and ingesting records into MongoDB.

---

## 5. What Is Incomplete or Needs Work

1. **Email Service Configuration & Live Relay Delivery:**
   - `emailService` (`backend/src/services/email.service.ts`) logs OTPs and notification emails to the console (`[EMAIL DISPATCH: SUCCESS]`) when live SMTP transport is in development or unreachable. Proper production SMTP credentials (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) and bounce handling require live staging verification.
2. **Webmail SSO Integration (Bulwark / Roundcube):**
   - Both Bulwark (`deploy/docker-compose.dev.yml`) and Roundcube (`deploy/roundcube`) configurations exist. However, the tenant portal currently links to external webmail URLs without automated single sign-on (SSO) session exchange.
3. **Keycloak / OIDC External Identity Federation:**
   - The token payload structure is named `OidcAuthTokenPayload` with fields like `iss: 'toowix-auth'`, `aud: 'toowix-api'`, and `sub`. However, all authentication is currently local in-app (Mongoose + Argon2id). External OIDC/OAuth2 login federation (Keycloak / Google / Microsoft) is prepared in data structures but not yet wired to external identity provider endpoints.

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
| **Payment Methods** | Single static payment card | **Multi-card payment management** with default selection and bidirectional Stripe synchronization. |
| **Trial Duration** | Fixed 60 days hardcoded | **Dynamically configurable trial days** set by Super Admin via `trial-config.service.ts`. |
| **Coupon Logic** | Percentage/fixed monetary discounts | Coupons strictly provide **extra trial days** (`CouponModel.extraTrialDays`). |
| **Test Suite** | 43 or 675 tests mentioned | **87 test files with 872 passing automated tests (10 skipped)**. |

---

## 7. Data Model Overview (MongoDB Collections)

| Collection / Model | Key Responsibilities | Relationships & Constraints |
|---|---|---|
| **`tenants`** (`TenantModel`) | Company identity, overall mailbox quota (`mailboxLimit`), current `mailboxCount`, Stripe customer ID, payment methods list (`paymentMethods`), status. | Parent to Domains, AdminUsers, Mailboxes. |
| **`domains`** (`DomainModel`) | Custom domain names, Stalwart domain reference, DNS status (`dnsStatus`), generated DNS records, DKIM public key, IP whitelist/blacklist. | References `Tenant` via `tenantId`. `domainName` is unique. |
| **`admin_users`** (`AdminUserModel`) | Login identities for Super Admin, Tenant Admin, and Tenant Moderator. Holds Argon2id password hash, 2FA secret, backup codes, recovery OTPs. | References `Tenant` via `tenantId` (nullable for Super Admin). Scoped domain IDs for moderators. |
| **`mailboxes`** (`MailboxModel`) | End-user mailboxes (`address`, `localPart`). Security profile (temporary password flags, 2FA). Embedded array of aliases. | References `Tenant` (`tenantId`) and `Domain` (`domainId`). Compound unique on `{tenantId, localPart}` and `{domainId, localPart}`. |
| **`domain_subscriptions`** (`DomainSubscriptionModel`) | Tracks Stripe subscription status (`trialing`, `active`, `past_due`, `grace`), period end, peak mailbox usage for metered billing, scheduled cancellation. | 1:1 with `Domain` via unique `domainId`. References `Tenant` and `Plan`. |
| **`plans`** (`PlanModel`) | Available tiers (`Starter`, `Pro`, `Enterprise`) with seat counts, price in paise, billing mode (`fixed` vs. `metered`), storage quotas. | Referenced by `Domain` and `DomainSubscription`. |
| **`organisation_deletions`** (`OrganisationDeletionModel`) | Permanent security record and audit timeline for 7-day decommissioning workflow. Retained even after tenant purge. | Contains plain `tenantId` (no cascade deletion). Unique on active stages. |
| **`blocked_registration_identities`** (`BlockedRegistrationIdentityModel`) | Prevents re-registration using emails belonging to previously deleted organisations. | Indexed by normalized lowercase email. |
| **`tenant_dns_credentials`** (`TenantDnsCredentialModel`) | Tenant-wide vault for encrypted provider credentials (GoDaddy, Hostinger, Cloudflare). | Unique on `{tenantId, provider}`. AES-256 encrypted secrets. |
| **`domain_dns_credentials`** (`DomainDnsCredentialModel`) | Ephemeral per-domain DNS credentials used during domain activation wizard; deleted on success. | Unique on `domainId`. |
| **`audit_logs`** (`AuditLogModel`) | Immutable log of administrative actions, actor IP, role, action, target resource, metadata. | Indexed by `tenantId` and `timestamp`. |
| **`admin_sessions`** (`AdminSessionModel`) | Active administrative sessions with device/browser fingerprint and revocation status. | Indexed by `userId` and `expiresAt` with TTL cleanup. |
| **`mailbox_migration_jobs`** (`MailboxMigrationJobModel`) | Tracks progress of mailbox message migrations across accounts. | References source and destination mailboxes. |
| **`coupons`** (`CouponModel`) | Promotional codes granting additional trial days. | Unique `code`, tracks redemption list. |
| **`system_settings`** (`SystemSettingsModel`) | Global platform settings: alerts webhook, mail limits, DNS sweep timings, default trial duration. | Key-value store. |
| **`backup_records`** (`BackupRecordModel`) | History of platform database backups with checksums and status. | Stores backup file metadata and record counts. |
| **`rate_limit_entries`** (`RateLimitEntryModel`) | Persistent store for rate limiting login/registration attempts. | TTL-indexed on `resetAt`. |
| **`stripe_events`** (`StripeEventModel`) | Tracks processed Stripe webhook event IDs for idempotency and replay protection. | Unique on `eventId`. |
| **`activation_tokens`** (`ActivationTokenModel`) | Manages secure one-time activation tokens for tenant onboarding. | TTL-indexed on `expiresAt`. |

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
   - `docs/ARCHITECTURE.md` and `docs/IMPLEMENTATION_STATUS.md` describe an early PostgreSQL-based system with 1:1 domain cardinality. They should be formally marked as legacy references to avoid confusing new team members.
2. **Leftover `super-admin.routes.ts` Artifact:**
   - `backend/src/api/super-admin.routes.ts` contains an incomplete commented skeleton. Super Admin operations are actually handled in `platform-tenant.routes.ts`, `system.routes.ts`, `plans.routes.ts`, and `coupon.routes.ts`.
3. **Port Mappings in Dev vs. Production:**
   - In `docker-compose.dev.yml`, Stalwart management is exposed on `8085`, whereas production compose connects internally to `STALWART_URL`.

---

## 10. Open Decisions for Future Development

1. **Documentation Alignment:** Formally deprecate or archive `docs/ARCHITECTURE.md` in favor of `docs/PROJECT_BASELINE.md` and BMAD documentation.
2. **Bulwark & Roundcube Webmail SSO Handover:** How should end-users transition from the Tenant Portal to the Webmail interface? (Options: direct link to webmail login vs. automated token/cookie exchange).
3. **OIDC/Keycloak Timeline:** The backend auth token format is already aligned with OIDC (`OidcAuthTokenPayload`), but authentication is currently handled internally with Argon2id and Mongoose. Decide when external OAuth2/OIDC identity federation is scheduled.
4. **Remote Stalwart Migration Implementation:** With the architectural guide complete in `docs/REMOTE_STALWART_MIGRATION_GUIDE.md`, schedule implementation of dynamic multi-instance `StalwartClient` and REST endpoints.
