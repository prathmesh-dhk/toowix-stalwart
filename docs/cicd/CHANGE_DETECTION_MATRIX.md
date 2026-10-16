# Toowix Mail Platform — Change Detection & Action Matrix

## 1. Source Path to Service Mapping

The GitHub Actions workflow uses `dorny/paths-filter` to evaluate which parts of the monorepo changed between the incoming commit and the previous head.

| Source Directory / Pattern | Service Target | Built Docker Image | Deployed Container |
| :--- | :--- | :--- | :--- |
| `backend/**` | `backend` | `ghcr.io/prathmesh-dhk/toowix-backend` | `toowix-prod-backend` (+ `toowix-prod-backup-cron`) |
| `apps/super-admin/**` | `super-admin` | `ghcr.io/prathmesh-dhk/toowix-super-admin` | `toowix-prod-super-admin` |
| `apps/tenant-admin/**` | `tenant-admin` | `ghcr.io/prathmesh-dhk/toowix-tenant-admin` | `toowix-prod-tenant-admin` |
| `deploy/**` | `compose` | *None* | Updates compose configuration; restarts affected services |
| `package.json` (root) | All workspaces | All three application images | `toowix-prod-backend`, `toowix-prod-super-admin`, `toowix-prod-tenant-admin` |
| `package-lock.json` (root) | All workspaces | All three application images | `toowix-prod-backend`, `toowix-prod-super-admin`, `toowix-prod-tenant-admin` |
| `docs/**`, `*.md` | *None* | *None* | *No deployment triggered (Ignored)* |

---

## 2. Decision Matrix

| `backend/**` | `apps/super-admin/**` | `apps/tenant-admin/**` | `deploy/**` | Root Deps | Pipeline Action |
| :---: | :---: | :---: | :---: | :---: | :--- |
| ✅ | ❌ | ❌ | ❌ | ❌ | Build + deploy `backend` only. Check and restart `backup-cron`. |
| ❌ | ✅ | ❌ | ❌ | ❌ | Build + deploy `super-admin` only. |
| ❌ | ❌ | ✅ | ❌ | ❌ | Build + deploy `tenant-admin` only. |
| ✅ | ✅ | ❌ | ❌ | ❌ | Build + deploy `backend` & `super-admin`. `tenant-admin` untouched. |
| ❌ | ✅ | ✅ | ❌ | ❌ | Build + deploy both frontends. `backend` untouched. |
| ✅ | ✅ | ✅ | ❌ | ❌ | Build + deploy all three applications. |
| ❌ | ❌ | ❌ | ✅ | ❌ | Pull compose on runner host; re-evaluates containers without rebuilding images. |
| * | * | * | * | ✅ | **Rebuild ALL applications**: root dependencies affect all workspaces. |
| ❌ | ❌ | ❌ | ❌ | ❌ | **No deployment**: Changes to docs, README, or test scripts bypass pipeline. |

---

## 3. Special Coupling: `backend` & `backup-cron`

`backup-cron` uses the backend Dockerfile as its base image with an overridden crond entrypoint (`deploy/docker-compose.prod.yml:133-155`).

When `backend` is updated:
1. `toowix-prod-backend` is updated and verified healthy first.
2. `deploy/ci/deploy-service.sh` checks if `backup-cron` is actively running a backup:
   ```bash
   docker top toowix-prod-backup-cron | grep -E 'backup-s3.sh|mongodump'
   ```
3. If an active backup is detected, the script waits up to 60 seconds.
4. If still running, it defers `backup-cron` recreation to protect the database dump from corruption.
5. If idle, it recreates `toowix-prod-backup-cron` with `--no-deps --no-build` so it runs the latest image.

---

## 4. Protected Services (Strictly Untouched)

Under **NO CIRCUMSTANCES** will the CI/CD pipeline recreate, stop, or mutate these containers or volumes:

- `toowix-prod-mongodb` (MongoDB 7.0 database)
- `toowix-prod-webmail` (Bulwark Webmail on port 8888)
- External Stalwart mail server on VPS `103.13.114.138`
- Portainer (`9443`)
- Monitoring stack (`cAdvisor`, `Node Exporter`, `Promtail`)
- Persistent volumes: `toowix-prod-mongodata`, `toowix-prod-bulwark-settings`, `toowix-prod-bulwark-admin`, `toowix-prod-backups`
