# Toowix Mail Platform — Production Readiness & Sign-Off Checklist

Before merging this pipeline to `main` or triggering automatic deployments, complete each verification step below:

---

## 1. GitHub Configuration Checklist

- [ ] **Repository Settings**: In `prathmesh-dhk/toowix-stalwart` > **Settings** > **Actions** > **General**, verify **Workflow permissions** is set to **Read and write permissions**.
- [ ] **Package Creation**: Ensure GitHub Container Registry (GHCR) package creation is enabled for user `prathmesh-dhk`.
- [ ] **Self-Hosted Runner**: In **Settings** > **Actions** > **Runners**, confirm:
  - Runner name: `toowix-production-runner`
  - Status: **Idle** (Active green dot)
  - Custom label: `toowix-production` is attached.
- [ ] **Environment**: Create environment `production` under **Settings** > **Environments** (optionally add reviewer approval).

---

## 2. Server Host Checklist (`192.168.22.73`)

- [ ] **Deployment Wrapper**: Confirm `/usr/local/bin/toowix-deploy` is installed, owned by `root:root`, with permissions `750`.
- [ ] **Sudoers Whitelist**: Confirm `/etc/sudoers.d/toowix-runner` exists with permissions `440` containing:
  `github-runner ALL=(root) NOPASSWD: /usr/local/bin/toowix-deploy *`
- [ ] **Least Privilege Verified**: Confirm user `github-runner` is **NOT** in the `docker` group (protects host from arbitrary container escapes).
- [ ] **Wrapper Test**: Run `sudo -u github-runner sudo /usr/local/bin/toowix-deploy validate` and verify it exits 0 without asking for a password.
- [ ] **Disk Space**: Verify at least 3 GB of free disk space on `/` (`df -h /`).
- [ ] **Environment File**: Confirm `/root/toowix-mail-platform/deploy/.env.production` is intact and permissions are `600`.
- [ ] **MongoDB Healthy**: Verify MongoDB container is healthy (`docker inspect --format='{{.State.Health.Status}}' toowix-prod-mongodb`).
- [ ] **Stalwart Reachable**: Verify external Stalwart VPS (`103.13.114.138`) responds to API pings from server (`curl -k -I https://smtp.dhkmail.com/healthz` or similar).

---

## 3. Recommended Phased First Deployment Procedure

Rather than deploying all services at once, execute a phased initial deployment to confirm the pipeline end-to-end:

1. **Commit and Push**: Push the validated CI/CD files to a feature branch or directly to `main` upon approval.
2. **Phase 1: Super Admin**:
   - In GitHub Actions > **Production CI/CD** > **Run workflow**.
   - Select Action: `deploy`, Service: `super-admin`.
   - Verify that:
     1. Build executes on GitHub-hosted runner.
     2. Image is pushed to `ghcr.io/prathmesh-dhk/toowix-super-admin:sha-...`.
     3. Runner on `192.168.22.73` pulls image via `toowix-deploy`.
     4. Existing container is backed up as `toowix-rollback-backup:super-admin`.
     5. Health check passes.
     6. Super Admin SPA remains accessible.
3. **Phase 2: Tenant Admin**:
   - Select Action: `deploy`, Service: `tenant-admin`.
   - Verify health and UI accessibility.
4. **Phase 3: Backend & Backup-Cron**:
   - Select Action: `deploy`, Service: `backend`.
   - Verify `/healthz` probe returns HTTP 200 with database status `healthy`.
   - Confirm `backup-cron` container is updated transactionally.
