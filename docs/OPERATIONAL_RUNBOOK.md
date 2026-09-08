# Toowix Mail Platform — Operational Runbook

This document defines standard operating procedures (SOPs) for systems administrators, site reliability engineers (SREs), and platform administrators operating the Toowix Mail Platform in production.

---

## 1. System Architecture & Boundaries

### A. Network Isolation Topology
The platform operates on two strictly separated Docker bridge networks:
1. **`toowix-public`**:
   * Public Web Portals: `admin.toowix.com` (Super Admin), `manage.toowix.com` (Tenant Admin).
   * Bulwark JMAP Webmail: `mail.toowix.com` (Port 8888 -> container 3000).
   * Public Mail Protocols on Stalwart:
     * Port 25: Inbound SMTP (MX)
     * Port 465 / 587: SMTPS / SMTP Submission
     * Port 993 / 143: IMAPS / IMAP (STARTTLS)
     * Port 4190: ManageSieve
2. **`toowix-internal`**:
   * MongoDB 7.0 (Port 27017): Strictly internal.
   * Stalwart Management & JMAP API (Port 8080): **NEVER exposed publicly**. Accessible only by Toowix Backend and Bulwark Webmail containers.

### B. Entity Architecture
* **Admin Users (`admin_users`)**: Administrative identities for `SUPER_ADMIN` or `TENANT_ADMIN`.
* **Mailboxes (`mailboxes`)**: Live email resources provisioned on Stalwart (`address = local_part@domain.com`).
* **Tenant Invariant**: **Strict 1 Tenant = Exactly 1 Domain**. Concurrency-safe atomic quota enforcement via `$expr` and `$inc`.

---

## 2. Disaster Recovery & Backup Restoration

### A. Backup Format & Storage
* All platform snapshots are encrypted with **AES-256-GCM** using PBKDF2/scrypt key derivation.
* Encrypted archives are stored in `backend/backups/` and mirrored to Amazon S3 / Cloudflare R2 (`s3://${S3_BUCKET}/backups/`).
* Each archive has a cryptographic **SHA-256 checksum** stored in `BackupRecordModel` and a corresponding `.sha256` sidecar file.

### B. Emergency Step-by-Step Restoration Procedure

#### Step 1: Locate and Verify Archive Integrity
From the Super Admin portal (`System Health & Operations` tab) or via CLI:
```bash
# Check SHA-256 checksum
sha256sum -c toowix-backup-2026-09-07.enc.sha256
```
Or trigger verification via API:
```bash
curl -X POST https://admin.toowix.com/api/system/backups/<backup-id>/verify \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>"
```

#### Step 2: Decrypt Archive
If performing a manual offline restore:
```bash
# Decrypt archive with AES-256
openssl enc -d -aes-256-cbc -salt -pbkdf2 -iter 100000 \
  -in toowix-backup-20260907.tar.gz.enc \
  -out toowix-backup-20260907.tar.gz \
  -k "${BACKUP_ENCRYPTION_KEY}"

# Unpack dump
tar -xzf toowix-backup-20260907.tar.gz
```

#### Step 3: Restore MongoDB Collections
```bash
mongorestore --uri="${MONGODB_URI}" --drop ./dump/toowix_mail/
```

#### Step 4: Reconcile Drift with Stalwart
After database restore, execute the reconciliation sync to repair any quota or mailbox discrepancies:
```bash
curl -X POST https://admin.toowix.com/api/system/reconciliation/sync-quota \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>"
```

---

## 3. Live Stalwart Upgrade & Rollback Procedure

### A. Upgrading Stalwart Mail Server
1. **Review Release Notes**: Check Stalwart release changelog for configuration schema changes.
2. **Trigger Full Platform Backup**:
   ```bash
   curl -X POST https://admin.toowix.com/api/system/backup \
     -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>"
   ```
3. **Pull New Docker Image**:
   ```bash
   docker pull stalwartlabs/stalwart:latest
   ```
4. **Graceful Restart**:
   ```bash
   cd /opt/toowix/deploy
   docker compose -f docker-compose.prod.yml up -d stalwart
   ```
5. **Verify System Health**:
   * Inspect `https://admin.toowix.com/api/system/health`.
   * Ensure Stalwart status reports `connected` with latency < 50ms.
   * Run drift check at `https://admin.toowix.com/api/system/reconciliation`.

### B. Rollback Procedure
If Stalwart encounters errors after upgrade:
```bash
# Revert to pinned version
sed -i 's/stalwart:latest/stalwart:v0.10.0/' deploy/docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d stalwart
```

---

## 4. Emergency Break-Glass Procedures

### A. Reset Super Admin Credentials via CLI
If all Super Admin accounts are locked or 2FA credentials lost:
```bash
# Connect to backend container
docker exec -it toowix-prod-backend sh

# Execute break-glass seed script
node -e "
const mongoose = require('mongoose');
const argon2 = require('argon2');
(async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const hash = await argon2.hash('NewEmergencySuperAdminPassword2026!');
  await mongoose.connection.collection('admin_users').updateOne(
    { role: 'SUPER_ADMIN' },
    { \$set: { passwordHash: hash, twoFactorEnabled: false, status: 'active' } }
  );
  console.log('Break-glass: Super admin password reset and 2FA temporarily disabled.');
  process.exit(0);
})();
"
```
*Immediately log in, re-enroll TOTP 2FA, and rotate the emergency password.*

### B. Clear Brute-Force Rate Limiter Memory
If legitimate administrators are locked out due to rate-limiting:
```bash
docker exec -it toowix-prod-backend sh -c "node -e 'require(\"./dist/auth/middleware\").resetRateLimitStore()'"
```
Or restart the backend container:
```bash
docker restart toowix-prod-backend
```

---

## 5. Tenant Lifecycle & Cascade Deletion

### A. Full Lockdown Suspension
* **Trigger**: Super Admin clicks "Suspend" in `admin.toowix.com` or calls `POST /api/platform/tenants/:id/suspend`.
* **Effect**:
  * MongoDB tenant status set to `suspended`.
  * All Tenant Admin API logins rejected immediately with `403 TENANT_SUSPENDED`.
  * Stalwart domain and child mailbox accounts disabled immediately, rejecting SMTP/IMAP traffic.

### B. Cascade Tenant Deletion
* **Trigger**: Super Admin clicks "Delete Tenant" or calls `DELETE /api/platform/tenants/:id`.
* **Execution Sequence**:
  1. Purges all child mailbox accounts from Stalwart via JMAP management API.
  2. Purges the domain and linked DKIM signatures from Stalwart.
  3. Purges all records from MongoDB across `MailboxModel`, `DomainModel`, `AdminUserModel`, `ActivationTokenModel`, and `TenantModel`.
  4. Records immutable `TENANT_DELETED` audit event in `AuditLogModel`.

---

## 6. Outage Alerting & Triage Runbook

### Alert Trigger Matrix
| Service | Threshold | Severity | Immediate Action |
|---|---|---|---|
| **MongoDB** | 3 consecutive failures | `CRITICAL` | Check container health: `docker logs toowix-prod-mongodb --tail 50`. Verify disk space (`df -h`). |
| **Stalwart** | 3 consecutive failures | `CRITICAL` | Check Stalwart logs: `docker logs toowix-prod-stalwart --tail 50`. Check port 8080 reachability from backend. |
| **Quota Drift** | > 0 inconsistent | `WARNING` | Navigate to `System Health & Operations` tab and click **"Repair Quotas"**. |

### Prometheus Monitoring
Scrape endpoint: `GET /metrics` on port 4000.
Key alert rules:
* `toowix_mongodb_up == 0` for > 1m -> PagerDuty / Critical Alert.
* `toowix_stalwart_up == 0` for > 1m -> PagerDuty / Critical Alert.
* `toowix_stalwart_latency_ms > 500` for > 5m -> High Latency Warning.
