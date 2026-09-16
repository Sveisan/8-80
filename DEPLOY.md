# DEPLOY — the voice service on the VPS

For the first call you need three things: the code on the box, a hostname with TLS that
Twilio can open a websocket to, and your `.env`. Twenty minutes, most of it DNS.

## 1. DNS — the one thing that is easy to get wrong

The domain is `8and80.me`, at Cloudflare. Four records:

```
8and80.me.        A   <vps-ip>    proxied      # the reschedule page and /r/ links
api.8and80.me.    A   <vps-ip>    proxied      # webhooks in
voice.8and80.me.  A   <vps-ip>    DNS-only     # the media socket, if Grok is ever used
mail.8and80.me.   …                            # Resend's three records, §6
```

**`voice.` must be DNS-only — grey cloud, not orange.** This is the single easiest
mistake in the whole architecture, because turning the proxy on looks like a security
improvement. It is not, here: proxying real-time audio adds latency to every turn and
drops long-held connections, and a fifteen-minute call is one connection. Everything
else can and should sit behind the proxy.

**`/r/` links live on the apex, and that is permanent.** A reschedule link goes out in a
text message and may be opened a week later, so whatever host it names has to answer
forever. The apex is also the shortest thing to type, which is the point of the short
codes — `8and80.me/r/k4m9x2qpzt` is 23 characters and looks like something a person
would send.

Webhooks get their own hostname for the opposite reason: nothing external remembers
`api.8and80.me` beyond the next delivery, so it can move whenever it needs to.

## 2. The box — one command

```bash
ssh <you>@91.189.127.85
sudo git clone -b claude/8-80-prompt-v3-f9tk4m https://github.com/Sveisan/8-80.git /opt/8-80
sudo bash /opt/8-80/deploy/control-setup.sh
```

That installs Node 22, Postgres, and Caddy; creates the database, its role and a
service user; writes the Caddyfile for `8and80.me` and `api.8and80.me`; installs the
systemd units; and opens 80 and 443. Safe to re-run.

It stops before `.env`, on purpose. Everything in that file — the database password, the
Speechify key, and above all `DATA_ENCRYPTION_KEY` — is yours to paste on the box and
nowhere else. A secret that passes through a chat window or another machine's shell
history is a secret with more copies than you can account for.

The script prints the exact `DATABASE_URL` and a freshly generated
`DATA_ENCRYPTION_KEY`. **Keep the key from the first run.** Changing it makes every
commitment already stored unreadable, and there is no way back from that — the callers
would still be on the hook for things the system could no longer quote.

Then:

```bash
cd /opt/8-80 && npm install && npm run db:migrate
sudo chmod 600 .env && sudo chown eightandeighty .env
sudo systemctl enable --now 8and80-control 8and80-tick.timer

curl -sS https://api.8and80.me/health        # {"ok":true}
```

`8and80-tick.timer` fires every minute and exits. A daemon with a sleep in it is a
product that silently stops calling people the night it dies; systemd restarting a
one-shot is somebody else's solved problem.

## 2b. The voice service — only if the Grok path is used

```bash
ssh <you>@<vps>
sudo mkdir -p /opt && cd /opt
sudo git clone -b claude/8-80-prompt-v3-f9tk4m https://github.com/Sveisan/8-80.git
cd 8-80
sudo bash deploy/setup.sh voice.<yourdomain>
npm install
```

`setup.sh` installs Node 22 and Caddy, writes the Caddyfile for your hostname, opens 80
and 443, and reloads. Caddy gets the certificate itself and renews it. Safe to re-run.

Check it before going further — this should return `{"ok":true}`:

```bash
curl https://voice.<yourdomain>/
```

If that fails, nothing else will work, and the reason is DNS or the firewall.

## 3. Your keys

```bash
cp .env.example .env
nano .env
```

```
TELEPHONY_PROVIDER=twilio
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
XAI_API_KEY=xai-...
OUTBOUND_CALLER_NUMBER=+1...           # your Twilio number
STRESS_TEST_TARGET_NUMBER=+47...       # your mobile
VOICE_WS_PUBLIC_URL=wss://voice.<yourdomain>
VOICE_SERVICE_PORT=8080
```

No port on `VOICE_WS_PUBLIC_URL` — Caddy is on 443 and proxies to 8080 locally.

```bash
chmod 600 .env
npm run preflight
```

## 4. The call

```bash
npm run stress
```

Run it over an interactive session (`ssh -t` if you are scripting it) — it asks for the
five scores when you hang up. It starts its own server, so nothing else needs to be
running.

Afterwards, `runs/` holds the scores and a timing trace. Bring both back.

## 5. Later — the persistent service

Not needed for the stress test. When the scheduler starts placing calls on its own:

```bash
sudo useradd -r -s /usr/sbin/nologin eightandeighty || true
sudo chown -R eightandeighty /opt/8-80
sudo cp deploy/8and80-voice.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now 8and80-voice
journalctl -u 8and80-voice -f
```

The unit runs the service hardened — read-only system paths, no home access, no new
privileges, and `runs/` as the only writable directory. Audio stays in memory and is
never written to disk.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `curl https://voice…` fails | DNS not propagated, or 80/443 closed. Caddy cannot get a certificate without port 80. |
| Call connects, silence both ways | The websocket never reached us. Check the record is grey-cloud, and that `VOICE_WS_PUBLIC_URL` is `wss://` with no port. |
| Dial fails with an unhelpful error | Destination country not enabled under **Voice** geo permissions. Messaging geo permissions is a different setting. |
| A recorded notice before the call | Twilio trial. Verify the number, or upgrade. |
| Agent responds slower than feels natural | Deliberate at `ENDPOINTING_SENSITIVITY=0.25`. Note it in the free-text score rather than treating it as a fault. |
