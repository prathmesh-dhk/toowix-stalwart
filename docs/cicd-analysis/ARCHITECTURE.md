# Toowix Mail Platform — CI/CD Architecture Reference

> **Purpose:** This file is a CI/CD-focused snapshot of the system architecture. It captures the build targets, Docker topology, and deployment flow relevant to automated pipelines.

---

## 1. Repository Layout (Monorepo — npm Workspaces)

```text
toowix-stalwart-main/
├── package.json              # Root workspace config (npm workspaces)
├── apps/
│   ├── super-admin/          # @toowix/super-admin — Vite + React SPA → nginx:alpine
│   │   ├── Dockerfile        # Multi-stage: node:20-alpine → nginx:alpine
│   │   ├── nginx.conf        # Reverse-proxies /api/ → backend:4000
│   │   └── package.json      # name: @toowix/super-admin
│   └── tenant-admin/         # @toowix/tenant-admin — Vite + React SPA → nginx:alpine
│       ├── Dockerfile        # Multi-stage: node:20-alpine → nginx:alpine
│       ├── nginx.conf        # Reverse-proxies /api/ → backend:4000
│       └── package.json      # name: @toowix/tenant-admin
├── backend/                  # toowix-mail-backend — Express + TypeScript API
│   ├── Dockerfile            # Multi-stage: node:20-alpine (builder) → node:20-alpine (runner)
│   ├── scripts/              # backup-s3.sh (used by backup-cron service)
│   └── package.json          # name: toowix-mail-backend
├── deploy/
│   ├── docker-compose.dev.yml
│   ├── docker-compose.prod.yml
│   ├── bulwark/              # Webmail proxy config
│   └── stalwart-bootstrap/   # Stalwart first-run setup
├── docs/                     # Architecture, operational runbook
├── scripts/                  # Test/utility scripts
├── .env.production.example   # Template for production env vars
└── .gitignore
```

---

## 2. Build Targets & Docker Images

| Service | Source Path | Dockerfile | Base Image | Runtime Image | Exposed Port | GHCR Image Name |
|---|---|---|---|---|---|---|
| **backend** | `backend/` | `backend/Dockerfile` | `node:20-alpine` (builder) | `node:20-alpine` (runner) | `4000` | `ghcr.io/prathmesh-dhk/toowix-backend` |
| **super-admin** | `apps/super-admin/` | `apps/super-admin/Dockerfile` | `node:20-alpine` (builder) | `nginx:alpine` | `80` | `ghcr.io/prathmesh-dhk/toowix-super-admin` |
| **tenant-admin** | `apps/tenant-admin/` | `apps/tenant-admin/Dockerfile` | `node:20-alpine` (builder) | `nginx:alpine` | `80` | `ghcr.io/prathmesh-dhk/toowix-tenant-admin` |

### Services NOT built by CI (pre-built images):
| Service | Image | Notes |
|---|---|---|
| **mongodb** | `mongo:7.0` | Official image, no build |
| **webmail** | `ghcr.io/bulwarkmail/webmail:latest` | Third-party, pulled as-is |
| **backup-cron** | Same image as backend | Uses backend Dockerfile with overridden entrypoint |

---

## 3. Docker Networks (Production)

```text
┌──────────────────────────────────────────────────────────┐
│                     toowix-internal                       │
│  mongodb ←→ backend ←→ super-admin ←→ tenant-admin       │
│                    ↕         ↕              ↕             │
│                 webmail   backup-cron                     │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                     toowix-public                         │
│  super-admin  |  tenant-admin  |  webmail                │
└──────────────────────────────────────────────────────────┘
```

- **`toowix-internal`**: All services. Backend connects to MongoDB and external Stalwart.
- **`toowix-public`**: Frontend SPAs + webmail (public-facing).

---

## 4. Production Domains & Port Mapping

| Domain | Service | Host Port → Container Port |
|---|---|---|
| `superadmin.toowix.com` | super-admin | `5173:80` |
| `admin.toowix.com` | tenant-admin | `5174:80` |
| `dhkmail.com` | webmail (external) | `8888:3000` |
| Backend API (internal) | backend | `127.0.0.1:4000:4000` |

---

## 5. Persistent Volumes

| Volume | Mounted In | Purpose | ⚠ Must Survive Deploys |
|---|---|---|---|
| `toowix-prod-mongodata` | mongodb → `/data/db` | All tenant/mailbox/audit data | **YES** |
| `toowix-prod-backups` | backend + backup-cron → `/app/backups` or `/var/backups/toowix` | Encrypted backup archives | **YES** |
| `toowix-prod-bulwark-settings` | webmail → `/app/data/settings` | Webmail user settings | **YES** |
| `toowix-prod-bulwark-admin` | webmail → `/app/data/admin` | Webmail admin config | **YES** |

---

## 6. Change Detection Matrix (for CI Path Filtering)

| Changed Path(s) | Affected Service(s) | Image(s) to Rebuild |
|---|---|---|
| `backend/**` | backend, backup-cron | `toowix-backend` |
| `apps/super-admin/**` | super-admin | `toowix-super-admin` |
| `apps/tenant-admin/**` | tenant-admin | `toowix-tenant-admin` |
| `deploy/docker-compose.prod.yml` | All (compose update) | None (pull & restart only) |
| `deploy/bulwark/**` | webmail | None (config-only, manual) |
| `package.json` (root) | Potentially all | Re-evaluate all |
| `docs/**`, `scripts/**`, `.gitignore` | None | No deploy needed |

---

## 7. External Dependencies (Not in Docker Compose)

| Service | Location | How Backend Reaches It |
|---|---|---|
| **Stalwart Mail Server** | `smtp.dhkmail.com` (external VPS `103.13.114.138`) | `STALWART_URL` env var, REST API |
| **Bulwark Webmail** | `dhkmail.com` (external VPS) | Not directly — users access via browser |
| **AWS S3 / Cloudflare R2** | Cloud | `AWS_*` env vars for backup uploads |
| **Stripe** | Cloud | `STRIPE_*` env vars for billing |
| **GoDaddy DNS API** | Cloud | `GODADDY_*` env vars for domain automation |
