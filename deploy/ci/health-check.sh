#!/usr/bin/env bash
set -Eeuo pipefail
source /root/toowix-mail-platform/deploy/ci/common.sh
svc=${1:-}; check_service "$svc"
case "$svc" in
 backend) url=http://127.0.0.1:4000/healthz; marker='"status"' ;;
 super-admin) url=http://127.0.0.1:5173/; marker='<div id="root">' ;;
 tenant-admin) url=http://127.0.0.1:5174/; marker='<div id="root">' ;;
esac
for i in $(seq 1 20); do
  result=$(curl -fsS --max-time 5 "$url" 2>/dev/null) && grep -Fq "$marker" <<< "$result" && {
    [[ $(docker inspect -f '{{.State.Running}}' "$(container_name "$svc")") == true ]] && exit 0
  }
  sleep 2
done
echo "Health check failed: $svc ($url)" >&2
exit 1
