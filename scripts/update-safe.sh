#!/usr/bin/env bash
# Run as root after merging the release. Sync weekly prompts before a call test.
# Only fixed status lines reach stdout. Diagnostics and backups stay private.
set +x
set -Eeuo pipefail
umask 077
export LC_ALL=C LANG=C GIT_TERMINAL_PROMPT=0

usage() { printf 'Run as root with the full release commit, optionally --resume and --dialogue-approval PRIVATE_FILE.\n' >&2; }
TARGET_COMMIT=${1:-}
if [[ $EUID -ne 0 || ! $TARGET_COMMIT =~ ^[0-9a-f]{40}$ ]]; then
  usage
  exit 2
fi
shift
RESUME=0
DIALOGUE_APPROVAL=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --resume) [[ $RESUME == 0 ]] || { usage; exit 2; }; RESUME=1; shift ;;
    --dialogue-approval)
      [[ -z $DIALOGUE_APPROVAL && $# -ge 2 && -n $2 && $2 != --* ]] || { usage; exit 2; }
      DIALOGUE_APPROVAL=$2; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

REPO=/opt/8-80
BRANCH=claude/8-80-prompt-v3-f9tk4m
STEP=initialization
WAS_ACTIVE=0
WEB_WAS_ACTIVE=0
TIMER_PAUSED=0
WEB_STOPPED=0
MUTATED=0
DIALOGUE_ATTEMPTED=0
exec 3>&1
install -d -m 700 /var/backups/8and80
RUN_DIR=$(mktemp -d /var/backups/8and80/update.XXXXXXXX)
exec >>"$RUN_DIR/private.log" 2>&1
report() { printf '%s\n' "$*" >&3; }
status_report() {
  if systemctl is-active --quiet 8and80-control.service 3>&-; then report 'Web: ACTIVE'; else report 'Web: NOT ACTIVE'; fi
  if systemctl is-active --quiet 8and80-tick.timer 3>&-; then report 'Scheduled calls: ACTIVE'; else report 'Scheduled calls: PAUSED'; fi
}
# Root's private backup umask must not become the source/dependency umask.
# Git metadata and checkout files belong to the service user; .env and private
# runtime files keep their existing modes. Never chmod the whole repository.
source_run() {
  sudo -u eightandeighty env LC_ALL=C LANG=C GIT_TERMINAL_PROMPT=0 \
    bash -c 'umask 022; exec "$@"' source-command "$@" 3>&-
}

health_check() {
  curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-connrefused --max-time 15 \
    --output "$RUN_DIR/health.json" https://api.8and80.me/health 3>&- &&
    node -e 'const fs = require("node:fs"); if (JSON.parse(fs.readFileSync(process.argv[1], "utf8")).ok !== true) process.exit(1)' "$RUN_DIR/health.json" 3>&-
}

failed() {
  local rc=$? recovered=1
  trap - ERR
  set +e
  report "FAILED: $STEP (exit $rc). Share only this report; diagnostics remain private on the server."
  if [[ $MUTATED == 0 ]]; then
    if [[ $WEB_STOPPED == 1 && $WEB_WAS_ACTIVE == 1 ]]; then
      systemctl start 8and80-control.service 3>&- && systemctl is-active --quiet 8and80-control.service 3>&- || recovered=0
    fi
    if [[ $TIMER_PAUSED == 1 && $WAS_ACTIVE == 1 && $recovered == 1 ]]; then
      systemctl start 8and80-tick.timer 3>&-
    fi
    report 'No release mutation was started; original service state was restored where possible.'
  else
    # A failed enable/start could already have armed the timer. Never stop a
    # running tick: the exclusive release lock prevents it placing new calls.
    systemctl stop 8and80-tick.timer 3>&-
    if [[ $DIALOGUE_ATTEMPTED == 1 ]]; then
      if source_run node --import tsx services/voice/src/weekly/rollout-cli.ts --disable; then
        if systemctl restart 8and80-control.service 3>&- && systemctl is-active --quiet 8and80-control.service 3>&- && health_check; then
          report 'Recovery: dialogue disabled; web recovered. Scheduled calls remain paused.'
        else
          report 'Recovery: dialogue disabled; web still needs review. Scheduled calls remain paused.'
        fi
      else
        # Do not keep an uncertain enabled process serving new requests.
        systemctl stop 8and80-control.service 3>&-
        report 'Recovery needs review: dialogue disable was not confirmed. Scheduled calls remain paused.'
      fi
    fi
  fi
  status_report
  report '=== END REPORT ==='
  exit "$rc"
}
trap failed ERR

# Read-only, content-free drain check. A stale/unknown call is deliberately a
# refusal for an operator to investigate, never a reason to terminate it.
no_active_calls() {
  local tick_state
  tick_state=$(systemctl is-active 8and80-tick.service 3>&- || true)
  [[ $tick_state == inactive || $tick_state == failed ]] || return 1
  source_run node --import tsx --input-type=module - <<'CHECK_CALLS'
console.log = console.warn = console.error = () => {};
let sql;
try {
  const [{config}, {default:postgres}] = await Promise.all([
    import('./services/voice/src/config.ts'), import('postgres'),
  ]);
  if (!config.database.url) throw new Error();
  sql = postgres(config.database.url, {max:1, connect_timeout:5});
  const empty = await sql.begin(async tx => {
    await tx`set transaction read only`;
    const [row] = await tx`select count(*)::int as n from call_attempts where status in ('claimed','placed','active','settling')`;
    return row?.n === 0;
  });
  if (!empty) process.exitCode = 1;
} catch { process.exitCode = 1; }
finally { await sql?.end({timeout:5}); }
CHECK_CALLS
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

if systemctl is-active --quiet 8and80-tick.timer 3>&-; then WAS_ACTIVE=1; fi
if systemctl is-active --quiet 8and80-control.service 3>&-; then WEB_WAS_ACTIVE=1; fi
STEP='pausing scheduling and checking the call drain'
TIMER_PAUSED=1
systemctl stop 8and80-tick.timer 3>&-
source_run bash -c 'set -e; umask 077; mkdir -p runs; test ! -L runs/release.lock; : >>runs/release.lock'
exec 8>>runs/release.lock
flock -x -n 8 3>&-
no_active_calls
STEP='stopping web and rechecking the call drain'
WEB_STOPPED=1
systemctl stop 8and80-control.service 3>&-
no_active_calls
report 'OK: no active calls; services paused under the release lock'

STEP='backing up database and configuration'
sudo -u postgres pg_dump --format=custom eight80 > "$RUN_DIR/database.dump" 3>&-
cp -p .env "$RUN_DIR/env" 3>&-
source_run git rev-parse HEAD > "$RUN_DIR/previous-commit"
report 'OK: database and configuration backed up privately'

STEP='updating code'
MUTATED=1
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
if [[ -n $DIALOGUE_APPROVAL ]]; then
  STEP='verifying and activating approved dialogue'
  DIALOGUE_ATTEMPTED=1
  source_run node --import tsx services/voice/src/weekly/rollout-cli.ts --activate "$DIALOGUE_APPROVAL"
  report 'OK: approved dialogue activated; feature-tool setting preserved'
fi
STEP='starting web service'
systemctl start 8and80-control.service 3>&-
systemctl is-active --quiet 8and80-control.service 3>&-
STEP='checking web health'
health_check
report 'OK: web health check passed'

STEP='restoring scheduler state'
if [[ $RESUME == 1 ]]; then
  systemctl enable --now 8and80-tick.timer 3>&-
elif [[ $WAS_ACTIVE == 1 ]]; then
  systemctl start 8and80-tick.timer 3>&-
fi
status_report
report 'UPDATE COMPLETE. Share only this report; keep backups and diagnostics on the server.'
report '=== END REPORT ==='
