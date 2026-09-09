# Toowix Multi-Tenant Mail Management Platform

> A production-grade multi-tenant email management control plane running on top of a single shared **Stalwart Community Edition** mail server.

---

## 1. Architectural Highlights

- **Stalwart Community Edition Support:** Does not rely on Stalwart Enterprise features (no native `Tenant` objects, no SCIM, no native per-tenant quotas). Multi-tenancy is entirely enforced at the application level.
- **Strict 1:1 Tenant-Domain Mapping:** Every tenant has exactly one email domain, enforced at the database level via a `UNIQUE (tenant_id)` constraint on the `domains` table.
- **PostgreSQL as Single Source of Truth:** Tenancy, mailbox quotas, domains, administrative users, and audit logs are governed by PostgreSQL.
- **Zero-Trust for Tenant Admins:** Tenant Administrators never receive Stalwart credentials; all operations are proxied through a tightly-scoped backend service principal.
- **Concurrency-Safe Quota Allocation:** Mailbox creation enforces mailbox limits atomically using PostgreSQL row-level locks (`SELECT ... FOR UPDATE` on the tenant record).
- **Security-First Password Handling:** End-user mailbox passwords are sent directly to Stalwart's credential store and never persisted in PostgreSQL.
- **Cross-Tenant IDOR Protection:** Unauthorized cross-tenant queries return `404 Not Found` rather than `403 Forbidden` to prevent resource enumeration.
- **Live Drift Reconciliation:** Built-in telemetry and reconciliation engine detecting drift between PostgreSQL state and Stalwart directory objects.

---

## 2. Directory Structure

```text
toowix-mail-platform/
├── backend/
│   ├── src/
│   │   ├── api/            # Route handlers (auth, tenants, mailboxes, audit, system)
│   │   ├── auth/           # Argon2id password hashing, JWT tokens, RBAC middleware
│   │   ├── audit/          # Audit logging helper
│   │   ├── db/             # PostgreSQL connection pool, migrations, seeder
│   │   ├── services/       # Core business logic (tenant, mailbox, reconciliation)
│   │   ├── stalwart/       # JMAP client for Stalwart Community Edition
│   │   ├── app.ts          # Express application setup
│   │   ├── config.ts       # Centralized typed configuration
│   │   └── index.ts        # Server entry point
│   ├── tests/              # Comprehensive Vitest test suite (43 automated tests)
│   ├── Dockerfile          # Production multi-stage Docker build
│   └── package.json
├── apps/
│   ├── super-admin/    # Super Admin application (port 5174)
│   │   ├── src/
│   │   │   ├── components/ # SuperAdminLoginView, PlatformAdminDashboard, ForgotPasswordView
│   │   │   ├── api.ts      # API client
│   │   │   └── index.css   # Ethereal Fluid styling
│   │   └── package.json
│   └── tenant-admin/   # Tenant Admin & Public Onboarding application (port 5175)
│       ├── src/
│       │   ├── components/ # TenantAdminLoginView, RegisterView, ActivateTenantView, ForgotPasswordView
│       │   ├── api.ts      # API client
│       │   └── index.css   # Ethereal Fluid styling
│       └── package.json
├── deploy/
│   ├── docker-compose.dev.yml   # Local development Docker Compose
│   ├── docker-compose.prod.yml  # Production Docker Compose with isolated network
│   └── stalwart-bootstrap/      # Automated service principal initialization script
├── docs/
│   ├── ARCHITECTURE.md          # Complete architectural specification & decisions
│   ├── DOMAIN_SETUP_GUIDE.md    # DNS & email configuration guide
│   ├── IMPLEMENTATION_STATUS.md # Phase-by-phase completion log
│   ├── OPERATIONAL_RUNBOOK.md   # Deployment, backup, and recovery runbook
│   └── STALWART_API_NOTES.md    # Stalwart live JMAP protocol notes
└── .env.production.example      # Production environment template
```

---

## 3. Quick Start (Development)

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Stalwart Mail Server (Community Edition) running locally or accessible via HTTPS

### 1. Database & Infrastructure Setup
```bash
# Start MongoDB & Stalwart containers
docker compose -f deploy/docker-compose.dev.yml up -d
```

### 2. Run Backend
```bash
cd backend
npm run dev
```
Backend API will be running at `http://localhost:4000`.

### 3. Run Web Applications (from project root)
```bash
# Terminal 1: Run Super Admin Portal (http://localhost:5174)
npm run dev:admin

# Terminal 2: Run Tenant Admin & Onboarding Portal (http://localhost:5175)
npm run dev:tenant
```


---

## 4. Automated Testing

The backend includes a comprehensive test suite executed against live PostgreSQL and the live Stalwart server:

```bash
cd backend
npm test
```

### Test Coverage (43 Tests across 7 suites):
- `tests/health.test.ts`: Service health check.
- `tests/stalwart.test.ts`: Stalwart JMAP integration (domains, users, passwords, DKIM cleanup).
- `tests/auth.test.ts`: Authentication, password hashing, JWT sessions, and RBAC middleware.
- `tests/tenant.test.ts`: Tenant CRUD, 1:1 domain enforcement, suspension, quota adjustment, admin management.
- `tests/mailbox.test.ts`: Mailbox creation, deletion, password reset, and **5-way parallel race condition test**.
- `tests/security.test.ts`: IDOR defenses, 404 leakage prevention, role boundaries, and audit log scoping.
- `tests/reconciliation.test.ts`: Live state drift telemetry and reconciliation reporting.

---

## 5. Production Deployment

### 1. Configure Environment
Copy `.env.production.example` to `.env` and set secure passwords and secrets:
```bash
cp .env.production.example .env
```

### 2. Start Full Stack via Docker Compose
```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

### Network Isolation Invariant:
- Stalwart's management interface (`http://stalwart:8080`) is strictly placed on the `toowix-internal` Docker network. It is **never** published to the public internet or host.
- The Toowix Backend acts as the single authenticated proxy for all administrative actions.
- Only standard public mail ports (SMTP `25`, `587`, `465` and IMAP `993`, `143`) and the Web UI (`80`) are accessible on `toowix-public`.

---

## 6. Default Credentials

| Role | Email | Password |
|---|---|---|
| **Platform Administrator** | `admin@toowix.com` | `PlatformAdmin2026!` |
| **Stalwart Master Admin** | `admin@toowix.test` | wzo1tYSEbJA6UJF6 |
| **Stalwart Backend Service Principal** | `toowix-service@toowix.test` | Configured in `deploy/stalwart-bootstrap/` |
