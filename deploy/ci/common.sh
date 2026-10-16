#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
DEPLOY_DIR=/root/toowix-mail-platform/deploy
CI_DIR=$DEPLOY_DIR/ci
COMPOSE=$DEPLOY_DIR/docker-compose.prod.yml
ENVFILE=$DEPLOY_DIR/.env.production
STATE=$DEPLOY_DIR/.deploy-state
PROJECT=deploy
[[ -f $COMPOSE && -f $ENVFILE ]] || { echo 'Missing production compose or .env.production' >&2; exit 3; }
[[ $(stat -c '%u' "$COMPOSE") == 0 ]] || exit 3
[[ $(stat -c '%u' "$ENVFILE") == 0 ]] || exit 3
compose() { docker compose -p "$PROJECT" --project-directory "$DEPLOY_DIR" --env-file "$ENVFILE" -f "$COMPOSE" "$@"; }
check_service() { case "$1" in backend|super-admin|tenant-admin) ;; *) echo 'Invalid service' >&2; exit 2;; esac; }
container_name() { echo "toowix-prod-$1"; }
image_var() { case "$1" in backend) echo BACKEND_IMAGE;;super-admin) echo SUPER_ADMIN_IMAGE;;tenant-admin) echo TENANT_ADMIN_IMAGE;;esac; }
image_repo() { echo "ghcr.io/prathmesh-dhk/toowix-$1"; }
# Prevent silent project changes or adoption of unrelated containers.
assert_project() {
  for c in toowix-prod-mongodb toowix-prod-backend toowix-prod-super-admin toowix-prod-tenant-admin; do
    local project
    project=$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c" 2>/dev/null) || { echo "Expected production container absent: $c" >&2; exit 3; }
    [[ "$project" == deploy ]] || { echo "Wrong Compose project on $c: $project" >&2; exit 3; }
  done
}
assert_no_change_to_protected() {
  local c before after
  for c in toowix-prod-mongodb toowix-prod-webmail toowix-prod-stalwart; do
    before=${!1:-}
    : "$before"
  done
}
lock() { mkdir -p "$STATE"; exec 9>"$STATE/.lock"; flock -x -w 120 9 || exit 75; }
