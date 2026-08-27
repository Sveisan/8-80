# PROGRESS

**Milestone 0a — done, plus your corrections. Stopped. Not starting 0b.**

## Read this before you push your rewrite

**SCRIPT.md changed after your last message — pull before you push.** I added the three
commitment-ask variants and marked `nothing.c` as the stress-test default, both in §3 and
§6. If you rewrote from the earlier version, `git pull --rebase` and reconcile §6; nothing
else in the file moved.

## Your .env question — confirmed

- `.env` is gitignored (`.gitignore:2`), along with every `.env.*`.
- `.env.example` is explicitly un-ignored and is committed. Verified with
  `git check-ignore` and `git add --dry-run`, not by eye.
- Every key documented, **no values** — checked mechanically, every line after `=` is
  empty. Defaults are described in comments rather than set.
- Keys are grouped by the milestone that first needs them. Everything past 0b is
  documented ahead of use so the shape is visible; nothing reads it yet.
- One thing worth seeing: the encryption master key is deliberately **not** an env var.
  Only `ENCRYPTION_MASTER_KEY_REF` — a pointer into the secret manager — appears.

## Done this session

- **Three variants of the commitment ask** (SCRIPT.md §6). A forces a choice, B removes
  the audience — *"there's nobody here to be impressive for"* — C asks for a prediction
  rather than a promise, plus an optional calibration probe. B is my default; C is the
  one to switch a chronic over-promiser to.
- **Closing-question variants kept.** Both sets now live side by side.
- **`nothing.c` marked stress-test default**, with your reasoning written into the file
  so it doesn't get "improved" later.
- **ARCHITECTURE.md written**, including caller identity as you corrected it.
- **DECISIONS.md updated** — the caller-identity row rewritten, plus a full section on
  the resolution and the number-provisioning constraints.
- **.env.example committed.**

## Waiting on you

1. **Your SCRIPT.md rewrite.** Nothing starts until it lands.
2. Nothing else is blocked.

## Next — Milestone 0b, on your signal

Thinnest thing that rings your phone and holds a conversation from SCRIPT.md. Voice
adapter and telephony adapter from the first commit. Then the 8-turn stress test as a
repeatable command, the scoring prompt, and per-call metrics.

Noted: temporary non-Norwegian test number is fine, dev keys, call to yourself. Number
provisioning constraints are recorded for when we buy the real one.

What I'll need in `.env` when you say go: `XAI_API_KEY`, `TELNYX_API_KEY`,
`TELNYX_CONNECTION_ID`, `TELNYX_PUBLIC_KEY`, `OUTBOUND_CALLER_NUMBER` (the temporary
one), `STRESS_TEST_TARGET_NUMBER` (your mobile).

## Notes

- §10 of the script — serious disclosure — is still behaviour-only. Wording at
  Milestone 5, for your review before it can reach anyone.
- Norwegian +47 termination rates, Telnyx vs Twilio: still open. Pulled when the
  telephony adapter is real.
- No vendor docs fetched yet. That happens when integration code does, not from memory.
