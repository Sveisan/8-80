#!/usr/bin/env bash
# Run as root after merging the release. Sync weekly prompts before a call test.
# Only fixed status lines reach stdout. Diagnostics and backups stay private.
set +x
set -Eeuo pipefail
umask 077
export LC_ALL=C LANG=C GIT_TERMINAL_PROMPT=0

TARGET_COMMIT=${1:-}
RESUME=${2:-}
if [[ $EUID -ne 0 || ! $TARGET_COMMIT =~ ^[0-9a-f]{40}$ || ( -n $RESUME && $RESUME != --resume ) ]]; then
  printf 'Run as root with the full release commit, optionally followed by --resume.\n' >&2
  exit 2
fi

REPO=/opt/8-80
BRANCH=claude/8-80-prompt-v3-f9tk4m
STEP=initialization
exec 3>&1
install -d -m 700 /var/backups/8and80
RUN_DIR=$(mktemp -d /var/backups/8and80/update.XXXXXXXX)
exec >>"$RUN_DIR/private.log" 2>&1
report() { printf '%s\n' "$*" >&3; }
status_report() {
  if systemctl is-active --quiet 8and80-control.service 3>&-; then report 'Web: ACTIVE'; else report 'Web: NOT ACTIVE'; fi
  if systemctl is-active --quiet 8and80-tick.timer 3>&-; then report 'Scheduled calls: ACTIVE'; else report 'Scheduled calls: PAUSED'; fi
}
trap 'rc=$?; report "FAILED: $STEP (exit $rc). Share only this report; diagnostics remain private on the server."; status_report; exit "$rc"' ERR

# Root's private backup umask must not become the source/dependency umask.
# Git metadata and checkout files belong to the service user; .env and private
# runtime files keep their existing modes. Never chmod the whole repository.
source_run() {
  sudo -u eightandeighty env LC_ALL=C LANG=C GIT_TERMINAL_PROMPT=0 \
    bash -c 'umask 022; exec "$@"' source-command "$@" 3>&-
}

report '=== 8AND80 UPDATE REPORT ==='
STEP='acquiring update lock'
exec 9>/run/lock/8and80-update.lock
flock -n 9 3>&-
STEP='checking merged release and clean checkout'
cd "$REPO"
CHECKOUT_STATUS=$(source_run git status --porcelain)
[[ -z $CHECKOUT_STATUS ]]
CHECKOUT_BRANCH=$(source_run git branch --show-current)
[[ $CHECKOUT_BRANCH == "$BRANCH" ]]
source_run git fetch origin
source_run git merge-base --is-ancestor "$TARGET_COMMIT" "origin/$BRANCH"
source_run git merge-base --is-ancestor HEAD "$TARGET_COMMIT"
report 'OK: merged release is available; checkout is clean'

WAS_ACTIVE=0
if systemctl is-active --quiet 8and80-tick.timer 3>&-; then WAS_ACTIVE=1; fi
STEP='pausing services'
systemctl stop 8and80-tick.timer 8and80-tick.service 8and80-control.service 3>&-
report 'OK: services paused for update'

STEP='backing up database and configuration'
sudo -u postgres pg_dump --format=custom eight80 > "$RUN_DIR/database.dump" 3>&-
cp -p .env "$RUN_DIR/env" 3>&-
source_run git rev-parse HEAD > "$RUN_DIR/previous-commit"
report 'OK: database and configuration backed up privately'

STEP='updating code'
source_run git merge --ff-only "$TARGET_COMMIT"
source_run test -r services/voice/src/server.ts
report 'OK: code updated'
STEP='installing dependencies'
source_run npm ci --include=dev
report 'OK: dependencies installed'
STEP='applying migrations'
source_run npm run db:migrate
report 'OK: database migrations applied'
STEP='checking configuration'
source_run npm run preflight
report 'OK: configuration checks passed'
STEP='starting web service'
systemctl start 8and80-control.service 3>&-
systemctl is-active --quiet 8and80-control.service 3>&-
STEP='checking web health'
curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-connrefused --max-time 15 \
  --output "$RUN_DIR/health.json" https://api.8and80.me/health 3>&-
node -e 'const fs = require("node:fs"); if (JSON.parse(fs.readFileSync(process.argv[1], "utf8")).ok !== true) process.exit(1)' "$RUN_DIR/health.json" 3>&-
report 'OK: web health check passed'

STEP='restoring scheduler state'
if [[ $RESUME == --resume ]]; then
  systemctl enable --now 8and80-tick.timer 3>&-
elif [[ $WAS_ACTIVE == 1 ]]; then
  systemctl start 8and80-tick.timer 3>&-
fi
status_report
report 'UPDATE COMPLETE. Share only this report; keep backups and diagnostics on the server.'
report '=== END REPORT ==='
