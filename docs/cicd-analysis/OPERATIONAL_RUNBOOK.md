# Toowix Mail Platform — CI/CD Operational Runbook

> **Purpose:** Step-by-step procedures for operating the CI/CD pipeline, performing manual deployments, rollbacks, and incident response related to deployment infrastructure.

---

## 1. Current Manual Deployment Flow (Pre-CI/CD)

This is the established procedure used today. The CI/CD pipeline will automate steps 2–5.

### Step 1: SSH into Production Server
```bash
ssh root@192.168.22.73
```

### Step 2: Pull Latest Code
```bash
cd /root/toowix-mail-platform   # or wherever the repo is cloned
git pull origin main
```

### Step 3: Build & Restart Changed Services
```bash
# Build all three application images
docker compose -f deploy/docker-compose.prod.yml build backend super-admin tenant-admin

# Recreate only changed containers (preserves volumes/networks)
docker compose -f deploy/docker-compose.prod.yml up -d backend super-admin tenant-admin
```

### Step 4: Verify Deployment
```bash
# Check all containers are healthy
docker compose -f deploy/docker-compose.prod.yml ps

# Check backend health
curl -s http://127.0.0.1:4000/api/system/health | jq

# Check container logs for errors
docker logs toowix-prod-backend --tail 50
docker logs toowix-prod-super-admin --tail 20
docker logs toowix-prod-tenant-admin --tail 20
```

### Step 5: Verify Public Access
- Super Admin: https://superadmin.toowix.com
- Tenant Admin: https://admin.toowix.com

---

## 2. CI/CD Automated Deployment Flow (Target State)

### Trigger
Push to `main` branch on GitHub.

### Pipeline Stages
```text
1. Detect Changes     → dorny/paths-filter determines which services changed
2. Build Images       → docker buildx builds only affected images
3. Push to GHCR       → pushes tagged images to ghcr.io/prathmesh-dhk/toowix-*
4. Deploy via SSH     → SSHs into 192.168.22.73, pulls new images, restarts only changed services
5. Health Check       → Verifies containers are healthy post-deploy
6. Notify             → Reports success/failure (Slack webhook / GitHub status)
```

### SSH Deployment Commands (executed by CI)
```bash
# Pull specific updated images
docker pull ghcr.io/prathmesh-dhk/toowix-backend:main-<sha>
docker pull ghcr.io/prathmesh-dhk/toowix-super-admin:main-<sha>
docker pull ghcr.io/prathmesh-dhk/toowix-tenant-admin:main-<sha>

# Tag as latest for compose
docker tag ghcr.io/prathmesh-dhk/toowix-backend:main-<sha> ghcr.io/prathmesh-dhk/toowix-backend:latest
# ... repeat for each changed service

# Restart only changed services
cd /root/toowix-mail-platform
docker compose -f deploy/docker-compose.prod.yml up -d --no-build <changed-service>
```

---

## 3. Rollback Procedures

### 3a. Automated Rollback (CI/CD Health Check Failure)
If the health check fails after deploy, the pipeline should:
```bash
# Re-tag previous image as latest
docker tag ghcr.io/prathmesh-dhk/toowix-backend:main-<previous-sha> ghcr.io/prathmesh-dhk/toowix-backend:latest

# Restart with previous image
docker compose -f deploy/docker-compose.prod.yml up -d --no-build backend
```

### 3b. Manual Rollback
```bash
ssh root@192.168.22.73
cd /root/toowix-mail-platform

# Option A: Rollback to previous git commit
git log --oneline -5           # find the commit to revert to
git checkout <commit-sha>
docker compose -f deploy/docker-compose.prod.yml build backend super-admin tenant-admin
docker compose -f deploy/docker-compose.prod.yml up -d backend super-admin tenant-admin

# Option B: Pull previous GHCR image
docker pull ghcr.io/prathmesh-dhk/toowix-backend:<previous-tag>
docker tag ghcr.io/prathmesh-dhk/toowix-backend:<previous-tag> ghcr.io/prathmesh-dhk/toowix-backend:latest
docker compose -f deploy/docker-compose.prod.yml up -d --no-build backend
```

---

## 4. Volume Safety During Deployments

> **CRITICAL**: Docker volumes must NEVER be removed during deployments.

### Safe Commands (preserve volumes):
```bash
docker compose -f deploy/docker-compose.prod.yml up -d             # ✅ recreates containers only
docker compose -f deploy/docker-compose.prod.yml up -d --no-build  # ✅ uses pre-built images
docker compose -f deploy/docker-compose.prod.yml build <service>   # ✅ builds image only
```

### Dangerous Commands (NEVER use in CI):
```bash
docker compose down -v           # ❌ DESTROYS ALL VOLUMES (data loss!)
docker volume rm toowix-prod-*   # ❌ DESTROYS SPECIFIC VOLUME (data loss!)
docker system prune -a --volumes # ❌ NUCLEAR OPTION (total data loss!)
```

---

## 5. Secrets Management

### GitHub Actions Secrets Required
| Secret Name | Description | Where Used |
|---|---|---|
| `SERVER_SSH_KEY` | Private SSH key for `root@192.168.22.73` | SSH deploy step |
| `SERVER_HOST` | `192.168.22.73` | SSH deploy step |
| `SERVER_USER` | `root` | SSH deploy step |
| `GHCR_TOKEN` | GitHub PAT or `GITHUB_TOKEN` | Docker push to GHCR |

### Server-Side Secrets (already on server, NOT in CI)
All `.env` production secrets (`JWT_SECRET`, `STALWART_API_KEY`, `BACKUP_ENCRYPTION_KEY`, etc.) remain on the server in the `.env` file at the deploy directory. The CI pipeline must **never** manage or overwrite these.

---

## 6. Monitoring Post-Deploy Checklist

| Check | Command / URL | Expected |
|---|---|---|
| All containers running | `docker compose -f deploy/docker-compose.prod.yml ps` | All `Up (healthy)` |
| Backend API health | `curl http://127.0.0.1:4000/api/system/health` | `200 OK` with `mongodb: connected` |
| Super Admin accessible | `https://superadmin.toowix.com` | Login page loads |
| Tenant Admin accessible | `https://admin.toowix.com` | Login page loads |
| MongoDB healthy | `docker exec toowix-prod-mongodb mongosh --eval 'db.adminCommand("ping")'` | `{ ok: 1 }` |
| No error logs | `docker logs toowix-prod-backend --tail 50 --since 5m` | No `ERROR`/`FATAL` |

---

## 7. Emergency: Complete Redeploy from Scratch

If the server is wiped and you need to redeploy from zero:

```bash
# 1. Clone repo
git clone <repo-url> /root/toowix-mail-platform
cd /root/toowix-mail-platform

# 2. Copy production env file
cp .env.production.example deploy/.env
# Edit deploy/.env with actual production secrets

# 3. Build all services
docker compose -f deploy/docker-compose.prod.yml build

# 4. Start everything
docker compose -f deploy/docker-compose.prod.yml up -d

# 5. Restore MongoDB from backup (see docs/OPERATIONAL_RUNBOOK.md §2)
# 6. Verify health (see §6 above)
```
