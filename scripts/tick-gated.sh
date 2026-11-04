#!/usr/bin/env bash
# Serialize scheduler startup with an application release; no administrator access needed.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p runs
exec 9>runs/release.lock
flock -s 9
if [[ -f runs/maintenance ]]; then exit 0; fi
exec node --import tsx services/voice/src/tick-cli.ts "$@"
