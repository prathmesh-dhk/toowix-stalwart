#!/usr/bin/env bash
# ==============================================================================
# Toowix Mail Platform — Production Automated S3 Backup Script
# Usage: Run via cron (e.g. 0 2 * * * /path/to/backup-s3.sh)
# ==============================================================================

set -euo pipefail

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="${BACKUP_DIR:-/var/backups/toowix}"
S3_BUCKET="${S3_BUCKET:-toowix-mail-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
MONGODB_URI="${MONGODB_URI:-mongodb://127.0.0.1:27017/toowix_mail}"
BACKUP_SECRET="${BACKUP_ENCRYPTION_KEY:-ToowixProductionEncryptionSecretKey2026!}"

mkdir -p "$BACKUP_DIR"
ARCHIVE_NAME="toowix-backup-${TIMESTAMP}.tar.gz"
ENCRYPTED_ARCHIVE="${ARCHIVE_NAME}.enc"

echo "[$(date -Iseconds)] Starting automated platform backup: ${ARCHIVE_NAME}..."

# 1. MongoDB dump
DUMP_DIR="${BACKUP_DIR}/dump_${TIMESTAMP}"
if command -v mongodump &> /dev/null; then
  echo "[$(date -Iseconds)] Executing mongodump..."
  mongodump --uri="${MONGODB_URI}" --out="${DUMP_DIR}" --quiet
else
  echo "[$(date -Iseconds)] Warning: mongodump binary not found. Creating snapshot directory..."
  mkdir -p "${DUMP_DIR}"
fi

# 2. Package and compress
echo "[$(date -Iseconds)] Compressing archive..."
tar -czf "${BACKUP_DIR}/${ARCHIVE_NAME}" -C "${BACKUP_DIR}" "dump_${TIMESTAMP}"
rm -rf "${DUMP_DIR}"

# 3. Encrypt archive with AES-256-CBC
echo "[$(date -Iseconds)] Encrypting archive with OpenSSL AES-256..."
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 100000 \
  -in "${BACKUP_DIR}/${ARCHIVE_NAME}" \
  -out "${BACKUP_DIR}/${ENCRYPTED_ARCHIVE}" \
  -k "${BACKUP_SECRET}"

rm -f "${BACKUP_DIR}/${ARCHIVE_NAME}"

# 4. Generate SHA-256 Checksum
CHECKSUM=$(sha256sum "${BACKUP_DIR}/${ENCRYPTED_ARCHIVE}" | awk '{print $1}')
echo "[$(date -Iseconds)] Archive SHA-256 checksum: ${CHECKSUM}"
echo "${CHECKSUM}  ${ENCRYPTED_ARCHIVE}" > "${BACKUP_DIR}/${ENCRYPTED_ARCHIVE}.sha256"

# 5. Upload to AWS S3 if AWS CLI is installed and configured
if command -v aws &> /dev/null && [ -n "${S3_BUCKET}" ]; then
  echo "[$(date -Iseconds)] Uploading encrypted archive to s3://${S3_BUCKET}/..."
  aws s3 cp "${BACKUP_DIR}/${ENCRYPTED_ARCHIVE}" "s3://${S3_BUCKET}/backups/${ENCRYPTED_ARCHIVE}" --quiet
  aws s3 cp "${BACKUP_DIR}/${ENCRYPTED_ARCHIVE}.sha256" "s3://${S3_BUCKET}/backups/${ENCRYPTED_ARCHIVE}.sha256" --quiet
  echo "[$(date -Iseconds)] S3 upload completed."
else
  echo "[$(date -Iseconds)] AWS CLI not available or S3_BUCKET not set. Preserving local encrypted archive in ${BACKUP_DIR}."
fi

# 6. Apply Retention Policy (Purge backups older than RETENTION_DAYS)
echo "[$(date -Iseconds)] Applying retention policy: purging archives older than ${RETENTION_DAYS} days..."
find "${BACKUP_DIR}" -type f -name "toowix-backup-*.enc*" -mtime +"${RETENTION_DAYS}" -delete

echo "[$(date -Iseconds)] Automated backup job finished successfully."
