#!/usr/bin/env bash
set -Eeuo pipefail

umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
unset BASH_ENV ENV CDPATH GIT_CONFIG_GLOBAL

DEPLOY_DIR=/root/toowix-mail-platform/deploy
CI_DIR=$DEPLOY_DIR/ci
WRAPPER=/usr/local/sbin/toowix-deploy
RUNNER_USER=github-runner
SUDOERS_FILE=/etc/sudoers.d/toowix-runner

die() {
  echo "Installation failed: $*" >&2
  exit 1
}

[[ $(id -u) == 0 ]] || die 'run as root'
id "$RUNNER_USER" >/dev/null 2>&1 || die "runner user does not exist: $RUNNER_USER"
id -nG "$RUNNER_USER" | tr ' ' '\n' | grep -Fxq docker &&
  die "$RUNNER_USER must not belong to the docker group"

required=(
  common.sh
  deploy-service.sh
  health-check.sh
  rollback-service.sh
  validate-config.sh
  toowix-deploy
)
required_paths=()
for file in "${required[@]}"; do
  path=$CI_DIR/$file
  [[ -f $path && ! -L $path ]] || die "missing or unsafe symlink: $path"
  [[ $(stat -c '%u' "$path") == 0 ]] || die "$path must be owned by root"
  mode=$((8#$(stat -c '%a' "$path")))
  (( (mode & 0022) == 0 )) || die "$path must not be group/world writable"
  required_paths+=("$path")
done

[[ -f $DEPLOY_DIR/docker-compose.prod.yml && ! -L $DEPLOY_DIR/docker-compose.prod.yml ]] ||
  die 'missing production Compose file or unsafe symlink'
[[ $(stat -c '%u' "$DEPLOY_DIR/docker-compose.prod.yml") == 0 ]] ||
  die 'production Compose file must be owned by root'
compose_mode=$((8#$(stat -c '%a' "$DEPLOY_DIR/docker-compose.prod.yml")))
(( (compose_mode & 0022) == 0 )) || die 'production Compose file must not be group/world writable'
chown root:root "$DEPLOY_DIR/docker-compose.prod.yml"
chmod 640 "$DEPLOY_DIR/docker-compose.prod.yml"

if [[ ! -f $DEPLOY_DIR/.env.production ]]; then
  [[ ! -L $DEPLOY_DIR/.env.production ]] || die '.env.production must not be a symlink'
  [[ -f $DEPLOY_DIR/.env && ! -L $DEPLOY_DIR/.env ]] ||
    die 'missing .env migration source or unsafe symlink'
  chown root:root "$DEPLOY_DIR/.env"
  chmod 600 "$DEPLOY_DIR/.env"
  install -o root -g root -m 600 "$DEPLOY_DIR/.env" "$DEPLOY_DIR/.env.production"
  echo 'Created .env.production from the existing production .env'
else
  [[ ! -L $DEPLOY_DIR/.env.production ]] || die '.env.production must not be a symlink'
  chown root:root "$DEPLOY_DIR/.env.production"
  chmod 600 "$DEPLOY_DIR/.env.production"
fi

chmod 700 "${required_paths[@]}"
install -o root -g root -m 700 "$CI_DIR/toowix-deploy" "$WRAPPER"
install -d -o root -g root -m 700 "$DEPLOY_DIR/.deploy-state"
install -d -o root -g root -m 700 "$DEPLOY_DIR/.docker-deploy"

sudoers_tmp=$(mktemp)
trap 'rm -f "$sudoers_tmp"' EXIT
printf '%s\n' \
  "$RUNNER_USER ALL=(root) NOPASSWD: $WRAPPER *" > "$sudoers_tmp"
chmod 440 "$sudoers_tmp"
visudo -cf "$sudoers_tmp" >/dev/null
install -o root -g root -m 440 "$sudoers_tmp" "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE" >/dev/null

sudo -u "$RUNNER_USER" sudo -n "$WRAPPER" validate
echo 'Toowix deployment runner installation completed successfully'
