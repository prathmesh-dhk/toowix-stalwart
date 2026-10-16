# Toowix Mail Platform — Production CI/CD Setup & Security Configuration Guide

This guide details the complete, one-time setup and security lockdown required on the GitHub repository and Ubuntu 24.04 LTS production server (`192.168.22.73`).

---

## 1. GitHub Repository Configuration

Perform these steps in the GitHub repository (`prathmesh-dhk/toowix-stalwart`):

### A. Workflow & Package Permissions
1. Navigate to **Settings** > **Actions** > **General**.
2. Under **Workflow permissions**, select:
   - **Read and write permissions** (required for `GITHUB_TOKEN` to publish Docker images to GitHub Container Registry `ghcr.io`).
3. Check the box: **Allow GitHub Actions to create and approve pull requests** (if applicable).
4. Click **Save**.

### B. Environment Configuration (`production`)
1. Navigate to **Settings** > **Environments**.
2. Click **New environment** and enter name: `production`.
3. *(Recommended for production control)* Configure deployment protection rules:
   - **Required reviewers**: Add yourself to require manual review and approval before any self-hosted deployment step runs.
   - **Deployment branches**: Restrict to `main`.
4. Click **Save protection rules**.

### C. Self-Hosted Runner Verification
1. Navigate to **Settings** > **Actions** > **Runners**.
2. Verify that `toowix-production-runner` is registered and displays **Idle** (green dot).
3. Verify attached labels:
   - `self-hosted`
   - `Linux`
   - `X64`
   - `toowix-production` (ensure this custom label is present).

---

## 2. Production Server Security Hardening (`192.168.22.73`)

SSH into the production server as `root`:

```bash
ssh root@192.168.22.73
```

### A. Principle of Least Privilege: No Unrestricted Docker Socket
In accordance with security best practices, **do NOT add `github-runner` to the `docker` group**. Granting direct Docker socket access to the runner allows any workspace job to mount host root filesystems, bypass ACLs, or disrupt unrelated containers (such as MongoDB or Stalwart).

Instead, all Docker operations are funneled through a restricted, root-owned deployment wrapper (`/usr/local/bin/toowix-deploy`).

### B. Install Root Deployment Wrapper
Install the hardened wrapper and ensure strict ownership and execution permissions:

```bash
# Ensure deploy scripts are present and executable by root
chmod +x /root/toowix-mail-platform/deploy/ci/*.sh
chmod +x /root/toowix-mail-platform/deploy/ci/toowix-deploy

# Install wrapper into system binary path
cp /root/toowix-mail-platform/deploy/ci/toowix-deploy /usr/local/bin/toowix-deploy
chown root:root /usr/local/bin/toowix-deploy
chmod 750 /usr/local/bin/toowix-deploy

# Protect the production repository directory
chmod 750 /root/toowix-mail-platform
chmod 750 /root/toowix-mail-platform/deploy
chmod 750 /root/toowix-mail-platform/deploy/ci
```

### C. Configure Sudoers Whitelist
Grant the runner user `github-runner` permission to execute **only** the wrapper with sudo, without a password:

```bash
cat << 'EOF' > /etc/sudoers.d/toowix-runner
# ==============================================================================
# Restricted Sudoers Whitelist for Toowix Production Deployment
# Allows runner to invoke only the root-owned, validated deployment wrapper.
# ==============================================================================
github-runner ALL=(root) NOPASSWD: /usr/local/bin/toowix-deploy *
EOF

chmod 440 /etc/sudoers.d/toowix-runner
visudo -c  # Validates sudoers syntax
```

### D. Production Environment File Security
Verify that the production environment file exists and is strictly protected:

```bash
ls -la /root/toowix-mail-platform/deploy/.env.production
chmod 600 /root/toowix-mail-platform/deploy/.env.production
chown root:root /root/toowix-mail-platform/deploy/.env.production
```

Ensure critical variables are defined:
- `JWT_SECRET`
- `BACKUP_ENCRYPTION_KEY`
- `STALWART_SERVICE_PASSWORD`
- `STALWART_URL=https://smtp.dhkmail.com`
- `MONGODB_URI=mongodb://mongodb:27017/toowix_mail`

---

## 3. GHCR Authentication Configuration

The deployment wrapper handles GHCR authentication. For manual server maintenance or one-time setup:

```bash
# Create a GitHub Personal Access Token (PAT) with 'read:packages' permission
# Authenticate the Docker daemon on the server via toowix-deploy:
echo "YOUR_GITHUB_PAT" | sudo /usr/local/bin/toowix-deploy login prathmesh-dhk
```

During CI/CD pipeline runs, the workflow automatically runs:
```bash
echo "${{ secrets.GITHUB_TOKEN }}" | sudo /usr/local/bin/toowix-deploy login "${{ github.actor }}"
```

---

## 4. Verification and Dry-Testing on Production Host

Test the restricted wrapper as the `github-runner` user to verify that permissions and paths function correctly without any prompt for passwords:

```bash
# Switch to github-runner user context and run pre-flight validation
sudo -u github-runner sudo /usr/local/bin/toowix-deploy validate

# Check production container status
sudo -u github-runner sudo /usr/local/bin/toowix-deploy status

# Test health check probes against running services
sudo -u github-runner sudo /usr/local/bin/toowix-deploy health backend
sudo -u github-runner sudo /usr/local/bin/toowix-deploy health super-admin
sudo -u github-runner sudo /usr/local/bin/toowix-deploy health tenant-admin
```

---

## 5. First Production Deployment Walkthrough

When ready to perform the first automated deployment:

1. **Commit and Merge**: Merge approved changes into the `main` branch.
2. **Automated Pipeline Trigger**:
   - GitHub Actions detects affected directories.
   - GitHub-hosted runner executes unit tests and builds the affected Docker image(s) targeting `x86_64`.
   - Image is tagged with immutable commit SHA (`ghcr.io/prathmesh-dhk/toowix-<svc>:sha-<commit>`) and pushed to GHCR.
3. **Self-Hosted Runner Deployment**:
   - Runner invokes `toowix-deploy validate`.
   - Existing running container image is automatically captured and preserved as `toowix-rollback-backup:<service>`.
   - New image is pulled from GHCR.
   - Target container is recreated in-place with `docker compose -p deploy ... up -d --no-deps --no-build <service>`.
   - Automated HTTP health check probes the endpoint (`/healthz` or HTTP 200).
   - If backend passed health checks, `backup-cron` is transactionally updated.
4. **Audit**: Active containers and logs are reported in the deployment summary.

---

## 6. Manual Emergency Procedures

### Emergency Rollback via GitHub Actions UI
1. Navigate to **Actions** > **Production CI/CD** > **Run workflow**.
2. Action: Select **`rollback`**.
3. Service: Select the affected service (`backend`, `super-admin`, `tenant-admin`, or `all`).
4. Click **Run workflow**.

### Emergency Manual Rollback via Server CLI
If GitHub Actions is unreachable, SSH into `192.168.22.73` and execute:

```bash
# Restore previous verified image:
sudo /usr/local/bin/toowix-deploy rollback backend

# Or restore an explicit previous immutable tag:
sudo /usr/local/bin/toowix-deploy rollback backend ghcr.io/prathmesh-dhk/toowix-backend:sha-abc1234

# Check status and health:
sudo /usr/local/bin/toowix-deploy health backend
sudo /usr/local/bin/toowix-deploy status
```
