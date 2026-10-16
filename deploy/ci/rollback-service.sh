#!/usr/bin/env bash
set -Eeuo pipefail
source /root/toowix-mail-platform/deploy/ci/common.sh
svc=${1:-}; check_service "$svc"; lock; assert_project
path=$STATE/$svc
[[ -s "$path/previous_id" ]] || { echo 'No previous image ID' >&2; exit 4; }
previous=$(cat "$path/previous_id")
[[ "$previous" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 4
docker image inspect "$previous" >/dev/null || exit 4
var=$(image_var "$svc")
export "$var=$previous"
compose up -d --no-deps --no-build "$svc"
"$CI_DIR/health-check.sh" "$svc"
printf '%s\n' "$previous" > "$path/current_id"
echo "Rollback succeeded: $svc"
# Backup cron is intentionally not modified during backend rollback.
