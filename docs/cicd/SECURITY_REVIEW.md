# Toowix Mail Platform — CI/CD Security Review & Hardening

## 1. Threat Model & Security Posture

Self-hosted runners introduce unique security considerations because code execution occurs directly on server infrastructure. The Toowix CI/CD pipeline implements defense-in-depth across seven distinct layers:

---

## 2. Seven Layers of Security Hardening

### Layer 1: Strictly No Untrusted PR Execution
- **Risk**: If a self-hosted runner executes workflows on `pull_request` from public forks, an attacker could submit a PR running malicious code on `192.168.22.73`.
- **Mitigation**: The workflow triggers **ONLY** on:
  ```yaml
  on:
    push:
      branches:
        - main
    workflow_dispatch:
  ```
  `pull_request` triggers are strictly omitted. Only merged code authored by authorized repository maintainers is deployed.

### Layer 2: Complete Separation of Builds and Deployment
- **Risk**: Running untrusted build scripts (`npm install`, `make`, `g++`, postinstall hooks) directly on the production host could lead to privilege escalation, supply-chain attacks, or memory exhaustion on the 1.9 GB server.
- **Mitigation**: All `docker build` stages and dependency installations run exclusively on **ephemeral GitHub-hosted Ubuntu runners**. The production server *only* downloads pre-compiled images from GHCR and starts containers.

### Layer 3: Least-Privilege GitHub Permissions
The workflow declares explicit minimum permissions:
```yaml
permissions:
  contents: read
  packages: write # Only for pushing images from GitHub-hosted runners
```
No administrative repo access, no secret exposure, no issue or PR write permissions.

### Layer 4: Third-Party GitHub Actions Pinning
All third-party GitHub Actions are pinned to full 40-character commit SHAs rather than mutable branch or tag names (e.g., `@v4` can be hijacked, `@b4ffde6...` cannot):

- `actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11`
- `docker/setup-buildx-action@f95db51fddba0c2d1ec667646a06c2ce06100226`
- `docker/login-action@9780b0c442fbb1117ed29e0efdff1e18412f7567`
- `docker/build-push-action@4a13e500e55cf31b7a5d59a38ab204004f421ee0`
- `dorny/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36`

### Layer 5: Root-Owned Deployment Wrapper (No Unrestricted Docker Access)
- **Risk**: Adding `github-runner` to the `docker` group gives the runner effective root privileges (ability to mount `/`, bypass host firewalls, or mutate arbitrary containers). Conversely, giving `github-runner` write access to `/root` allows script tampering.
- **Mitigation**:
  - `github-runner` is **NOT** a member of the `docker` group.
  - The runner cannot modify scripts inside `/root/toowix-mail-platform/deploy/ci/`.
  - The runner is permitted in `/etc/sudoers.d/toowix-runner` to execute **only** `/usr/local/bin/toowix-deploy`.
  - `/usr/local/bin/toowix-deploy` is owned by `root:root` (mode 750) and validates all subcommands and parameters strictly against regular expressions.

### Layer 6: Production Secrets Isolation
- **Application secrets NEVER enter GitHub Actions**: Database passwords, JWT secrets, Stalwart API keys, Stripe secrets, and encryption keys reside strictly in `/root/toowix-mail-platform/deploy/.env.production` on the production server.
- Neither `.env` nor `.env.production` is checked into git, copied into GitHub Actions environment variables, or baked into Docker images.
- Docker compose loads environment variables locally on the server at runtime.

### Layer 7: Network & Compose Isolation
- `deploy/docker-compose.prod.yml` maintains strict network segmentation:
  - `toowix-internal` (`internal: false` bridge): Connects MongoDB and Backend API.
  - `toowix-public`: Connects only the public Nginx frontends and Bulwark Webmail.
  - MongoDB port `27017` is **never exposed** to the host interface or the internet.
  - Backend API port `4000` is bound strictly to `127.0.0.1:4000:4000` (loopback only).

---

## 3. Host-Level Runner Permissions Analysis

| Access Requirement | Justification & Safeguard |
| :--- | :--- |
| **`sudo /usr/local/bin/toowix-deploy`** | Single, hardened root entrypoint. Validates all actions (`validate`, `deploy`, `rollback`, `health`, `sync-compose`, `login`, `status`). Sudoers entry: `github-runner ALL=(root) NOPASSWD: /usr/local/bin/toowix-deploy *` |
| **No Docker group membership** | Prevents arbitrary `docker run -v /:/host` container escapes from runner workspace jobs. |
| **Protected `/root` directory** | `/root/toowix-mail-platform` permissions set to `0750` root:root. Runner workspace cannot tamper with production deployment logic. |
| **No SSH inbound required** | The runner connects outbound to GitHub via HTTPS port 443. Port 22 SSH does not need to be exposed to GitHub-hosted runners or the public internet. |
