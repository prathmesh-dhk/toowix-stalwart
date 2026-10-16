# Toowix CI/CD: installation and first real release

**READ FIRST:** This package is a design reviewed against the supplied files, NOT a tested production release. The final workflow and actual server state must be verified before enabling its `main` push trigger. No user credentials are included.

## Changes relative to developer version
- One root-owned runner entry point at `/usr/local/sbin/toowix-deploy`. Runner has NO Docker group membership, and runner workspace files are NEVER executed as root.
- No `sync-compose` action from workflow: configuration changes do not automatically alter production infrastructure.
- No `dry-run`, no `latest` image publishing, no deploying the entire Compose project.
- Preexisting Compose project remains `deploy`; target service explicitly selected.
- Existing local image defaults are preserved before first GHCR rollout (backup-cron retains its separate image override).
- Before any targeted replacement, preserve previous image ID. Failed container recreation or health check triggers immediate restoration.
- On backend success, backup worker is updated only when idle. A failed/deferred update writes `backup-cron.pending`, requiring operator intervention.

## Files to put in developer repository
- `.github/workflows/ci-cd.yml`
- `deploy/docker-compose.prod.yml` (diff carefully against the actual live file; DO NOT blindly overwrite)
- `deploy/ci/{install-server.sh,common.sh,toowix-deploy,validate-config.sh,deploy-service.sh,rollback-service.sh,health-check.sh}`

## One-time production installation (after merge review)
1. Verify actual Compose project/container IDs, the actual production Compose/env paths, and whether `toowix-prod-stalwart` is local or remote. The previous reports conflict.
2. Back up the actual production Compose/env files and image IDs, plus verify a database backup can be restored. Do not paste secrets into chats/logs.
3. Review the checked-out deployment scripts and live Compose file. Never run the installer from the GitHub runner workspace; run only the root-owned copy under `/root/toowix-mail-platform`.
4. Run `bash /root/toowix-mail-platform/deploy/ci/install-server.sh` as root. It verifies ownership, rejects Docker-group access for `github-runner`, installs the wrapper and restricted sudoers rule, protects deployment state, and validates the live stack as the runner user.
5. If `deploy/.env.production` is absent, the installer securely copies the existing `deploy/.env` to that canonical path and changes both files to mode 600. Review `.env.production` without printing secrets before continuing.
6. Verify as runner: `sudo -u github-runner sudo -n /usr/local/sbin/toowix-deploy validate`.
7. Keep the production `environment` approval enabled until the first successful rollout. Verify the custom runner label is `toowix-production`.
8. GHCR login is performed during each deployment job with GitHub's short-lived token through stdin; do not create long-lived production PATs unless strictly required. The workflow logs out after deployment.
9. Commit via feature branch, review, merge with approvals. Merge to `main` **triggers real deployment of affected services**. For the first release, trigger a supervised manual workflow for `super-admin` after code review and approval, with operator monitoring ready.

## First-release gate (must verify, do not assume)
- Confirm repo's Dockerfiles really build with the documented contexts. Shared root package dependencies must be reflected in each Dockerfile's context.
- Confirm `/healthz` exists and `curl http://127.0.0.1:4000/healthz` includes `"status"`; frontend pages include `<div id="root">`.
- Confirm `docker compose config -q` with production .env and that protected container IDs don't change.
- Confirm the actual paths and volumes match the existing stack. In particular the Compose source marks Stalwart external but earlier server output showed it running locally.
- Confirm no resource exhaustion before pulling new images; app updates restart one service and are **not zero-downtime** on a single replica.
- Live rollback requires controlled test of an intentionally bad release in staging; syntax checks alone cannot prove it.

## Operational limits
- Compose-only changes are deliberately *not automatically applied*; a privileged administrator must approve and apply them using an independently reviewed infrastructure change procedure.
- The workflow only tests backend unit tests and TypeScript; full backend integration tests require accessible services and a separate controlled CI test environment.
- GitHub concurrency prevents simultaneous deploy jobs, but queued workflow executions may still need checks to avoid promoting outdated commits. Branch/environment protection and serialized deployment are mandatory.
- There is no guarantee of a successful production release without running the workflow on the connected repo and validating the actual server.
