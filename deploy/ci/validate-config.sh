#!/usr/bin/env bash
set -Eeuo pipefail
source /root/toowix-mail-platform/deploy/ci/common.sh
assert_project
docker info >/dev/null
compose config -q
services=$(compose config --services)
for svc in backend super-admin tenant-admin backup-cron mongodb webmail; do
  grep -Fxq "$svc" <<<"$services" || { echo "Required Compose service absent: $svc" >&2; exit 3; }
done
[[ $(df -Pk "$DEPLOY_DIR" | awk 'NR==2 {print $4}') -gt 2097152 ]] || { echo 'Less than 2 GiB free disk' >&2; exit 3; }
[[ -d $STATE ]] || mkdir -p "$STATE"
[[ $(stat -c '%u' "$STATE") == 0 ]] || exit 3
echo 'Preflight passed'
