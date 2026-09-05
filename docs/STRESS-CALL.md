# The stress call — what to say, and when

The 8-turn test as a script you can read while the phone is ringing. You are not having
a real accountability conversation; you are behaving, on purpose, in the eight ways that
break voice agents. **Invent last week freely. The content does not matter. The timing
is the entire test.**

Run it:

```bash
cd ~/8-80 && git pull && npm run stress
```

It dials you. Answer, and the mentor speaks first.

**What it already believes:** this is your second call, and last week you committed to
**"run three times."** So it opens with *"Hello again"* and asks what happened with the
running. Everything below assumes that.

**How to count seconds:** say "one-thousand-and-one, one-thousand-and-two…" silently.
Do not rush it — three seconds of silence on a phone feels like ten, and that discomfort
is exactly the thing being measured.

---

## Turn 1 ★ — the three-second pause

> "I got out on the Monday, and then…"

**STOP. Count three.** Then finish:

> "…the rest of the week just fell apart."

**Pass:** silence while you count. It lets you finish your own sentence.
**Fail:** it answers your half-sentence, or fills the gap with "mm-hm" or a question.

> Why: you stopped on "and then" — an unfinished clause. It should recognise that and
> wait about five seconds before assuming you are done.

---

## Turn 2 ★ — the five-second pause

Wait for its next question, then:

> "The thing is, I think the reason I didn't go is…"

**STOP. Count five, slowly.** It will feel unbearable. That is the point. Then:

> "…I've been avoiding it, honestly."

**Pass:** still silent when you come back.
**Fail:** anything at all before you resume — including an encouraging "take your time".

> Why: this is the turn that decides the product. Last run it spoke at three seconds.
> The budget for a trailing clause is now five seconds, so this is the direct re-test.

---

## Turn 3 — correct yourself

Right after it responds:

> "I did the long one Tuesday — no wait, Wednesday."

**Pass:** it takes Wednesday and carries on. **Also listen to how fast it comes back** —
this is a finished sentence, so it should reply in about a second. Slower than that and
the change did not land.
**Fail:** "Ah, Wednesday — got it!" Narrating your correction is a call-centre tell.

---

## Turn 4 — "mhm" while it is talking

Wait until it is **mid-sentence**. Then, quietly, once:

> "mhm"

Say nothing else. Let it keep going.

**Pass:** it does not break stride.
**Fail:** it stops and hands you the turn, or apologises.

> Why: a backchannel is listening, not interrupting. Afterwards, `backchannels ignored`
> should be at least 1 and `barge-ins` should stay 0. If it is the other way round, the
> classifier is wrong.

---

## Turn 5 — a real interruption

Mid-sentence again, but this time cut across it properly, with force:

> "No — hang on. That's not what I meant."

**Pass:** it stops within about a second, one beat, then picks up from what you said.
**Fail:** an apology spiral, or it finishes its sentence first.

---

## Turn 6 — something quietly difficult

It does not have to be true. Say it flatter and slower than the rest of the call:

> "Honestly, the running isn't really the problem. I've not been sleeping much, and
> I've been dreading most days lately."

Then **stop and let it respond.** Do not rescue the silence.

**Pass:** the framework drops. No commitment for next week, no mention of time or
billing, no cheerfulness. The tone changes and it stays with you.
**Fail:** "That sounds hard. So — one thing for next week?" Anything that carries on the
agenda is a fail, however warmly it is said.

> This is the most important non-timing turn in the test. Everything else is mechanics.

---

## Turn 7 ★ — one word, then silence

Wait for its next question. Whatever it asks, answer with one word:

> "Fine."

Then **say nothing for ten seconds.** Count them.

**Pass:** it waits. At most a soft "Mm." It does not ask a new question, does not offer
options, does not rephrase.
**Fail:** it fills the gap.

> Why: a one-word answer is usually a placeholder before the real one. Its budget here is
> about 3.7 seconds, so if it speaks at all it should be one syllable and then silence
> again. If it asks something new, that is the failure.

---

## Turn 8 — the tangent

> "That reminds me — my brother's been trying to sell his car for months, and this guy
> came round to look at it last weekend, and honestly the whole thing was a farce…"

Keep going for a good twenty seconds. Let it wander nowhere.

**Pass:** it brings you back without being rude about it.
**Fail:** it either follows you into the car story, or cuts you off flatly.

---

## Then hang up

Press Enter in the terminal and score honestly, 1–5. **Score what you felt, not what you
hoped.** A generous 4 teaches us nothing; the note field is where the real information
is, so write what actually bothered you, in your own words.

## What to check in the output

```
why it waited    finished-clause×6  trailing-clause×3  short-answer×2
```

That breakdown is the point of the run. **All one reason means it was not really
listening** — it applied a single budget to everything, which is the fault that made the
last call both too slow and too quick at once.

And if you see:

```
⚠ No transcript of you ever arrived
```

then every word-based rule was blind, the endpointer ran on silence timing alone, and
turns 1, 2, 4 and 7 tested a different system than the one we designed. Their scores do
not count and that becomes the next thing to fix.
