# Toowix Mail Platform — Deployment, Health Verification & Rollback Guide

## 1. Automated Deployment Architecture

Every production deployment initiated by GitHub Actions executes via the root-owned wrapper:
`sudo /usr/local/bin/toowix-deploy deploy <service> <tag>`

### Step-by-Step Lifecycle
```
1. Acquire Lock (/tmp/toowix-deploy.lock)
       │
2. Discover Compose Project Identity (-p deploy or active project from MongoDB)
       │
3. Capture & Preserve Running Image:
     - Record Image ID (sha256:...) -> .deploy-state/<service>/previous_id
     - Record Image Ref -> .deploy-state/<service>/previous_ref
     - Locally tag: docker tag <IMAGE_ID> toowix-rollback-backup:<service>
       (Guarantees first-deployment local images are 100% recoverable)
       │
4. Pull Target Image from GHCR & Verify Local Presence (docker image inspect)
       │
5. Check backup-cron activity (if backend: wait if backup active)
       │
6. Deploy ONLY Target Service:
     docker compose -p deploy -f deploy/docker-compose.prod.yml up -d --no-deps --no-build <service>
     (Note: backup-cron is NOT touched yet!)
       │
7. Run Health Probe (/usr/local/bin/toowix-deploy health <service>)
       ├── PASS ──> Is service backend?
       │               ├── YES ──> Safely update backup-cron to matching image
       │               └── NO  ──> Record .current state ──> Release Lock ──> Exit 0
       │
       └── FAIL ──> Trigger /usr/local/bin/toowix-deploy rollback <service>
                           │
                           ├── Rollback PASS ──> Restored to backup tag ──> Release Lock ──> Exit 1
                           └── Rollback FAIL ──> Critical Alert ──> Dump Diagnostics ──> Exit 1
```

---

## 2. Health Verification Specification

The health check probe (`deploy/ci/health-check.sh`, invoked via `toowix-deploy health`) probes the service locally using HTTP loopback:

| Service | Target URL | HTTP Code | Content Validation | Window |
| :--- | :--- | :---: | :--- | :--- |
| `backend` | `http://127.0.0.1:4000/healthz` | `200` | JSON contains `"status"` (verifies live DB ping) | 15 attempts x 2s = 30s |
| `super-admin` | `http://127.0.0.1:5173/` | `200` | HTML contains `<div id="root">` | 15 attempts x 2s = 30s |
| `tenant-admin` | `http://127.0.0.1:5174/` | `200` | HTML contains `<div id="root">` | 15 attempts x 2s = 30s |

---

## 3. First-Deployment Rollback Recovery

### The First-Deployment Challenge
On the very first deployment, the running container image was built locally on the server (e.g. `deploy-backend:latest` or untagged `sha256:...`). It does NOT exist in GHCR. A naive `docker pull` during rollback would fail.

### The Solution Implemented
`deploy/ci/deploy-service.sh` automatically tags the currently running container image as:
```bash
toowix-rollback-backup:<service>
```
And saves both the raw Docker image ID and tag to `.deploy-state/<service>/previous_id`.

During rollback:
1. `rollback-service.sh` inspects the local image store for `toowix-rollback-backup:<service>`.
2. If found, it immediately restores the container using that local image tag **without attempting any network pull**.
3. Only if the backup tag is missing does it attempt to pull a remote reference.

---

## 4. Transactional Backend & Backup-Cron Safety

`backend` and `backup-cron` share the same Dockerfile. To prevent breaking active backups or leaving mismatched versions:

1. `backup-cron` is checked before deployment. If `backup-s3.sh` or `mongodump` is active, the deployment script waits up to 60 seconds.
2. `backend` is deployed first. `backup-cron` is **left untouched**.
3. If `backend` fails health checks, `rollback-service.sh backend` runs. `backup-cron` was never modified.
4. Only when `backend` passes all health checks is `backup-cron` updated with `--no-deps --no-build`.
5. If `backup-cron` recreation fails or is deferred, `backend` remains healthy and operational; the incident is reported as a partial deployment with exit code 2.

---

## 5. Manual Rollback Procedures (CLI Emergency)

If you need to roll back manually via SSH on `192.168.22.73`:

```bash
# Automated rollback to previous known-good image
sudo /usr/local/bin/toowix-deploy rollback backend
# or
sudo /usr/local/bin/toowix-deploy rollback super-admin
# or
sudo /usr/local/bin/toowix-deploy rollback tenant-admin
```

To roll back to a specific commit SHA or image reference:
```bash
sudo /usr/local/bin/toowix-deploy rollback backend ghcr.io/prathmesh-dhk/toowix-backend:sha-<commit-sha>

# Verify health after rollback:
sudo /usr/local/bin/toowix-deploy health backend
```
