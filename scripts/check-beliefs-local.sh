#!/usr/bin/env bash
# Local verification only. Always creates its own DB through test-with-db.sh.
set +x
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")/.."
TASK_RUN_DIR=$(mktemp -d "${TMPDIR:-/tmp}/8and80-beliefs-check.XXXXXXXX")
TASK_LOG="$TASK_RUN_DIR/private.log"
report() { printf '%s\n' "$*"; }
report '=== BELIEFS LOCAL CHECK ==='
TASK_PG_BIN=/private/tmp/8and80-beliefs-pg/package/native/bin
TASK_PG_CLIENT=/opt/homebrew/opt/libpq
trap 'rm -rf "$TASK_RUN_DIR/package" "$TASK_RUN_DIR"/*.tgz' EXIT
cached_postgres() {
  # Read the one known public archive through npm's integrity-checking cache API.
  # Unlike npm pack, this does not write to the shared npm cache or use a network.
  node --input-type=module - "$(command -v npm)" "$TASK_RUN_DIR/embedded-postgres-darwin-arm64-18.4.0-beta.17.tgz" >>"$TASK_LOG" 2>&1 <<'NODE'
import { realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
try {
  const require = createRequire(realpathSync(process.argv[2]));
  const key = 'make-fetch-happen:request-cache:https://registry.npmjs.org/@embedded-postgres/darwin-arm64/-/darwin-arm64-18.4.0-beta.17.tgz';
  const cached = await require('cacache').get(homedir() + '/.npm/_cacache', key);
  writeFileSync(process.argv[3], cached.data, { mode: 0o600 });
} catch { process.exitCode = 1; }
NODE
}
if command -v initdb >/dev/null && command -v pg_ctl >/dev/null && command -v postgres >/dev/null && command -v psql >/dev/null; then
  : # Prefer a complete installed runtime.
elif [[ -x "$TASK_PG_BIN/initdb" && -x "$TASK_PG_BIN/pg_ctl" && -x "$TASK_PG_BIN/postgres" && -x "$TASK_PG_CLIENT/bin/psql" ]]; then
  if [[ -f "$TASK_PG_BIN/../share/postgresql/postgres.bki" && -f "$TASK_PG_BIN/../share/postgresql/pg_hba.conf.sample" ]]; then
    export PATH="$TASK_PG_BIN:$TASK_PG_CLIENT/bin:$PATH"
  elif [[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] && cached_postgres; then
    # Temporary text resources may have expired. Extract the exact previously
    # cached bundle privately; no network, installation or shared-runtime writes.
    tar -xzf "$TASK_RUN_DIR/embedded-postgres-darwin-arm64-18.4.0-beta.17.tgz" -C "$TASK_RUN_DIR" >>"$TASK_LOG" 2>&1
    # The package's usual install step supplies the major-version dylib aliases.
    # Recreate those links only inside this disposable extraction.
    for TASK_LIBRARY in "$TASK_RUN_DIR/package/native/lib/"*.dylib; do
      TASK_LIBRARY_NAME=$(basename "$TASK_LIBRARY")
      if [[ "$TASK_LIBRARY_NAME" =~ ^([^.]+\.[0-9]+)\.[0-9]+(\.[0-9]+)?\.dylib$ ]]; then
        TASK_ALIAS="$TASK_RUN_DIR/package/native/lib/${BASH_REMATCH[1]}.dylib"
        [[ -e "$TASK_ALIAS" ]] || ln -s "$TASK_LIBRARY_NAME" "$TASK_ALIAS"
      fi
    done
    ln -s libicui18n.77.1.dylib "$TASK_RUN_DIR/package/native/lib/libicui18n.dylib"
    export PATH="$TASK_RUN_DIR/package/native/bin:$TASK_PG_CLIENT/bin:$PATH"
  else
    report 'POSTGRES RUNTIME: INCOMPLETE (complete installation or cached bundle required)'
    exit 1
  fi
fi
# Ignore inherited test URLs; the disposable runner owns the entire DB it creates.
unset TEST_DATABASE_URL
if npm run typecheck >>"$TASK_LOG" 2>&1; then report 'TYPECHECK: PASS'; else report 'TYPECHECK: FAIL'; report "PRIVATE LOG: $TASK_LOG"; exit 1; fi
if npm run lint >>"$TASK_LOG" 2>&1; then report 'LINT: PASS'; else report 'LINT: FAIL'; report "PRIVATE LOG: $TASK_LOG"; exit 1; fi
export TEST_PG_PORT=15674
if npm run test:db >>"$TASK_LOG" 2>&1; then report 'DISPOSABLE DATABASE SUITE: PASS'; else report 'DISPOSABLE DATABASE SUITE: FAIL'; report "PRIVATE LOG: $TASK_LOG"; exit 1; fi
report 'PROVIDERS: NOT CONTACTED'
report 'LAUNCH FLAGS: NOT CHANGED'
report "PRIVATE LOG: $TASK_LOG"
report '=== END REPORT ==='
