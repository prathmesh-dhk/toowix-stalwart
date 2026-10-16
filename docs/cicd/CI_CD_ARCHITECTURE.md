# Toowix Mail Platform — CI/CD Pipeline Architecture

## 1. Executive Summary

This document defines the production CI/CD architecture for the **Toowix Mail Platform** monorepo (`prathmesh-dhk/toowix-stalwart`). 

The pipeline guarantees:
- **Zero build load on production hardware**: All Docker builds execute on GitHub-hosted runners (`ubuntu-latest`), protecting the resource-constrained production server (1.9 GB RAM, ~7.6 GB disk) from OOM panics.
- **Selective deployment**: Changes to one application build and update *only* that application.
- **RFC1918 Private IP compatibility**: Deployment jobs run via the already installed self-hosted GitHub Actions runner (`toowix-production-runner`) which polls GitHub outbound over HTTPS. No public inbound SSH or firewall openings required.
- **Data safety & volume preservation**: Production containers are updated in-place via `docker compose up -d --no-deps --no-build <service>`, preserving all volumes, network namespaces, and environment variables.
- **Automated rollback**: Application-level HTTP health checks verify container functionality before completing a release. On failure, the service automatically rolls back to its last-known-good image.

---

## 2. Infrastructure Topology

```
+-----------------------------------------------------------------------------------+
| GITHUB CLOUD                                                                      |
|                                                                                   |
|  Developer Push to main branch                                                    |
|         |                                                                         |
|         v                                                                         |
|  [Job: change-detection] (ubuntu-latest)                                          |
|    - Path filter detection (backend/**, apps/super-admin/**, apps/tenant-admin/**)    |
|         |                                                                         |
|         +-----------------------+-----------------------+                         |
|         |                       |                       |                         |
|         v                       v                       v                         |
|  [Job: build-backend]    [Job: build-super-admin] [Job: build-tenant-admin]           |
|  (ubuntu-latest)         (ubuntu-latest)          (ubuntu-latest)                 |
|  - Multi-stage build     - Vite build             - Vite build                    |
|  - Docker layer cache    - Nginx runtime          - Nginx runtime                 |
|         |                       |                       |                         |
|         +-----------------------+-----------------------+                         |
|                                 |                                                 |
|                                 v                                                 |
|             GitHub Container Registry (GHCR)                                      |
|             ghcr.io/prathmesh-dhk/toowix-backend:<tag>                            |
|             ghcr.io/prathmesh-dhk/toowix-super-admin:<tag>                        |
|             ghcr.io/prathmesh-dhk/toowix-tenant-admin:<tag>                       |
+-----------------------------------------------------------------------------------+
                                  |
                                  | Outbound HTTPS polling (Job dispatched)
                                  v
+-----------------------------------------------------------------------------------+
| PRODUCTION LINUX SERVER: 192.168.22.73 (Ubuntu 24.04 LTS, 1.9 GB RAM)            |
|                                                                                   |
|  Self-Hosted Runner: toowix-production-runner (user: github-runner)               |
|                                                                                   |
|  [Job: deploy]                                                                    |
|    1. ./deploy/ci/validate-config.sh (pre-flight checks, RAM/disk/lock checks)     |
|    2. docker login ghcr.io -u <actor> --password-stdin                            |
|    3. ./deploy/ci/deploy-service.sh <service> <tag>                               |
|         a. Captures current running image -> .deploy-state/<service>.previous     |
|         b. docker pull ghcr.io/prathmesh-dhk/toowix-<service>:<tag>               |
|         c. Checks backup-cron coupling (waits if backup in progress)              |
|         d. docker compose up -d --no-deps --no-build <service>                    |
|         e. ./deploy/ci/health-check.sh <service>                                  |
|         f. SUCCESS -> Records .deploy-state/<service>.current                     |
|            FAILURE -> Triggers ./deploy/ci/rollback-service.sh <service>          |
|                                                                                   |
|  Target Docker Containers (Preserved & Untouched):                                |
|    - toowix-prod-mongodb (Mongo 7.0 + persistent volume)                          |
|    - toowix-prod-webmail (Bulwark Webmail on port 8888)                           |
|    - Portainer, cAdvisor, Node Exporter, Promtail                                 |
+-----------------------------------------------------------------------------------+
                                  |
                                  | REST API / ACME / SMTP
                                  v
+-----------------------------------------------------------------------------------+
| DEDICATED MAIL SERVER VPS: 103.13.114.138                                         |
|    - Stalwart Mail Server (smtp.dhkmail.com)                                      |
|    - External Bulwark instance (dhkmail.com)                                      |
|    - Never modified by CI/CD pipeline                                             |
+-----------------------------------------------------------------------------------+
```

---

## 3. Workflow Progression & Concurrency

### Concurrency Lock
To prevent overlapping deployments or race conditions when multiple commits are pushed in rapid succession, the workflow enforces:
```yaml
concurrency:
  group: production-deploy
  cancel-in-progress: false
```
`cancel-in-progress: false` guarantees that deployments are executed strictly sequentially in commit order and no deployment is interrupted mid-flight.

### File Lock Guard
On the physical host, `deploy/ci/deploy-service.sh` uses a PID lock file (`/tmp/toowix-deploy.lock`) to prevent concurrent Docker Compose commands from clashing.

---

## 4. Dual-Tagging Image Strategy

Each built Docker image is pushed to GHCR with two distinct tags:
1. **Immutable Tag (`sha-<commit>`)**: e.g., `ghcr.io/prathmesh-dhk/toowix-backend:sha-a1b2c3d`. This guarantees exact build reproducibility, clear auditability, and deterministic rollback targets.
2. **Latest Tag (`:latest`)**: e.g., `ghcr.io/prathmesh-dhk/toowix-backend:latest`. Kept up-to-date for convenience and manual inspection.

---

## 5. Non-Destructive Update Strategy

| Concern | CI/CD Guarantee |
| :--- | :--- |
| **MongoDB Database** | Container is NOT restarted during app deploys. Volume `toowix-prod-mongodata` is untouched. |
| **Webmail (Bulwark)** | Container is NOT restarted. Volumes `toowix-prod-bulwark-settings` and `toowix-prod-bulwark-admin` are untouched. |
| **Backup Storage** | Volume `toowix-prod-backups` is persistent and untouched. |
| **Stalwart Mail Server** | External VPS (`103.13.114.138`). CI/CD never executes commands on Stalwart. |
| **Monitoring Stack** | Portainer, cAdvisor, Node Exporter, and Promtail run in separate compose projects and are untouched. |
| **Container Update Mode** | `docker compose up -d --no-deps --no-build <service>` updates only the targeted container without recreating dependencies. |
