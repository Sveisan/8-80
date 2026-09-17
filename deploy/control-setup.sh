#!/usr/bin/env bash
# The control plane on a fresh Debian/Ubuntu VPS. Safe to re-run.
#
#   sudo bash deploy/control-setup.sh
#
# Installs Node, Postgres and Caddy, creates the database and the service user,
# writes the systemd units, and seeds .env with the two secrets it generates.
#
# It prints neither of them. An earlier version printed both and the
# instructions then asked for the output to be pasted into a chat — which is
# how a secret ends up somewhere nobody intended, by two reasonable steps that
# contradict each other. The values go straight into a 0600 file owned by the
# service user, and the only thing on screen is what is still missing.
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

# Generated here and written straight to .env. Never printed, never typed.
#
# The password is set whenever .env is about to be written, including when the
# role already exists: a re-run that kept the old password would have no way to
# learn it, and would seed a connection string with an empty one. The rule is
# that whoever writes .env also sets the password, so the two cannot disagree.
DB_PASS="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
ROLE_EXISTS="$(sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='$DB_USER'" || true)"
if [ -f "$REPO/.env" ]; then
  echo "    .env exists — leaving the role and its password alone"
  DB_PASS=""
elif [ "$ROLE_EXISTS" = "1" ]; then
  echo "    role $DB_USER exists — setting a fresh password for the new .env"
  sudo -u postgres psql -qc "alter role $DB_USER password '$DB_PASS'"
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

echo "==> .env"
if [ -f "$REPO/.env" ]; then
  echo "    .env exists — not touching it"
  SEEDED="no"
else
  # Written before anything reads it, and with the umask set so there is no
  # window in which the file exists and is world-readable.
  ( umask 077
    {
      echo "# Seeded by deploy/control-setup.sh on $(date -Iseconds)."
      echo "# The two secrets below were generated on this machine and printed nowhere."
      echo "DATABASE_URL=postgres://$DB_USER:${DB_PASS}@127.0.0.1:5432/$DB_NAME"
      echo "DATA_ENCRYPTION_KEY=$(openssl rand -base64 32)"
      echo "PUBLIC_URL=https://8and80.me"
      echo "CONTROL_PORT=8080"
      echo ""
      echo "# From the Speechify console — these are the only ones left to fill in."
      echo "SPEECHIFY_API_KEY="
      echo "SPEECHIFY_AGENT_ID="
      echo "SPEECHIFY_WEBHOOK_SECRET="
    } > "$REPO/.env"
  )
  SEEDED="yes"
fi
chown "$SERVICE_USER":"$SERVICE_USER" "$REPO/.env"
chmod 600 "$REPO/.env"

chown -R "$SERVICE_USER":"$SERVICE_USER" "$REPO"

if [ "$SEEDED" = "no" ]; then
  cat <<EOF

Installed. $REPO/.env was already there and has been left alone.
EOF
else
  cat <<EOF

Installed. $REPO/.env now holds a database URL and an encryption key, both
generated on this machine. Neither has been printed, and neither should be:
DATA_ENCRYPTION_KEY is what stands between a stolen database and a transcript of
somebody's worst week. Changing it later makes everything already stored
unreadable, so back it up somewhere you trust and leave it alone.
EOF
fi

cat <<EOF

Three values are still empty. Fill them in from the Speechify console:

  sudo -u $SERVICE_USER nano $REPO/.env

  SPEECHIFY_API_KEY   SPEECHIFY_AGENT_ID   SPEECHIFY_WEBHOOK_SECRET

Then:

  cd $REPO && npm install && npm run db:migrate
  systemctl enable --now 8and80-control 8and80-tick.timer

  curl -sS https://api.8and80.me/health     # expect {"ok":true}
EOF
