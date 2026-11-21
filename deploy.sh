#!/usr/bin/env bash
# Deploy only F1 Telemetry on its pinned weekend-tyre-sets branch.
# Safe for manual SSH and approved GitHub Actions; does not modify GRIDLOCK.
set -Eeuo pipefail

readonly REPO_DIR='/opt/f1/f1_telemetry'
readonly EXPECTED_BRANCH='weekend-tyre-sets'
readonly EXPECTED_ENV='/etc/f1-env/f1_telemetry.env'

# /** Stop immediately on unsafe checkout, file, or deployment conditions. */
fail() { printf 'DEPLOY BLOCKED: %s\n' "$1" >&2; exit 1; }

# /** Require the intended GitHub remote; never deploy another project's checkout. */
verify_remote() {
  local url
  url="$(git remote get-url origin)" || fail 'The checkout has no origin remote.'
  case "$url" in
    'https://github.com/shivangsarat/f1_telemetry'|'https://github.com/shivangsarat/f1_telemetry.git'|\
    'git@github.com:shivangsarat/f1_telemetry'|'git@github.com:shivangsarat/f1_telemetry.git'|\
    'ssh://git@github.com/shivangsarat/f1_telemetry'|'ssh://git@github.com/shivangsarat/f1_telemetry.git') ;;
    *) fail 'Unexpected Git remote. Verify this VM checkout before deploying.' ;;
  esac
}

# /** Check local prerequisites and confirm persistent secrets are never managed by Git. */
preflight() {
  [[ -d "$REPO_DIR/.git" ]] || fail 'Expected F1 Telemetry Git checkout is missing.'
  cd "$REPO_DIR"
  command -v git >/dev/null || fail 'git is required.'
  command -v docker >/dev/null || fail 'Docker is required.'
  command -v curl >/dev/null || fail 'curl is required.'
  command -v flock >/dev/null || fail 'flock is required.'
  exec 9> "$REPO_DIR/.git/.deploy.lock"
  flock -n 9 || fail 'Another F1 Telemetry deployment is in progress.'
  verify_remote
  [[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail 'Tracked files are edited on this VM. Review git diff first.'
  [[ -s .env ]] || fail 'Missing or empty production .env file.'
  if [[ -L .env ]]; then
    [[ "$(readlink -f .env)" == "$EXPECTED_ENV" ]] || fail 'The .env symlink does not point at the approved external secret path.'
  else
    printf 'WARNING: .env is still repo-local. Migrate it to /etc/f1-env/ as described in docs/DEPLOYMENT.md.\n' >&2
  fi
}

# /** Switch only a clean checkout to the dedicated production branch and fast-forward it. */
update_branch() {
  local before
  before="$(git rev-parse --short HEAD)"
  git fetch --quiet origin "$EXPECTED_BRANCH"
  if [[ "$(git branch --show-current)" != "$EXPECTED_BRANCH" ]]; then
    if git show-ref --verify --quiet "refs/heads/$EXPECTED_BRANCH"; then
      git switch "$EXPECTED_BRANCH"
    else
      git switch -c "$EXPECTED_BRANCH" --track "origin/$EXPECTED_BRANCH"
    fi
  fi
  git merge-base --is-ancestor HEAD "origin/$EXPECTED_BRANCH" || fail 'Local production branch diverges from origin. Manual review is required.'
  git merge --ff-only "origin/$EXPECTED_BRANCH"
  [[ -s .env ]] || fail 'The production environment file went missing after checkout.'
  grep -q '127.0.0.1:8080:8080' docker-compose.yml || fail 'Updated Compose must publish telemetry only on loopback port 8080.'
  docker compose config -q || fail 'Updated Compose configuration is invalid.'
  printf 'F1 Telemetry release: %s -> %s (branch %s)\n' "$before" "$(git rev-parse --short HEAD)" "$EXPECTED_BRANCH"
}

# /** Rebuild and replace only the telemetry service, keeping GRIDLOCK and Caddy running. */
restart_telemetry() {
  docker compose up -d --build --no-deps f1-telemetry
  docker compose ps
}

# /** Check the HTML route using GET; a live WebSocket connection may need to reconnect. */
verify_health() {
  curl --fail --silent --show-error --retry 10 --retry-connrefused \
    --retry-delay 2 --max-time 8 http://127.0.0.1:8080/ > /dev/null || \
    fail 'Telemetry local HTTP health failed. Inspect docker compose ps/logs; do not assume deployment succeeded.'
  printf 'F1 Telemetry local HTTP OK on 127.0.0.1:8080. Refresh browser; verify WSS separately.\n'
}

preflight
update_branch
restart_telemetry
verify_health
