# Toowix Mail Platform — CI/CD Pipeline Analysis & Implementation Plan

> **Status:** Analysis complete. Ready for pipeline implementation.
> **Scope:** GitHub Actions → GHCR → SSH deploy to `192.168.22.73`
> **Goal:** Zero-downtime, selective rebuilds on `main` push. Only changed services rebuild; everything else untouched.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Assessment](#2-current-state-assessment)
3. [Pipeline Architecture](#3-pipeline-architecture)
4. [Change Detection Strategy](#4-change-detection-strategy)
5. [Docker Image Build Strategy](#5-docker-image-build-strategy)
6. [GHCR Tagging Strategy](#6-ghcr-tagging-strategy)
7. [Deployment Strategy](#7-deployment-strategy)
8. [Health Checks & Verification](#8-health-checks--verification)
9. [Rollback Strategy](#9-rollback-strategy)
10. [Secrets & Environment Variables](#10-secrets--environment-variables)
11. [Volume & Data Safety](#11-volume--data-safety)
12. [Compose File Modifications Required](#12-compose-file-modifications-required)
13. [GitHub Actions Workflow Spec](#13-github-actions-workflow-spec)
14. [Risk Assessment](#14-risk-assessment)
15. [Implementation Checklist](#15-implementation-checklist)

---

## 1. Executive Summary

### What We're Building
A GitHub Actions CI/CD pipeline that:
- **Triggers** on every push to `main`
- **Detects** which of the 3 buildable services changed (backend, super-admin, tenant-admin)
- **Builds** only the affected Docker images using multi-stage Dockerfiles
- **Pushes** images to GitHub Container Registry (GHCR) with commit-SHA and `latest` tags
- **Deploys** via SSH to the production server (`root@192.168.22.73`)
- **Pulls** only the changed images, restarts only the affected containers
- **Preserves** all existing volumes, networks, databases, and `.env` secrets
- **Verifies** health post-deploy and rolls back on failure

### What We're NOT Changing
- ❌ No Dockerfile modifications
- ❌ No `.env` or secrets changes
- ❌ No MongoDB data migration
- ❌ No changes to the webmail or backup-cron services (unless backend changes)
- ❌ No changes to the external Stalwart mail server

---

## 2. Current State Assessment

### 2a. Build Targets Inventory

| # | Service | npm Package Name | Source Path | Dockerfile | Build Command | Runtime |
|---|---------|-----------------|-------------|------------|---------------|---------|
| 1 | **backend** | `toowix-mail-backend` | `backend/` | `backend/Dockerfile` | `tsc` (TypeScript compile) | `node:20-alpine` |
| 2 | **super-admin** | `@toowix/super-admin` | `apps/super-admin/` | `apps/super-admin/Dockerfile` | `vite build` | `nginx:alpine` |
| 3 | **tenant-admin** | `@toowix/tenant-admin` | `apps/tenant-admin/` | `apps/tenant-admin/Dockerfile` | `vite build` | `nginx:alpine` |

### 2b. Non-Buildable Services (pre-built images)

| Service | Image | Rebuild Needed? | Notes |
|---------|-------|-----------------|-------|
| mongodb | `mongo:7.0` | Never | Official image |
| webmail | `ghcr.io/bulwarkmail/webmail:latest` | Never | Third-party image |
| backup-cron | Same as backend | When backend changes | Shares backend image, different entrypoint |

### 2c. Current Deployment Flow

```text
Developer → git push → ssh root@192.168.22.73 → git pull → docker compose build → docker compose up -d
```

**Problems with current flow:**
1. Manual SSH required for every deploy
2. Full rebuild of all services even if only one changed
3. No image registry — images exist only on the server
4. No rollback mechanism — must `git revert` and rebuild
5. No health verification — "it's up if it's up"
6. No audit trail — who deployed what, when

### 2d. Key Architectural Constraints

1. **Monorepo**: All 3 apps share one Git repository, one `package.json` workspace config
2. **Isolated Dockerfiles**: Each app has its own Dockerfile; no shared build context needed
3. **Backend reuse**: `backup-cron` uses the same Docker image as `backend` with a different entrypoint — if backend image changes, backup-cron must also be restarted
4. **External Stalwart**: The mail server is NOT in Docker Compose — it's on a separate VPS. No CI/CD needed for it.
5. **Nginx reverse proxy in SPAs**: Both `super-admin` and `tenant-admin` proxy `/api/` requests to `backend:4000` — they depend on the backend being on the same Docker network, not on any build-time coupling

---

## 3. Pipeline Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│                     GitHub Actions Workflow                      │
│                                                                 │
│  ┌──────────┐    ┌──────────────┐    ┌────────────────────┐    │
│  │  Trigger  │───▶│ Detect       │───▶│ Build & Push       │    │
│  │  (push to │    │ Changes      │    │ (parallel matrix)  │    │
│  │   main)   │    │ (paths-      │    │                    │    │
│  │           │    │  filter)     │    │ backend?  ─▶ GHCR  │    │
│  │           │    │              │    │ super-admin? ─▶GHCR│    │
│  │           │    │              │    │ tenant-admin?─▶GHCR│    │
│  └──────────┘    └──────────────┘    └────────┬───────────┘    │
│                                                │                │
│  ┌──────────────────────────────────┐          │                │
│  │ Deploy via SSH                    │◀─────────┘               │
│  │ ssh root@192.168.22.73            │                          │
│  │                                   │                          │
│  │ 1. docker login ghcr.io           │                          │
│  │ 2. docker pull <changed images>   │                          │
│  │ 3. docker compose up -d --no-build│                          │
│  │ 4. Health check                   │                          │
│  │ 5. Rollback on failure            │                          │
│  └──────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Change Detection Strategy

### Tool: `dorny/paths-filter@v3`

This GitHub Action inspects the changed files in a push and sets output booleans for each service.

### Path Filter Configuration

```yaml
filters: |
  backend:
    - 'backend/**'
  super-admin:
    - 'apps/super-admin/**'
  tenant-admin:
    - 'apps/tenant-admin/**'
  compose:
    - 'deploy/docker-compose.prod.yml'
  root-deps:
    - 'package.json'
    - 'package-lock.json'
```

### Decision Matrix

| `backend` | `super-admin` | `tenant-admin` | `compose` | `root-deps` | Action |
|:---------:|:-------------:|:--------------:|:---------:|:-----------:|--------|
| ✅ | ❌ | ❌ | ❌ | ❌ | Build + deploy backend (+ restart backup-cron) |
| ❌ | ✅ | ❌ | ❌ | ❌ | Build + deploy super-admin only |
| ❌ | ❌ | ✅ | ❌ | ❌ | Build + deploy tenant-admin only |
| ✅ | ✅ | ✅ | ❌ | ❌ | Build + deploy all three |
| ❌ | ❌ | ❌ | ✅ | ❌ | SSH pull compose + restart affected |
| * | * | * | * | ✅ | Rebuild ALL (root deps may affect any workspace) |

---

## 5. Docker Image Build Strategy

### Multi-platform build with `docker/build-push-action@v5`

Each service uses its existing multi-stage Dockerfile unchanged.

```yaml
# Example for backend
- uses: docker/build-push-action@v5
  with:
    context: backend
    file: backend/Dockerfile
    push: true
    tags: |
      ghcr.io/${{ github.repository_owner }}/toowix-backend:${{ github.sha }}
      ghcr.io/${{ github.repository_owner }}/toowix-backend:latest
    cache-from: type=gha
    cache-to: type=gha,mode=max
```

### Build Context Sizes (approximate)

| Service | Build Context | Key Dependencies | Est. Build Time |
|---------|--------------|------------------|-----------------|
| backend | `backend/` (~2MB src) | argon2 (native), mongoose, express | ~60–90s |
| super-admin | `apps/super-admin/` (~1MB src) | react, vite, lucide-react | ~30–45s |
| tenant-admin | `apps/tenant-admin/` (~1MB src) | react, vite, stripe-js | ~30–45s |

### Cache Strategy
- **GitHub Actions cache** (`type=gha`): Caches Docker layers between runs
- **npm ci** in Dockerfiles: Already deterministic via lockfiles
- **Multi-stage builds**: Only runtime artifacts make it to final image

---

## 6. GHCR Tagging Strategy

Each image receives two tags per build:

| Tag | Format | Purpose |
|-----|--------|---------|
| **SHA tag** | `ghcr.io/prathmesh-dhk/toowix-backend:abc1234` | Immutable, auditable, rollback target |
| **Latest tag** | `ghcr.io/prathmesh-dhk/toowix-backend:latest` | What compose pulls by default |

### Tag Examples
```
ghcr.io/prathmesh-dhk/toowix-backend:a1b2c3d
ghcr.io/prathmesh-dhk/toowix-backend:latest
ghcr.io/prathmesh-dhk/toowix-super-admin:a1b2c3d
ghcr.io/prathmesh-dhk/toowix-super-admin:latest
ghcr.io/prathmesh-dhk/toowix-tenant-admin:a1b2c3d
ghcr.io/prathmesh-dhk/toowix-tenant-admin:latest
```

### Image Retention
- Keep last **20** SHA-tagged images per service (configurable)
- GHCR supports automatic cleanup via GitHub's package retention policies

---

## 7. Deployment Strategy

### SSH-based Deploy (via `appleboy/ssh-action@v1`)

The CI pipeline SSHs into the production server and executes a deploy script. The server already has the repo cloned at `/root/toowix-mail-platform` (or similar path).

### Deploy Sequence

```bash
#!/bin/bash
# Executed on 192.168.22.73 via SSH from GitHub Actions

set -e

# 1. Login to GHCR
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin

# 2. Pull updated compose file
cd /root/toowix-mail-platform
git pull origin main

# 3. Pull only changed images
# (services list passed as env var from CI, e.g. "backend super-admin")
for SERVICE in $CHANGED_SERVICES; do
  docker pull ghcr.io/prathmesh-dhk/toowix-${SERVICE}:latest
done

# 4. Restart only changed services
docker compose -f deploy/docker-compose.prod.yml up -d --no-build $CHANGED_SERVICES

# 5. If backend changed, also restart backup-cron (same image)
if echo "$CHANGED_SERVICES" | grep -q "backend"; then
  docker compose -f deploy/docker-compose.prod.yml up -d --no-build backup-cron
fi

# 6. Wait for containers to stabilize
sleep 10

# 7. Health check
curl -sf http://127.0.0.1:4000/api/system/health || exit 1
```

### Key Design Decisions
1. **`--no-build`**: Forces compose to use pre-pulled images, never build on the server
2. **`git pull`**: Ensures the compose file is in sync (for env var changes, service definitions)
3. **Selective restart**: Only `$CHANGED_SERVICES` are restarted; mongodb, webmail stay untouched
4. **backup-cron coupling**: If backend image changes, backup-cron must also restart (same Dockerfile)

---

## 8. Health Checks & Verification

### Container-Level Health Checks (already in compose)

| Service | Health Check | Interval | Retries |
|---------|-------------|----------|---------|
| mongodb | `mongosh --eval 'db.adminCommand("ping")'` | 10s | 5 |
| backend | None currently → **should add** | — | — |

### Recommended Backend Health Check Addition
```yaml
# Add to backend service in docker-compose.prod.yml
healthcheck:
  test: ["CMD-SHELL", "wget -qO- http://localhost:4000/api/system/health || exit 1"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 30s
```

### CI Post-Deploy Verification Script
```bash
#!/bin/bash
# Run on server after deploy

MAX_RETRIES=6
RETRY_INTERVAL=10

for i in $(seq 1 $MAX_RETRIES); do
  HEALTH=$(curl -sf http://127.0.0.1:4000/api/system/health 2>/dev/null)
  if [ $? -eq 0 ]; then
    echo "✅ Backend healthy: $HEALTH"
    exit 0
  fi
  echo "⏳ Attempt $i/$MAX_RETRIES — waiting ${RETRY_INTERVAL}s..."
  sleep $RETRY_INTERVAL
done

echo "❌ Backend health check failed after $MAX_RETRIES attempts"
exit 1
```

---

## 9. Rollback Strategy

### Automatic Rollback (on health check failure)

```bash
#!/bin/bash
# Executed if health check fails

PREVIOUS_SHA="${PREVIOUS_SHA}"  # passed from CI

for SERVICE in $CHANGED_SERVICES; do
  docker pull "ghcr.io/prathmesh-dhk/toowix-${SERVICE}:${PREVIOUS_SHA}"
  docker tag "ghcr.io/prathmesh-dhk/toowix-${SERVICE}:${PREVIOUS_SHA}" \
             "ghcr.io/prathmesh-dhk/toowix-${SERVICE}:latest"
done

docker compose -f deploy/docker-compose.prod.yml up -d --no-build $CHANGED_SERVICES

echo "⚠️ Rolled back to ${PREVIOUS_SHA}"
```

### Manual Rollback (operator procedure)
```bash
ssh root@192.168.22.73

# Find the last known good SHA from GHCR or git log
docker pull ghcr.io/prathmesh-dhk/toowix-backend:<good-sha>
docker tag ghcr.io/prathmesh-dhk/toowix-backend:<good-sha> ghcr.io/prathmesh-dhk/toowix-backend:latest

cd /root/toowix-mail-platform
docker compose -f deploy/docker-compose.prod.yml up -d --no-build backend
```

---

## 10. Secrets & Environment Variables

### Secrets Required in GitHub Actions

| Secret | Value | Used By |
|--------|-------|---------|
| `SERVER_SSH_KEY` | SSH private key for `root@192.168.22.73` | `appleboy/ssh-action` |
| `SERVER_HOST` | `192.168.22.73` | SSH connection |
| `SERVER_USER` | `root` | SSH connection |
| `SERVER_DEPLOY_PATH` | `/root/toowix-mail-platform` | Deploy script |

> **Note:** `GITHUB_TOKEN` is automatically available in GitHub Actions and has GHCR push permissions when properly configured.

### Secrets That Stay on the Server

These are in the `.env` file on the server and are **never** stored in GitHub:

| Secret | Why it stays on server |
|--------|----------------------|
| `JWT_SECRET` | Auth token signing |
| `BACKUP_ENCRYPTION_KEY` | AES-256 backup encryption |
| `GODADDY_CREDENTIAL_ENCRYPTION_KEY` | DNS credential encryption |
| `STALWART_SERVICE_PASSWORD` | Stalwart admin access |
| `SMTP_PASS` | Transactional email relay |
| `STRIPE_SECRET_KEY` | Payment processing |
| `AWS_SECRET_ACCESS_KEY` | S3 backup storage |
| All other `.env` values | Production configuration |

### Separation of Concerns
```text
GitHub Secrets:  SSH access + GHCR auth (infrastructure-level)
Server .env:     Application secrets (stay on server, never in CI)
```

---

## 11. Volume & Data Safety

### Critical Volumes (MUST survive all deployments)

| Volume | Service | Data |
|--------|---------|------|
| `toowix-prod-mongodata` | mongodb | All tenant, mailbox, admin, audit data |
| `toowix-prod-backups` | backend + backup-cron | Encrypted backup archives |
| `toowix-prod-bulwark-settings` | webmail | User settings |
| `toowix-prod-bulwark-admin` | webmail | Admin config |

### Safety Guarantees
1. **`docker compose up -d`** recreates containers but **preserves** named volumes ✅
2. **`--no-build`** flag prevents accidental image rebuilds on server ✅
3. CI pipeline **never** runs `docker compose down -v` or `docker volume rm` ✅
4. MongoDB container is **never** restarted by CI (not in `$CHANGED_SERVICES`) ✅
5. Webmail container is **never** restarted by CI unless explicitly needed ✅

### CI Pipeline Volume Safety Rules
```yaml
# ALLOWED in CI deploy scripts:
docker compose up -d --no-build <service>   # ✅ preserves volumes
docker pull <image>                          # ✅ no volume impact
docker compose restart <service>             # ✅ preserves volumes

# FORBIDDEN in CI deploy scripts:
docker compose down -v                       # ❌ DESTROYS ALL DATA
docker compose down --remove-orphans         # ⚠️ be careful
docker volume rm <any>                       # ❌ DESTROYS DATA
docker system prune                          # ❌ UNPREDICTABLE
```

---

## 12. Compose File Modifications Required

### 12a. Switch from `build:` to `image:` for CI-built services

The current `docker-compose.prod.yml` uses `build:` directives. For GHCR-based deploys, services need an `image:` directive so `docker compose pull` and `--no-build` work correctly.

**Recommended approach: add `image:` alongside `build:`**

This allows both workflows:
- **Manual deploy**: `docker compose build && docker compose up -d` (uses `build:`)
- **CI deploy**: `docker pull <image> && docker compose up -d --no-build` (uses `image:`)

```yaml
# Current:
backend:
  build:
    context: ../backend
    dockerfile: Dockerfile

# Modified:
backend:
  image: ghcr.io/prathmesh-dhk/toowix-backend:latest
  build:
    context: ../backend
    dockerfile: Dockerfile
```

Repeat for `super-admin` and `tenant-admin`.

### 12b. Add Backend Health Check

```yaml
backend:
  # ... existing config ...
  healthcheck:
    test: ["CMD-SHELL", "wget -qO- http://localhost:4000/api/system/health || exit 1"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s
```

### 12c. Fix `toowix-internal` Network

Currently `internal: false` — this defeats the purpose of an internal network:
```yaml
# Current (problematic):
toowix-internal:
  driver: bridge
  internal: false    # ← allows external access

# Recommended:
toowix-internal:
  driver: bridge
  internal: true     # ← truly isolates internal services
```

> **⚠️ Warning:** Setting `internal: true` means containers on this network cannot reach the internet. Since backend needs to reach `smtp.dhkmail.com` (external Stalwart), backend must also be on `toowix-public` or the internal network must remain `internal: false`. Evaluate before changing.

---

## 13. GitHub Actions Workflow Spec

### Workflow File: `.github/workflows/deploy.yml`

```yaml
name: Build & Deploy

on:
  push:
    branches: [main]

concurrency:
  group: deploy-production
  cancel-in-progress: false   # Never cancel in-flight deploys

env:
  REGISTRY: ghcr.io
  OWNER: ${{ github.repository_owner }}

jobs:
  # ─── Job 1: Detect Changes ───────────────────────────────────
  changes:
    runs-on: ubuntu-latest
    outputs:
      backend: ${{ steps.filter.outputs.backend }}
      super-admin: ${{ steps.filter.outputs.super-admin }}
      tenant-admin: ${{ steps.filter.outputs.tenant-admin }}
      any-service: ${{ steps.check.outputs.any }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            backend:
              - 'backend/**'
            super-admin:
              - 'apps/super-admin/**'
            tenant-admin:
              - 'apps/tenant-admin/**'
      - id: check
        run: |
          if [[ "${{ steps.filter.outputs.backend }}" == "true" ]] || \
             [[ "${{ steps.filter.outputs.super-admin }}" == "true" ]] || \
             [[ "${{ steps.filter.outputs.tenant-admin }}" == "true" ]]; then
            echo "any=true" >> "$GITHUB_OUTPUT"
          else
            echo "any=false" >> "$GITHUB_OUTPUT"
          fi

  # ─── Job 2: Build & Push Images ──────────────────────────────
  build-backend:
    needs: changes
    if: needs.changes.outputs.backend == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: backend
          file: backend/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ env.OWNER }}/toowix-backend:${{ github.sha }}
            ghcr.io/${{ env.OWNER }}/toowix-backend:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  build-super-admin:
    needs: changes
    if: needs.changes.outputs.super-admin == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: apps/super-admin
          file: apps/super-admin/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ env.OWNER }}/toowix-super-admin:${{ github.sha }}
            ghcr.io/${{ env.OWNER }}/toowix-super-admin:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  build-tenant-admin:
    needs: changes
    if: needs.changes.outputs.tenant-admin == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: apps/tenant-admin
          file: apps/tenant-admin/Dockerfile
          push: true
          tags: |
            ghcr.io/${{ env.OWNER }}/toowix-tenant-admin:${{ github.sha }}
            ghcr.io/${{ env.OWNER }}/toowix-tenant-admin:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ─── Job 3: Deploy via SSH ──────────────────────────────────
  deploy:
    needs: [changes, build-backend, build-super-admin, build-tenant-admin]
    if: |
      always() &&
      needs.changes.outputs.any-service == 'true' &&
      !contains(needs.*.result, 'failure')
    runs-on: ubuntu-latest
    steps:
      - name: Determine changed services
        id: services
        run: |
          SERVICES=""
          if [[ "${{ needs.changes.outputs.backend }}" == "true" ]]; then
            SERVICES="$SERVICES backend"
          fi
          if [[ "${{ needs.changes.outputs.super-admin }}" == "true" ]]; then
            SERVICES="$SERVICES super-admin"
          fi
          if [[ "${{ needs.changes.outputs.tenant-admin }}" == "true" ]]; then
            SERVICES="$SERVICES tenant-admin"
          fi
          echo "list=$(echo $SERVICES | xargs)" >> "$GITHUB_OUTPUT"

      - name: Deploy to production
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SERVER_SSH_KEY }}
          script: |
            set -e

            # Login to GHCR
            echo "${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.io \
              -u "${{ github.actor }}" --password-stdin

            # Pull latest code (for compose file updates)
            cd /root/toowix-mail-platform
            git pull origin main

            # Pull changed images
            SERVICES="${{ steps.services.outputs.list }}"
            for SVC in $SERVICES; do
              docker pull ghcr.io/${{ env.OWNER }}/toowix-${SVC}:latest
            done

            # Restart changed services
            docker compose -f deploy/docker-compose.prod.yml up -d --no-build $SERVICES

            # If backend changed, also restart backup-cron
            if echo "$SERVICES" | grep -q "backend"; then
              docker compose -f deploy/docker-compose.prod.yml up -d --no-build backup-cron
            fi

            # Health check with retries
            sleep 15
            for i in 1 2 3 4 5 6; do
              if curl -sf http://127.0.0.1:4000/api/system/health > /dev/null 2>&1; then
                echo "✅ Health check passed on attempt $i"
                docker compose -f deploy/docker-compose.prod.yml ps
                exit 0
              fi
              echo "⏳ Health check attempt $i failed, waiting 10s..."
              sleep 10
            done

            echo "❌ Health check failed — initiating rollback"
            # Rollback: re-pull previous images
            PREV_SHA="${{ github.event.before }}"
            for SVC in $SERVICES; do
              docker pull "ghcr.io/${{ env.OWNER }}/toowix-${SVC}:${PREV_SHA}" || true
              docker tag "ghcr.io/${{ env.OWNER }}/toowix-${SVC}:${PREV_SHA}" \
                         "ghcr.io/${{ env.OWNER }}/toowix-${SVC}:latest" || true
            done
            docker compose -f deploy/docker-compose.prod.yml up -d --no-build $SERVICES
            exit 1
```

---

## 14. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| SSH key compromise | Low | Critical | Rotate keys quarterly; use deploy keys with limited scope |
| GHCR outage during deploy | Low | Medium | Fallback: manual `git pull && docker compose build` on server |
| Health check false negative | Medium | Medium | Multiple retries with backoff; manual verification URL |
| Volume deletion by mistake | Very Low | Critical | CI never runs `down -v`; volume names are explicit |
| Root dependency change (`package.json`) breaks all services | Low | High | Rebuild all services when root deps change |
| Concurrent deploys | Low | High | `concurrency` group in workflow prevents parallel deploys |
| Network disruption during image pull | Low | Medium | `docker pull` is resumable; retry logic in deploy script |
| Backend health endpoint not available | Medium | Medium | Add health check to compose (§12b) before enabling pipeline |

---

## 15. Implementation Checklist

### Phase 1: Prerequisites (do first)
- [x] ~~Confirm server path~~: `/root/toowix-mail-platform` ✅
- [ ] Generate SSH deploy key (`ssh-keygen -t ed25519 -C "github-deploy"`)
- [ ] Add public key to server's `~/.ssh/authorized_keys`
- [ ] Add private key as `SERVER_SSH_KEY` secret in GitHub repo settings
- [ ] Add `SERVER_HOST` (`192.168.22.73`) as GitHub secret
- [ ] Add `SERVER_USER` (`root`) as GitHub secret
- [ ] Verify `GITHUB_TOKEN` has `packages:write` permission (repo Settings → Actions → General)
- [ ] Verify GHCR is enabled for the repository/organization

### Phase 2: Compose File Updates
- [ ] Add `image:` directives to backend, super-admin, tenant-admin services
- [ ] Add backend `healthcheck:` directive
- [ ] Test that `docker compose up -d --no-build` still works after adding `image:`

### Phase 3: Create Workflow
- [ ] Create `.github/workflows/deploy.yml` with the spec from §13
- [ ] Push to a test branch first, verify change detection works
- [ ] Do a dry-run deploy (build + push to GHCR, skip SSH deploy)

### Phase 4: Test Deployment
- [ ] On server: `docker login ghcr.io` manually to verify GHCR access
- [ ] Push a backend-only change to `main` → verify only backend rebuilds
- [ ] Push a super-admin-only change → verify only super-admin rebuilds
- [ ] Push a multi-service change → verify parallel builds and selective deploy
- [ ] Verify health check passes and containers are stable

### Phase 5: Harden
- [ ] Enable branch protection on `main` (require PR, status checks)
- [ ] Add Slack/Discord webhook notification on deploy success/failure
- [ ] Set up GHCR image retention policy (keep last 20 per service)
- [ ] Document rollback procedure for the team
- [ ] Schedule quarterly SSH key rotation

---

> **Next Action:** Review this analysis, confirm the server deploy path, and proceed with Phase 1 prerequisites. Once prerequisites are met, I can generate the actual `.github/workflows/deploy.yml` file and the compose file modifications.
