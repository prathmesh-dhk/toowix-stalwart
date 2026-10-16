# Toowix Mail Platform — CI/CD Implementation File Manifest

This document records all files added and modified to implement the production CI/CD pipeline and address all deployment safety corrections.

---

## 1. Summary of Changes

| File | Status | Size | Purpose |
| :--- | :---: | :---: | :--- |
| [`.github/workflows/ci-cd.yml`](file:///.github/workflows/ci-cd.yml) | **Added** | ~14 KB | Production GitHub Actions workflow with strict selective change detection, GitHub-hosted x86_64 image builds, immutable tagging, test gates, and self-hosted root-wrapper deployment. |
| [`deploy/ci/toowix-deploy`](file:///deploy/ci/toowix-deploy) | **Added** | ~4.6 KB | Hardened root-owned deployment wrapper (mode 750) providing strict command dispatch (`validate`, `deploy`, `rollback`, `health`, `sync-compose`, `login`, `status`). |
| [`deploy/ci/validate-config.sh`](file:///deploy/ci/validate-config.sh) | **Added** | ~5.3 KB | Pre-flight deployment check with project identity discovery, syntax validation, disk/memory safety checks, and lock status. |
| [`deploy/ci/health-check.sh`](file:///deploy/ci/health-check.sh) | **Added** | ~3.5 KB | Application-level HTTP health probe with retries for `/healthz` (backend) and SPAs (port 5173/5174). |
| [`deploy/ci/rollback-service.sh`](file:///deploy/ci/rollback-service.sh) | **Added** | ~5.4 KB | Restores previous verified image (prioritizing local backup tag for first-deployment safety, previous ID, or explicit SHA). |
| [`deploy/ci/deploy-service.sh`](file:///deploy/ci/deploy-service.sh) | **Added** | ~8.2 KB | Service deployment orchestrator with PID lock, immutable ID backup, `--no-deps --no-build` in-place container recreation, and transactional backup-cron. |
| [`deploy/docker-compose.prod.yml`](file:///deploy/docker-compose.prod.yml) | **Modified** | ~6 KB | Added parameterized `image:` tags with default fallbacks and native `healthcheck` directives; preserved all ports, envs, volumes. |
| [`.env.production.example`](file:///.env.production.example) | **Modified** | ~3.3 KB | Corrected quote syntax on `SMTP_FROM="Toowix Mail Platform <noreply@toowix.com>"` to ensure compatibility with `docker compose`. |
| [`apps/super-admin/tests/setup/setupTests.ts`](file:///apps/super-admin/tests/setup/setupTests.ts) | **Modified** | ~1.5 KB | Added robust `localStorageMock` polyfill resolving Node 22 jsdom test incompatibility. |
| [`apps/tenant-admin/tests/setup/setupTests.ts`](file:///apps/tenant-admin/tests/setup/setupTests.ts) | **Modified** | ~1.5 KB | Added robust `localStorageMock` polyfill resolving Node 22 jsdom test incompatibility. |
| [`apps/super-admin/tests/components/TenantsManagementView.test.tsx`](file:///apps/super-admin/tests/components/TenantsManagementView.test.tsx) | **Modified** | ~10 KB | Fixed search input placeholder query to match current UI, achieving 100% test pass rate in Super Admin. |
| [`apps/super-admin/tests/components/PlatformAdminDashboard.test.tsx`](file:///apps/super-admin/tests/components/PlatformAdminDashboard.test.tsx) | **Modified** | ~13 KB | Updated domain assertion to match current production domain defaults. |
| [`docs/cicd/CI_CD_ARCHITECTURE.md`](file:///docs/cicd/CI_CD_ARCHITECTURE.md) | **Added** | ~8 KB | Full architecture specification, topology diagram, and design rationale. |
| [`docs/cicd/SETUP_GUIDE.md`](file:///docs/cicd/SETUP_GUIDE.md) | **Added** | ~5 KB | Setup guide with root-owned wrapper installation, `/etc/sudoers.d/toowix-runner` whitelist, and exact maintenance commands. |
| [`docs/cicd/CHANGE_DETECTION_MATRIX.md`](file:///docs/cicd/CHANGE_DETECTION_MATRIX.md) | **Added** | ~3.5 KB | Decision matrix mapping source files, compose changes, and shared dependencies. |
| [`docs/cicd/DEPLOYMENT_AND_ROLLBACK.md`](file:///docs/cicd/DEPLOYMENT_AND_ROLLBACK.md) | **Added** | ~5 KB | Deployment lifecycle, first-deployment rollback, transactional backup-cron, and CLI emergency runbook. |
| [`docs/cicd/SECURITY_REVIEW.md`](file:///docs/cicd/SECURITY_REVIEW.md) | **Added** | ~5 KB | Security posture, least-privilege review, root wrapper isolation, PR attack defense, and secrets protection. |
| [`docs/cicd/VALIDATION_REPORT.md`](file:///docs/cicd/VALIDATION_REPORT.md) | **Added** | ~5 KB | Comprehensive report covering syntax checks, compile tests, Docker builds, and 100% unit test pass rates. |
| [`docs/cicd/FILES_CHANGED.md`](file:///docs/cicd/FILES_CHANGED.md) | **Added** | This file | Full inventory and architectural rationale of all changes. |
| [`docs/cicd/PRODUCTION_READINESS_CHECKLIST.md`](file:///docs/cicd/PRODUCTION_READINESS_CHECKLIST.md) | **Added** | ~3 KB | Pre-deployment sign-off checklist and recommended phased rollout procedure. |
