#!/usr/bin/env bash
#
# Run the whole suite, including the two thirds of it that need Postgres.
#
# Without a database those tests do not fail — they skip, quietly, and the
# summary still says everything passed. That is how a test asserting the old
# missed-call behaviour sat red for weeks while `npm test` reported green: 68
# skipped and nobody reading the number. So this exists to make the honest run
# the easy one.
#
#   ./scripts/test-with-db.sh              — throwaway cluster, run, tear down
#   TEST_DATABASE_URL=... npm test         — against a database you already have
#
# Nothing persists: the cluster lives in a temp directory and is removed on the
# way out, including after a failure or a Ctrl-C.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  echo "Using TEST_DATABASE_URL as given."
  exec npm test
fi

BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)
[[ -z "$BIN" ]] && BIN=$(dirname "$(command -v initdb 2>/dev/null || true)" || true)
if [[ -z "$BIN" || ! -x "$BIN/initdb" ]]; then
  echo "No local Postgres found. Install one, or point TEST_DATABASE_URL at a database." >&2
  exit 1
fi
export PATH="$BIN:$PATH"

# An unprivileged owner for the data directory: Postgres refuses to run as root,
# and this script is run as root often enough (containers, CI images) that
# finding out the hard way each time is not worth it.
OWNER=$(id -un)
if [[ "$OWNER" == "root" ]]; then
  OWNER=$(id -un postgres 2>/dev/null || true)
  [[ -z "$OWNER" ]] && { echo "Running as root and there is no postgres user to run the server as." >&2; exit 1; }
fi

DATA=$(mktemp -d /tmp/8and80-testdb.XXXXXX)
# A port of our own. The default is often taken by a real database, and taking
# somebody's development data for a test fixture is not a mistake worth allowing.
PORT=${TEST_PG_PORT:-5433}
chown "$OWNER" "$DATA"; chmod 700 "$DATA"

stop() {
  as "pg_ctl -D '$DATA' -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap stop EXIT INT TERM

as() { if [[ "$(id -un)" == "$OWNER" ]]; then bash -lc "PATH=$BIN:\$PATH $1"; else su "$OWNER" -c "PATH=$BIN:\$PATH $1"; fi; }

echo "Starting a throwaway Postgres on 127.0.0.1:$PORT ..."
as "initdb -D '$DATA' -A trust -U postgres" >/dev/null
as "pg_ctl -D '$DATA' -o '-p $PORT -c listen_addresses=127.0.0.1' -l '$DATA/log' -w start" >/dev/null

as "psql -h 127.0.0.1 -p $PORT -U postgres -q -c \"create role eight80 login password 'eight80' superuser\""
as "psql -h 127.0.0.1 -p $PORT -U postgres -q -c 'create database eight80_test owner eight80'"

export TEST_DATABASE_URL="postgres://eight80:eight80@127.0.0.1:$PORT/eight80_test"
npm test
