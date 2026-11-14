# Optional Jev quality review

Jev is an opt-in post-call reviewer for unnecessary repeated questions and unsupported recap claims. It is advisory, outside the live call/webhook path, and disabled by default. It does not create or change commitments, consent, memory, recaps, bookings or messages. A provider failure cannot block the existing local quality checks.

Run local checks on a private review packet:

```sh
npm run quality:jev -- --file /private/path/review.json
```

The packet contains only the conversation to review, a candidate recap, and optional independently verified facts:

```json
{
  "conversation": [
    {"speaker": "agent", "text": "What did you choose?"},
    {"speaker": "caller", "text": "Ten minutes of reading on Sunday."}
  ],
  "candidateRecap": "You chose ten minutes of reading on Sunday.",
  "trustedContext": {}
}
```

To explicitly send this selected packet to TypeSafe, add `--send-to-jev`. Supply `TYPESAFE_API_KEY` through the environment or a private environment file:

```sh
npm run quality:jev -- --file /private/path/review.json --send-to-jev --key-file "$HOME/.config/8and80/jev.env"
```

Only `TYPESAFE_API_KEY` is selected from that file; OpenAI/Anthropic keys are not sent to Jev. The OpenAI API was used for the independent benchmark labels, not for this runtime reviewer. The existing `quality:weekly` command remains local and unchanged.

The command prints existing local counts plus Jev's allowlisted verdicts, never conversation text, recap wording, trusted facts, source paths, identifiers or credentials. Explicit opt-in sends conversation text, recap and trusted facts to TypeSafe; it does not redact words within them. Do not treat model-generated guesses as trusted context.

## Decisions and failure behavior

The pinned model is `jev-1.14.0`. The rubric and boundaries match the evaluated version:

- `flag`: probability at least 0.70; an issue for a person to investigate.
- `clear`: probability at most 0.30; no issue flagged for that check, not an overall quality/safety approval.
- `uncertain`: strictly between those boundaries; remains unresolved.
- `unavailable`: missing credentials, invalid/oversized input, provider error, malformed result, different model or timeout. Never counted as clear.

Disabled mode makes no request. Enabled mode makes at most one request, with a four-second deadline covering both connection and response body, a 64,000-byte request limit, a 16,384-byte response limit and no truncation or automatic retries. Failed review retains the local report and exits successfully; malformed source or arguments produce a fixed diagnostic and exit 1. Provider identifiers and arbitrary packet fields are omitted from requests. No endpoint/model override or automatic provider fallback exists.

This module must not be awaited from a live call, settlement or recap-delivery/webhook path. There is no automatic production activation, cron or external storage. Use explicit owner review to assess advice before changing conversation behavior.

## Evaluation on 14 November 2026

The frozen policy passed the predeclared gate for an opt-in advisory trial. Fifty fictional conversations, 518–591 words and 26–28 turns each, cover 25 paired story families: 40 English cases and 10 Norwegian cases. Ordinary target replies replaced explicit authoring cues such as “I already told you.” These paired, partially templated cases are not 50 independent users or recordings of real calls.

A separate stateless OpenAI `gpt-5.4-mini-2026-03-17` classified each full case without seeing author labels, author rationales, pair membership or Jev scores. It agreed with 48/50 author labels per task. Two disputed labels per task are excluded from the consensus metrics below and remain in the audit. This is independent AI review, not human annotation. Two unusable reviewer responses were retried once with identical inputs and parameters; 50 valid reviews came from 52 requests.

| Check | Agreed cases | True flags / positive cases | False flags | Uncertain | Coverage |
|---|---:|---:|---:|---:|---:|
| Repeated questions | 48 | 24 / 25 | 0 | 8 | 83.3% |
| Unsupported recaps | 48 | 25 / 25 | 0 | 1 | 97.9% |

Against **all original author labels**, repetition caught 24/25 with zero false flags and 82% coverage. Recaps caught 25/25 with **one false flag** and 96% coverage. That false flag is a disputed label and is excluded from the consensus table; it has not disappeared or been relabeled to fit Jev. Neither check confidently cleared an author-positive error. The existing exact-repeat candidate check caught only 1/25 repeated-question errors with one false candidate. The current recap composer uses confirmed structured fields; there is no equivalent generic semantic recap checker, and the deliberately corrupted candidates are not claimed to be actual composer outputs.

Jev's run used 86,990 input tokens, with estimated inference cost $0.003654 at the published rate. Median request latency was 218.6 ms and p95 289.4 ms at concurrency two. This excludes label review, engineering and human review. The balanced challenge set does not predict production precision, calibrated confidence, retention or revenue. Even a perfect 25/25 observed result does not establish a population guarantee. Keep the reviewer advisory and collect human feedback before expanding its role.

The full local audit is in the sibling workspace directory `audit/jev-long-validation-20261113-neutral/`: frozen dataset/protocol and hashes, actual model probabilities, independent labels and evidence, retry history, scoring code and report. The initial cue-bearing long run is preserved separately. `jev-rubric.ts` exactly reproduces the frozen question definitions.

References: [Jev API](https://docs.typesafe.ai/api/system-one), [Jev confidence](https://docs.typesafe.ai/confidence), [Jev pricing](https://help.typesafe.ai/articles/5187202169-how-much-does-jev-cost), [OpenAI model snapshot](https://developers.openai.com/api/docs/models/gpt-5.4-mini).
