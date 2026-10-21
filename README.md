# Toowix Multi-Tenant Mail Management Platform

> A multi-tenant hosted email control plane running on top of a single shared **Stalwart Community Edition** mail server. Companies bring their domains, create mailboxes, and pay for the active users on them.

Domain terms (Tenant, Plan, Active User, Trial, Grace Period…) are defined in [GLOSSARY.md](GLOSSARY.md); decisions are recorded in [docs/adr/](docs/adr/).

---

## 1. Architectural Highlights

- **Stalwart Community Edition Support:** Does not rely on Stalwart Enterprise features (no native `Tenant` objects, no SCIM, no native per-tenant quotas). Multi-tenancy is enforced entirely at the application level.
- **Many Domains per Tenant:** A Tenant is one billing customer and can own any number of domains. Each domain has its own Plan (user ceiling and price per active user).
- **MongoDB as Source of Truth:** Tenants, domains, mailboxes, plans, subscriptions, admin users and audit logs live in MongoDB (Mongoose models in `backend/src/db/models`).
- **Zero-Trust for Tenant Admins:** Tenant Admins never receive Stalwart credentials; all operations are proxied through a tightly scoped backend service principal.
- **Security-First Password Handling:** Mailbox passwords are sent directly to Stalwart's credential store and never persisted in MongoDB.
- **Cross-Tenant IDOR Protection:** Unauthorized cross-tenant queries return `404 Not Found` rather than `403 Forbidden` to prevent resource enumeration.
- **Automated DNS:** GoDaddy, Hostinger and Cloudflare integrations publish and verify mail DNS records; a background sweep tracks propagation.
- **Live Drift Reconciliation:** A reconciliation engine detects drift between MongoDB state and Stalwart directory objects.

---

## 2. Billing

Billing runs on Stripe, with one Stripe Subscription item per domain, consolidated into one invoice per Tenant.

- **Trial:** one free trial per Tenant (length set by the Super Admin, 60 days by default), covering every domain and user. Promo codes can extend it.
- **Cart:** mailboxes created before the trial starts are held (suspended) and listed in the Cart. Confirming a card via Stripe Checkout starts the trial and activates them; once they are active the Cart is empty again.
- **Plans:** each domain's plan, usage and *Change plan* action are shown on that domain's **Plan** tab. Payment methods, invoices and cancellation live on the organisation-wide **Billing** page (`/billing`).
- **No Stripe Customer Portal:** all billing changes go through the app ([ADR 0001](docs/adr/0001-no-stripe-customer-portal.md)).
- **Background jobs** (started with the backend): billing grace-period sweep, held-mailbox expiry, trial reminders, Stripe reconciliation and DNS propagation.

Billing is enabled automatically when `STRIPE_SECRET_KEY` is set (or with `ENABLE_BILLING=true`). Without Stripe, development uses a sandbox card form; set `ALLOW_SANDBOX_BILLING=true` to allow that outside development. The Stripe webhook is served at `/api/webhooks/stripe`.

---

## 3. Directory Structure

```text
toowix-mail-platform/
├── backend/
│   ├── src/
│   │   ├── api/            # Route handlers (auth, tenants, mailboxes, billing, cart, coupons, plans, webhooks…)
│   │   ├── auth/           # Password hashing, JWT sessions, RBAC middleware
│   │   ├── audit/          # Audit logging helper
│   │   ├── db/             # MongoDB connection, models, migrations, seeder, embedded local Mongo
│   │   ├── services/       # Business logic (tenant, mailbox, billing, cart, DNS, reconciliation…)
│   │   ├── jobs/           # Background sweeps (billing, trial, held mailboxes, DNS)
│   │   ├── stalwart/       # JMAP client for Stalwart Community Edition
│   │   ├── stripe/         # Stripe client helpers
│   │   ├── cloudflare/ godaddy/ hostinger/ dns-providers/  # DNS provider integrations
│   │   ├── app.ts          # Express application setup
│   │   ├── config.ts       # Centralized typed configuration
│   │   └── index.ts        # Server entry point
│   ├── tests/              # Vitest suite
│   ├── .env.example        # Backend environment template
│   └── package.json
├── apps/
│   ├── super-admin/        # Super Admin portal: tenants, plans, coupons, trial length
│   └── tenant-admin/       # Tenant Admin portal & public onboarding: domains, mailboxes, cart, billing
├── deploy/
│   ├── docker-compose.dev.yml   # Local development stack (MongoDB, Stalwart)
│   ├── docker-compose.prod.yml  # Production stack with isolated network
│   ├── stalwart-bootstrap/      # Service principal initialization
│   └── stripe-go-live.sh        # Stripe live-mode setup helper
├── docs/                        # Architecture, runbooks, billing plan, ADRs
├── GLOSSARY.md                  # Domain language
└── .env.production.example      # Production environment template
```

---

## 4. Quick Start (Development)

### Prerequisites
- Node.js 20+
- Docker & Docker Compose (optional — the backend can start an embedded MongoDB)
- Stalwart Mail Server (Community Edition) running locally or reachable over HTTPS

### 1. Install & configure
```bash
npm install
cp backend/.env.example backend/.env   # then fill in Stalwart, JWT and (optionally) Stripe values
```

### 2. Infrastructure
```bash
# Start MongoDB & Stalwart containers
docker compose -f deploy/docker-compose.dev.yml up -d

# …or run an embedded local MongoDB instead
npm run dev:mongo
```

### 3. Run the backend
```bash
npm run dev:backend
```
The API runs at `http://localhost:4000`.

### 4. Run the web apps (from the project root)
```bash
npm run dev:admin    # Super Admin portal  → http://localhost:5173
npm run dev:tenant   # Tenant Admin portal → http://localhost:5174
```

---

## 5. Automated Testing

Tests for the backend and both apps run from the root through a Vitest workspace:

```bash
npm test               # all projects
npm run test:coverage  # with coverage
```

Backend tests use an in-memory MongoDB. Frontend tests use Testing Library with jsdom.

---

## 6. Production Deployment

### 1. Configure Environment
Copy `.env.production.example` to `.env` and set secure passwords, secrets and Stripe keys:
```bash
cp .env.production.example .env
```

### 2. Start the Full Stack via Docker Compose
```bash
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

### Network Isolation Invariant
- Stalwart's management interface (`http://stalwart:8080`) stays on the `toowix-internal` Docker network. It is **never** published to the public internet or host.
- The Toowix backend is the single authenticated proxy for all administrative actions.
- Only the standard public mail ports (SMTP `25`, `587`, `465`, IMAP `993`, `143`) and the web UI (`80`) are exposed on `toowix-public`.

---

## 7. Default Credentials

| Role | Email | Password |
|---|---|---|
| **Platform Administrator** | `admin@toowix.com` | `PlatformAdmin2026!` |
| **Stalwart Master Admin** | `admin@toowix.test` | wzo1tYSEbJA6UJF6 |
| **Stalwart Backend Service Principal** | `toowix-service@toowix.test` | Configured in `deploy/stalwart-bootstrap/` |
