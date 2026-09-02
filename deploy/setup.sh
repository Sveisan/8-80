#!/usr/bin/env bash
# First-time setup on a fresh Debian/Ubuntu VPS. Safe to re-run.
set -euo pipefail

DOMAIN="${1:-}"
if [ -z "$DOMAIN" ]; then
  echo "usage: sudo bash deploy/setup.sh voice.yourdomain.com" >&2
  exit 1
fi

echo "==> Node"
if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "==> Caddy"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

echo "==> Caddyfile for $DOMAIN"
sed "s/voice\.example\.com/$DOMAIN/" "$(dirname "$0")/Caddyfile" > /etc/caddy/Caddyfile
mkdir -p /var/log/caddy
systemctl reload caddy || systemctl restart caddy

echo "==> Firewall"
if command -v ufw >/dev/null; then
  ufw allow 80/tcp  || true
  ufw allow 443/tcp || true
fi

cat <<EOF

Done.

  VOICE_WS_PUBLIC_URL=wss://$DOMAIN

Before the first call, confirm:
  · $DOMAIN has an A record to this host
  · that record is DNS-only in Cloudflare (grey cloud), NOT proxied
EOF
