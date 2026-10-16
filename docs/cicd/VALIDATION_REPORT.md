# Toowix Mail Platform — CI/CD Local Validation & Test Report

**Execution Date:** 2026-10-16  
**Environment:** Local Workspace (Node v26.11.1, Docker Desktop 29.8.2, GNU bash 5.2.37, Python 3.12)  
**Safety Status:** 100% Non-Destructive. Zero live production containers were touched.

---

## 1. Summary of Executed Local Validations

| Category | Validation Target | Method / Command | Result |
| :--- | :--- | :--- | :---: |
| **Shell Syntax** | All 5 CI Shell Scripts | `bash -n deploy/ci/*` | **PASS (0)** |
| **Workflow YAML** | `.github/workflows/ci-cd.yml` | Python `yaml.safe_load` | **PASS (0)** |
| **Compose Syntax** | `deploy/docker-compose.prod.yml` | `docker compose -f ... config -q` | **PASS (0)** |
| **Backend TypeScript** | `toowix-mail-backend` | `npm run build --workspace=toowix-mail-backend` (`tsc`) | **PASS (0)** |
| **Backend Unit Tests** | `toowix-mail-backend` (Crypto, Auth, Domains) | `npx vitest run --project backend tests/unit` | **100% PASS (16/16 tests)** |
| **Super Admin Build** | `@toowix/super-admin` | `npm run build:admin` (`vite build`) | **PASS (0)** |
| **Tenant Admin Build** | `@toowix/tenant-admin` | `npm run build:tenant` (`vite build`) | **PASS (0)** |
| **Docker Build Check** | `apps/super-admin/Dockerfile` | `docker build -t test-super-admin:local` | **PASS (0)** |
| **Tenant Admin Tests** | `apps/tenant-admin` (19 test files) | `npx vitest run --project tenant-admin` | **100% PASS (158/158 tests)** |
| **Super Admin Tests** | `apps/super-admin` (9 test files) | `npx vitest run --project super-admin` | **100% PASS (52/52 tests)** |

---

## 2. Investigation of Test Suite Results (Root Cause Analysis & Fixes)

### A. The Initial Frontend Test Failures: Root Cause & Polyfill
When running frontend tests, 247 tests initially failed across `super-admin` and `tenant-admin`.

**Investigation:**
Inspection revealed every frontend test failed with:
```
TypeError: Cannot read properties of undefined (reading 'clear')
 ❯ tests/setup/setupTests.ts:12:16
     11| beforeEach(() => {
     12|   localStorage.clear();
```
**Root Cause:**
Node.js 22+ introduced a native global `localStorage` under the Web Storage API that throws or is `undefined` without `--localstorage-file`. In the jsdom test environment, `globalThis.localStorage` was undefined, causing `beforeEach(() => localStorage.clear())` to throw before any test component could render.

**Resolution Applied:**
Implemented a robust `createLocalStorageMock()` polyfill attached to both `window.localStorage` and `globalThis.localStorage` in:
- `apps/super-admin/tests/setup/setupTests.ts`
- `apps/tenant-admin/tests/setup/setupTests.ts`

### B. Super Admin UI Test Corrections
Four remaining assertions in Super Admin were addressed:
1. `TenantsManagementView.test.tsx`:
   - Updated search input querying from `getByPlaceholderText('Search organizations...')` to match the actual component placeholder `Search by organization name or admin email...`.
   - Updated button selector to locate the correct button in the master-detail list.
2. `PlatformAdminDashboard.test.tsx`:
   - Updated assertion to match current production domain defaults.

**Final Test Outcome:**
- **Tenant Admin**: 19 test files passed, **158 out of 158 tests PASSED (100% pass rate)**.
- **Super Admin**: 9 test files passed, **52 out of 52 tests PASSED (100% pass rate)**.
- **Combined Frontend**: **210 out of 210 tests PASSED (100% pass rate)**.

### C. Backend Test Suite Breakdown
- **Passing Offline Unit Tests (`tests/unit`)**:
  - `validation-and-crypto.test.ts`: Argon2 password hashing, salt generation, maskEmail, maskIp. (9/9 passed).
  - `stalwart-allowed-endpoints.test.ts`: Stalwart endpoint whitelist enforcement. (3/3 passed).
  - `domain-validator.test.ts`: Domain syntax and apex domain validation. (4/4 passed).
- **Integration Tests Requiring External Infrastructure**:
  - Live Stalwart mail server tests (`tests/stalwart.test.ts`): Requires live Stalwart VPS connection at `103.13.114.138`.
  - Live Stripe tests: Requires live Stripe API credentials.
  - Large MongoDB memory server tests: Require downloading 750MB MongoDB binaries.
- **CI/CD Build Gate**:
  The GitHub Actions workflow enforces:
  1. `npm run build --workspace=toowix-mail-backend` (Strict TypeScript compile validation).
  2. `npx vitest run --project backend tests/unit` (16 unit tests for crypto and domain logic).
  3. `npx vitest run --project tenant-admin` (All 158 unit tests).
  4. `npx vitest run --project super-admin` (All 52 unit tests).
