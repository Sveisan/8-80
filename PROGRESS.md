# PROGRESS

**Milestone 0a — done. Stopped for you.**

## Waiting on you

1. **Rewrite SCRIPT.md.** That is the whole ask. My draft will read like a
   generated version of this, because it is one.
2. **Pick the variants.** Three of the "I did nothing" turn (§3 A/B/C) and three
   closing questions (§7 A/B/C). Pick one of each, or rewrite both.
   My picks if you want a default: `nothing.b` (two doors) and `close.q.b`
   ("anything you didn't say?").
3. **One check:** you asked for three variants of "the closing question". I read that
   as the last question of the call and wrote three of those. If you meant the
   commitment ask (§6 `next.ask`), say so and I'll draft three of those instead.

Nothing else is blocked on you. Nothing has been built yet.

## Done

- SCRIPT.md — full mentor side of the call, as prose.
  Opening + disclosure, last week's commitment, the "I did nothing" turn (3 variants),
  the 8&80 read without naming it, the one thing for next week, the close
  (3 closing questions), time-limit courtesy lines, silence and repair behaviour,
  what the mentor never says.
- DECISIONS.md started.
- Repo initialised, clean history, .gitignore.

## Next, once you've rewritten the script

**Milestone 0b — a call you can hear.** Thinnest possible thing that rings your phone
and holds a conversation from SCRIPT.md. Grok Voice Think Fast 2.0 behind a
provider-agnostic adapter from the first commit, telephony behind another. Then the
8-turn stress test as a repeatable command, scoring prompt, and per-call metrics
(time-to-first-audio, endpoint latency, false interruptions, cost).

To start it I will need, in env vars, not in chat:
- xAI / Grok API key
- Telnyx API key + a +47 number (or the go-ahead to use a temporary non-Norwegian
  number just to hear a call sooner — the fixed +47 number matters for real users,
  not for a test call to you)
- Your mobile number to call

## Not started

Milestones 1–6. No code written. No vendor docs fetched yet — that happens when
integration code does, per your instruction not to code from memory.

## Notes

- §10 of the script (serious disclosure) is behaviour-only. Wording is deferred to
  Milestone 5 so you read every word before it can reach a user, as you asked.
- Norwegian +47 termination rates for Telnyx vs Twilio: still open, still yours in the
  cost model. I pull those at Milestone 0b/3 when the telephony adapter is real.
