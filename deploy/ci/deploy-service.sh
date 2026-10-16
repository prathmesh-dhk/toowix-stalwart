#!/usr/bin/env bash
set -Eeuo pipefail
source /root/toowix-mail-platform/deploy/ci/common.sh
svc=${1:-}; tag=${2:-}; check_service "$svc"
[[ "$tag" =~ ^sha-[a-f0-9]{40}$ ]] || exit 2
lock; assert_project
"$CI_DIR/validate-config.sh"
name=$(container_name "$svc")
old=$(docker inspect -f '{{.Image}}' "$name")
[[ "$old" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 3
image="$(image_repo "$svc"):$tag"
path=$STATE/$svc
mkdir -p "$path"
# Idempotent: no needless replacement.
if [[ $(docker inspect -f '{{.Config.Image}}' "$name") == "$image" ]]; then
  "$CI_DIR/health-check.sh" "$svc"
  echo "Already deployed: $svc $tag"; exit 0
fi
# Pull before touching the running service.
docker pull "$image"
new_id=$(docker image inspect -f '{{.Id}}' "$image")
[[ "$new_id" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 3
# Preserve original content by unique ID and separate rolling history.
if docker image inspect "$old" >/dev/null 2>&1; then
  docker tag "$old" "toowix-preserved-$svc:$(date -u +%Y%m%d%H%M%S)-$$"
else
  echo "Warning: running image $old is no longer present locally; skipping preservation tag" >&2
fi
printf '%s\n' "$old" > "$path/previous_id"
printf '%s\n' "$new_id" > "$path/pending_id"
var=$(image_var "$svc")
export "$var=$image"
restore_on_failure() {
  rc=$?
  trap - ERR
  echo "Deployment failed for $svc, restoring old image ($old)" >&2
  export "$var=$old"
  if compose up -d --no-deps --no-build "$svc" && "$CI_DIR/health-check.sh" "$svc"; then
    printf '%s\n' "$old" > "$path/current_id"
    echo 'Previous container restored' >&2
  else
    echo 'CRITICAL: automatic restoration failed; intervene immediately' >&2
  fi
  exit "$rc"
}
trap restore_on_failure ERR
compose up -d --no-deps --no-build "$svc"
"$CI_DIR/health-check.sh" "$svc"
trap - ERR
printf '%s\n' "$new_id" > "$path/current_id"
printf '%s | %s | %s\n' "$(date -u +%FT%TZ)" "$svc" "$image" >> "$path/history.log"
if [[ $svc == backend ]]; then
  # Worker stays untouched if a backup is running; pending is explicit.
  if docker top toowix-prod-backup-cron 2>/dev/null | grep -Eq 'backup-s3.sh|mongodump'; then
    printf '%s\n' "$image" > "$STATE/backup-cron.pending"
    echo 'Backend deployed; backup-cron still running, update pending' >&2
    exit 0
  fi
  old_worker=$(docker inspect -f '{{.Image}}' toowix-prod-backup-cron)
  if docker image inspect "$old_worker" >/dev/null 2>&1; then
    docker tag "$old_worker" "toowix-preserved-backup-cron:$(date -u +%Y%m%d%H%M%S)-$$"
  else
    echo "Warning: worker image $old_worker not present locally; skipping preservation tag" >&2
  fi
  export BACKUP_CRON_IMAGE="$image"
  if ! compose up -d --no-deps --no-build backup-cron; then
    printf '%s\n' "$image" > "$STATE/backup-cron.pending"
    echo 'Backend healthy, but backup-cron update failed; update pending; inspect worker' >&2
    exit 6
  fi
  rm -f "$STATE/backup-cron.pending"
fi
echo "Deployment successful: $svc $image"
