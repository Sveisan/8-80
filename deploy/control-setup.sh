#!/usr/bin/env bash
# The control plane on a fresh Debian/Ubuntu VPS. Safe to re-run.
#
#   sudo bash deploy/control-setup.sh
#
# Installs Node, Postgres and Caddy, creates the database and the service user,
# writes the systemd units, and stops — deliberately — before touching .env.
# Every secret this needs is yours to paste on the box and nowhere else.
set -euo pipefail

REPO="${REPO:-/opt/8-80}"
DB_NAME="${DB_NAME:-eight80}"
DB_USER="${DB_USER:-eight80}"
SERVICE_USER="${SERVICE_USER:-eightandeighty}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[ "$(id -u)" -eq 0 ] || { echo "run with sudo" >&2; exit 1; }

echo "==> Node"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Postgres"
apt-get install -y postgresql
systemctl enable --now postgresql

# The password is generated here and printed once. Nobody types it, and it never
# travels through a chat window or a shell history on another machine.
DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
if sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='$DB_USER'" | grep -q 1; then
  echo "    role $DB_USER exists — leaving its password alone"
  DB_PASS=""
else
  sudo -u postgres psql -qc "create role $DB_USER login password '$DB_PASS'"
fi
sudo -u postgres psql -tAc "select 1 from pg_database where datname='$DB_NAME'" | grep -q 1 \
  || sudo -u postgres psql -qc "create database $DB_NAME owner $DB_USER"

echo "==> Service user"
id -u "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --home "$REPO" --shell /usr/sbin/nologin "$SERVICE_USER"

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi
cp "$HERE/Caddyfile.control" /etc/caddy/Caddyfile
mkdir -p /var/log/caddy
systemctl reload caddy || systemctl restart caddy

echo "==> systemd"
cp "$HERE/8and80-control.service" "$HERE/8and80-tick.service" "$HERE/8and80-tick.timer" /etc/systemd/system/
systemctl daemon-reload

echo "==> Firewall"
if command -v ufw >/dev/null; then ufw allow 80/tcp || true; ufw allow 443/tcp || true; fi

chown -R "$SERVICE_USER":"$SERVICE_USER" "$REPO"

cat <<EOF

Installed. Nothing is running yet, because .env does not exist.

Write $REPO/.env — start from .env.example. These four have to be right:

  DATABASE_URL=postgres://$DB_USER:${DB_PASS:-<the password you already set>}@127.0.0.1:5432/$DB_NAME
  DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)
  PUBLIC_URL=https://8and80.me
  CONTROL_PORT=8080

Then the Speechify three, from their console:

  SPEECHIFY_API_KEY=  SPEECHIFY_AGENT_ID=  SPEECHIFY_WEBHOOK_SECRET=

Then:

  cd $REPO && npm install && npm run db:migrate
  chmod 600 $REPO/.env && chown $SERVICE_USER $REPO/.env
  systemctl enable --now 8and80-control 8and80-tick.timer

  curl -sS https://api.8and80.me/health     # expect {"ok":true}

The DATA_ENCRYPTION_KEY above is generated fresh every run. Use the one from the
FIRST run and keep it: changing it makes every commitment already stored
unreadable, and there is no way back from that.
EOF
