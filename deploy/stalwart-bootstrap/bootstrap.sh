#!/usr/bin/env bash
# ==============================================================================
# Stalwart Mail Server Service Principal Bootstrap Script
# ==============================================================================
# Usage:
#   ./bootstrap.sh <STALWART_URL> <ADMIN_USER> <ADMIN_PASS> <SERVICE_USER> <SERVICE_PASS>
# Example:
#   ./bootstrap.sh http://localhost:8080 admin@toowix.test MasterAdminPass toowix-service@toowix.test ServiceSecret2026!

set -euo pipefail

STALWART_URL="${1:-http://localhost:8090}"
ADMIN_USER="${2:-admin@toowix.test}"
ADMIN_PASS="${3:-wzo1tYSEbJA6UJF6}"
SERVICE_USER="${4:-toowix-service@toowix.test}"
SERVICE_PASS="${5:-ToowixServiceSecret2026!Secure}"

echo "[1/3] Verifying Stalwart connectivity at ${STALWART_URL}..."
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -k -u "${ADMIN_USER}:${ADMIN_PASS}" "${STALWART_URL}/api/account" || true)

if [ "${STATUS_CODE}" != "200" ]; then
    echo "ERROR: Unable to authenticate against Stalwart as ${ADMIN_USER} (HTTP ${STATUS_CODE})"
    exit 1
fi
echo "Connected successfully to Stalwart Mail Server."

SERVICE_NAME=$(echo "${SERVICE_USER}" | cut -d'@' -f1)
SERVICE_DOMAIN=$(echo "${SERVICE_USER}" | cut -d'@' -f2)

echo "[2/3] Ensuring service domain ${SERVICE_DOMAIN} exists..."
# Check domain via JMAP
curl -s -k -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -H "Content-Type: application/json" \
  -X POST "${STALWART_URL}/jmap/" \
  -d '{
    "using": ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
    "methodCalls": [
      ["x:Domain/set", {
        "accountId": "b",
        "create": {
          "new_domain": {
            "name": "'"${SERVICE_DOMAIN}"'",
            "description": "Toowix System Domain"
          }
        }
      }, "c1"]
    ]
  }' > /dev/null || true

echo "[3/3] Provisioning Toowix Backend Service Account: ${SERVICE_USER}..."
curl -s -k -u "${ADMIN_USER}:${ADMIN_PASS}" \
  -H "Content-Type: application/json" \
  -X POST "${STALWART_URL}/jmap/" \
  -d '{
    "using": ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
    "methodCalls": [
      ["x:Account/set", {
        "accountId": "b",
        "create": {
          "service_acc": {
            "@type": "User",
            "name": "'"${SERVICE_NAME}"'",
            "description": "Toowix Control Plane Service Principal",
            "roles": ["admin"],
            "credentials": {
              "0": {
                "@type": "Password",
                "secret": "'"${SERVICE_PASS}"'"
              }
            }
          }
        }
      }, "c2"]
    ]
  }' > /dev/null || true

echo "=============================================================================="
echo "SUCCESS: Toowix Backend Service Account bootstrap completed!"
echo "Service User: ${SERVICE_USER}"
echo "=============================================================================="
