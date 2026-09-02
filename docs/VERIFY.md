# VERIFY — before the first live call

The build environment could not reach any vendor documentation host
(`docs.x.ai`, `docs.telnyx.com`, `developers.telnyx.com`, `platform.openai.com` are all
blocked by the network egress policy). So the wire details in the two adapters were taken
from evidence rather than from memory:

| Source | What it gave us |
|---|---|
| `@livekit/agents-plugin-xai` 1.7.1 (published 2026-08-27) | Base URL, default turn-detection shape, default voice, the fact that it extends the OpenAI Realtime session directly |
| `@mastra/voice-xai-realtime` 0.2.7 (published 2026-08-14) | Realtime event type strings, `XAISessionConfig` / `XAITurnDetection` / `XAIAudioFormat` types, audio format values |
| `telnyx` npm SDK 7.17.0 (official) | `calls.dial` params, `stream_*` fields, streaming codec and mode enums |

Two shipping clients agreeing is good evidence. It is not the documentation. **Check the
list below against the real docs on a machine that can reach them, before the first call
to a real person.** Everything here is confined to two files —
`adapters/voice/grok.ts` and `adapters/telephony/telnyx.ts`.

## xAI / Grok

- [ ] `wss://api.x.ai/v1/realtime?model=…` is the current endpoint, and `Authorization: Bearer` is accepted (ephemeral tokens are the documented alternative).
- [ ] The model id is `grok-voice-think-fast-2.0`. Both client libraries still default to `1.0`; 2.0 is what we want and what `XAI_VOICE_MODEL` is set to. **Confirm the exact 2.0 id string.**
- [ ] `session.update` accepts `{ instructions, voice, turn_detection, audio: { input: { format }, output: { format } } }`.
- [ ] `turn_detection: null` really disables provider turn-taking, and the session then produces a response only on an explicit `response.create`. **This one matters most — the whole local endpointing design rests on it.**
- [ ] `audio/pcmu` at 8000 Hz is accepted for both input and output, so no transcoding is needed.
- [ ] Server event names: we handle both `response.output_audio.delta` and `response.audio.delta` (and the matching `.done` / transcript variants) because both appear across current clients. Confirm which 2.0 emits.
- [ ] Confirm the post-cancel behaviour. LiveKit explicitly discards a response xAI "left in flight" after an interrupt; `grok.ts` mirrors that. If 2.0 fixed it, the workaround is harmless but should be noted.
- [ ] Voice name: `eve` (options seen: eve, ara, rex, sal, leo).
- [ ] **Zero-retention / no-training must be turned on explicitly** and recorded in DECISIONS.md with the date and where it was set.

## Telnyx

- [ ] `calls.dial` with `stream_url`, `stream_track: 'inbound_track'`, `stream_bidirectional_mode: 'rtp'`, `stream_bidirectional_codec: 'PCMU'` is the right combination for two-way audio over our own websocket.
- [ ] `timeout_secs` is the ring duration (we set 25) and produces a `no_answer` hangup rather than rolling to voicemail.
- [ ] `answering_machine_detection: 'detect'` fires early enough for us to hang up. **We must never leave a voicemail.**
- [ ] Media frame shape on our socket: `{ event: 'media', media: { payload: <base64> } }`, with `connected` / `start` / `stop` / `error` / `mark` / `dtmf` as the other events, and the outbound frame needs `stream_id`.
- [ ] Current **Norwegian (+47) mobile termination rate**, and the Twilio equivalent. Still the last input in the cost model running on US reference prices.

## What would unblock verification from the build environment

The egress policy blocks `api.x.ai`, `api.telnyx.com` and every tunnel service, so no
API key placed here can be used — the container cannot reach either vendor. Do not put
credentials in an environment that cannot spend them.

Allowing `api.x.ai`, `docs.x.ai`, `api.telnyx.com` and `developers.telnyx.com` outbound
would let a session open a real Grok realtime connection and confirm the session config
and the `turn_detection: null` behaviour — most of the voice adapter — without a phone
existing. Inbound is still impossible, so the call itself always has to run from a
machine Telnyx can reach.

## Twilio (fallback, and the fastest route to a first call)

Params from the official `twilio` npm SDK types (v6.1.0). The media frame shape is not
from documentation.

- [ ] `<Connect><Stream url="wss://…"/></Connect>` passed as inline `twiml` on
      `calls.create` gives two-way audio. Inline TwiML means Twilio never fetches
      anything from us — only the media socket needs to be reachable.
- [ ] Media frames: `connected` / `start` / `media` / `stop` / `mark`, with base64 mu-law
      8 kHz in `media.payload`, and outbound frames needing `streamSid` from `start`.
- [ ] `machineDetection: 'Enable'` fires early enough to hang up. **Never leave a
      voicemail.**
- [ ] `timeout` is the ring duration in seconds.
- [ ] **Trial accounts**: outbound calls only reach verified numbers, and a trial notice
      plays before the call connects. Verify the destination mobile in the console first,
      and expect the preamble — it is not our audio path misbehaving.

## Before any call to anyone who is not Eirik

- [ ] The media websocket subdomain is DNS-only in Cloudflare, not proxied.
- [ ] Zero-retention confirmed with every vendor in the path.
- [ ] SCRIPT.md §10 wording written and reviewed (Milestone 5).
