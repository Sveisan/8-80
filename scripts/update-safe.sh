#!/usr/bin/env bash
# Run as root after merging the release and saving both voice-agent prompts.
# Only fixed status lines reach stdout. Diagnostics and backups stay private.
set +x
set -Eeuo pipefail
umask 077
export LC_ALL=C LANG=C

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
trap 'rc=$?; report "FAILED: $STEP (exit $rc). Share only this report; diagnostics remain private on the server."; if systemctl is-active --quiet 8and80-tick.timer 3>&-; then report "Scheduled calls: ACTIVE"; else report "Scheduled calls: PAUSED"; fi; exit "$rc"' ERR

report '=== 8AND80 UPDATE REPORT ==='
STEP='checking merged release and clean checkout'
cd "$REPO"
[[ -z $(git status --porcelain 3>&-) ]]
[[ $(git branch --show-current 3>&-) == "$BRANCH" ]]
git fetch origin 3>&-
git merge-base --is-ancestor "$TARGET_COMMIT" "origin/$BRANCH" 3>&-
report 'OK: merged release is available; checkout is clean'

WAS_ACTIVE=0
if systemctl is-active --quiet 8and80-tick.timer 3>&-; then WAS_ACTIVE=1; fi
STEP='pausing services'
systemctl stop 8and80-tick.timer 8and80-tick.service 8and80-control.service 3>&-
report 'OK: services paused for update'

STEP='backing up database and configuration'
sudo -u postgres pg_dump --format=custom eight80 > "$RUN_DIR/database.dump" 3>&-
cp -p .env "$RUN_DIR/env" 3>&-
git rev-parse HEAD > "$RUN_DIR/previous-commit" 3>&-
report 'OK: database and configuration backed up privately'

STEP='updating code'
git merge --ff-only "origin/$BRANCH" 3>&-
report 'OK: code updated'
STEP='installing dependencies'
sudo -u eightandeighty npm ci --include=dev 3>&-
report 'OK: dependencies installed'
STEP='applying migrations'
sudo -u eightandeighty npm run db:migrate 3>&-
report 'OK: database migrations applied'
STEP='checking configuration'
sudo -u eightandeighty npm run preflight 3>&-
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
if systemctl is-active --quiet 8and80-tick.timer 3>&-; then report 'Scheduled calls: ACTIVE'; else report 'Scheduled calls: PAUSED'; fi
report 'UPDATE COMPLETE. Share only this report; keep backups and diagnostics on the server.'
report '=== END REPORT ==='
