# Call incidents

Why the rules in the mentor's prompt exist. The prompt states each rule once, as an
instruction; the story behind it lives here, because the model reads the prompt on every
turn and the person editing it is the one who needs the history.

Add a row when a real call produces a rule. Run the call through
`services/voice/src/call/scorecard-cli.ts` first — most rows below have a check there.

| Date | Call | What happened | Rule it produced |
|---|---|---|---|
| 2026-09-06 | second full call | Greeting, frame and first question in one 11-second breath | Stages are separate turns; a question ends the turn |
| 2026-09-20 | conv_01m309ah… | Heard "Cancer." in reply to the greeting and asked about it | Before the disclosure, answer only yes or no; re-ask on anything else |
| 2026-09-20 | conv_01m309ah… | "Which day?" then two minutes of silence until "Hello?" | After ~10s, "Still with me?", then the same question shorter |
| 2026-09-20 | conv_01m309ah… | "That one missed" said to a caller who had misheard | No line acknowledges a miss; repair ladder for confusion |
| 2026-09-27 | conv_01m3h827… | Three words about an apartment, then "I've got the shape of it"; "family" read back and dropped | First call: eight, eighty, this year, the map; curious, not auditing |
| 2026-09-27 | conv_01m3h827… | Email spelled letter by letter from a Norwegian name, failed | Never ask for an email on a call |
| 2026-09-27 | conv_01m3h827… | Caller asked three times who hangs up; "I can't discuss the call setup" | Close ends with `end_call`; "I'll hang up now" |
| 2026-09-27 | conv_01m3h827… | Recap email carried half the call as the commitment | Read-back anchored on the nearest "Right"; fixed closing words |
| 2026-09-27 | conv_01m3hk90… | Called monotone | Warm and audible; feeling is not praise |
| 2026-09-27 | conv_01m3hk90… | "Which games?" → "Can't remember" | Follow-ups move to the present, never retrieve a childhood detail |
| 2026-09-27 | conv_01m3hk90… | Misheard fragment became "a side project of parents learning", said back three times | Never say a name back on first hearing |
| 2026-09-27 | conv_01m3hk90… | One question rephrased four times | Repair ladder: shorter, then a choice, then drop it |
| 2026-09-27 | conv_01m3hk90… | Jokes at eight, comedy at eighty, unremarked | One noticed connection per call, as a check |
| 2026-09-27 | conv_01m3hk90… | Four attempts to pin the commitment, closed on "Will you?" | One push, then write down what is there |
| 2026-09-30 | conv_01m3rw01… | A first-call rehearsal served the returning prompt; "My mistake" and carried on | If they say you have not spoken, start properly and use nothing stored |
| 2026-09-30 | conv_01m3rw01… | Eleven questions about a front end until "we're going way too deep" | Three non-question moves after two follow-ups; four work questions per call |
| 2026-09-30 | conv_01m3rw01… | "Bet on yourself" misunderstood on a second call running | Plain one-thing question |
| 2026-09-30 | conv_01m3rw01… | A new question 19s after an unanswered one | After silence, the same question — never a different one |
| 2026-09-30 | conv_01m3sbkx… | Laughter at eight and a career making people laugh at eighty, read back in one sentence, unremarked — third call running | Noticing is required when the same thing is at both ends, and placed after the map |
| 2026-09-30 | conv_01m3sbkx… | "Just pick one" met with "I'd be guessing"; caller disengaged | Offer one of their own items for correction |
| 2026-09-30 | conv_01m3sbkx… | Four attempts to pin a day on "work harder" | No day for a direction; never more than two attempts |
| 2026-09-30 | conv_01m3sbkx… | Close lines spoken after `end_call` fired; "Are we done?" before it began | Close is three turns in order; nothing after `end_call` |
| 2026-09-30 | conv_01m3sbkx… | Whole map re-read to change three words | Say back only the corrected part (`read.first.fix`) |
