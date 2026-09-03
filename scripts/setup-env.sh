#!/usr/bin/env bash
#
# Guided .env setup. Prompts for each value, hides the secrets, and keeps them
# out of shell history — which a pasted `cat > .env` heredoc does not.
#
#   bash scripts/setup-env.sh && npm run preflight
#
set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  printf '.env already exists. Overwrite? [y/N]: ' >&2
  read -r ans
  case "$ans" in [yY]*) ;; *) echo "Left alone."; exit 0 ;; esac
fi

ask()  { printf '%s: ' "$1" >&2; read -r REPLY_VAL; }
asks() { printf '%s: ' "$1" >&2; read -rs REPLY_VAL; printf '\n' >&2; }

printf '\nTelephony provider [twilio/telnyx] (default twilio): ' >&2
read -r PROVIDER
PROVIDER=${PROVIDER:-twilio}

if [ "$PROVIDER" = "twilio" ]; then
  ask  "Twilio Account SID (AC...)";  SID=$REPLY_VAL
  asks "Twilio Auth Token (hidden)";  TOK=$REPLY_VAL
  TEL_BLOCK="TWILIO_ACCOUNT_SID=$SID
TWILIO_AUTH_TOKEN=$TOK"
else
  asks "Telnyx API key (hidden)";     KEY=$REPLY_VAL
  ask  "Telnyx connection id";        CONN=$REPLY_VAL
  TEL_BLOCK="TELNYX_API_KEY=$KEY
TELNYX_CONNECTION_ID=$CONN"
fi

asks "xAI API key (hidden)";                        XAI=$REPLY_VAL
ask  "Number to call FROM, E.164 (+1...)";          FROM=$REPLY_VAL
ask  "Your mobile, E.164 (+47...)";                 TO=$REPLY_VAL
ask  "Public host, no scheme (x.trycloudflare.com)"; HOST=$REPLY_VAL

cat > .env <<ENVEOF
TELEPHONY_PROVIDER=$PROVIDER
$TEL_BLOCK

VOICE_PROVIDER=grok
XAI_API_KEY=$XAI

OUTBOUND_CALLER_NUMBER=$FROM
STRESS_TEST_TARGET_NUMBER=$TO

VOICE_WS_PUBLIC_URL=wss://$HOST
VOICE_SERVICE_PORT=8080

# The one endpointing knob. 0 = most patient, 1 = most eager.
ENDPOINTING_SENSITIVITY=0.25
ENVEOF

chmod 600 .env
echo ""
echo "Wrote .env (chmod 600). Next: npm run preflight"
