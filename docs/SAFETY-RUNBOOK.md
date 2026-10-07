# When a call is flagged

8&80 is coaching, not crisis support. The job here is to read, then send people on
to those who do this properly — not to counsel them ourselves.

## 1. You get a text

- **Tier 1** (same evening): suicide, self-harm, not wanting to live, or the mentor
  said its crisis line. Look tonight.
- **Tier 2** (daily digest): abuse, violence, not feeling safe, hopelessness. Look
  within a day.

Their next call is already on hold. Nothing goes out to them until you act.

## 2. Read it

On the server: `npm run enrol -- --review`. It lists each flagged call with its
Speechify conversation id. Read the whole transcript in the Speechify console. The
patterns flag wide on purpose — many will be false alarms.

## 3. Decide — one of three

| What you read | Do |
|---|---|
| Nothing serious (a figure of speech, a film, a past that is past) | `npm run enrol -- --phone +47… --release` |
| Something real, not happening right now | `npm run enrol -- --phone +47… --check-in` — or `--check-in abuse` if it was violence, abuse or not feeling safe at home |
| **Danger right now** — a plan, a means, a time, or someone hurting them now | **Ring 113 first.** Give the number and what was said. Then `--check-in`. |

`--check-in` sends the fixed text from SCRIPT.md §10 (Mental Helse 116 123 and 113;
or 116 006 and 113 for abuse, with the line unnamed) and keeps their calls paused.
The text says nothing about why.

If they might share the phone with the person they talked about, think twice before
any text. A release is not wrong when the risk is the text itself.

## 4. If they write back

You get a text saying someone replied — never what they wrote. Read it in the Twilio
console (Monitor → Messaging logs). Answer **once**, short, in your own words:

    npm run enrol -- --phone +47… --reply "Thank you for writing back. I read it. Your calls are paused — just say when you want them back."

Do not assess, advise or promise. If the reply says they are in danger now: ring 113.
If they want calls back: `--release`. If they say stop: their STOP already did it.

## 5. Repeats

`--review` shows how many times a caller has been flagged.

- **Second flag**: check in again; do not release on the same day.
- **Third flag** (marked REPEAT): stop the calls. Leave them held, send the check-in,
  and do not restart. A weekly AI call is not the right thing for them right now, and
  saying so kindly is part of the job.

## 6. When you are away

Set `OPERATOR_PHONE_BACKUP` in the server `.env` to the stand-in's number. They get
every alert too, and need server access to run the commands above.
