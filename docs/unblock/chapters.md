# Unblock — chapters

Design edition, 8 November 2026. One chapter per month of the subscription, twelve in a year. A chapter has a **picture** (an analogy), a **milestone** (what the caller leaves the month with, in their own words), up to three ordered **themes** and a **close**. The caller chooses 1 to 8 calls a month; the last call of the month is always the close. Chapter 1 is the original arc in [weekly-script](weekly-script.md); its wording does not change.

The single source of truth is [`services/voice/src/unblock/chapters.ts`](../../services/voice/src/unblock/chapters.ts). Print it with `npm run unblock:chapters` (overview) or `npm run unblock:chapters -- 3 [calls]` (what the voice agent gets for each call of chapter 3, default four calls).

## The year

The picture is one long walk. It borrows nothing from any book; see [research](research.md).

| # | Chapter | Picture | Milestone — what the caller leaves the month with |
| --- | --- | --- | --- |
| 1 | The Wish | A map drawn long ago and folded away in a drawer | One wish in their words, what has kept it a wish, first steps, the light ledger started |
| 2 | The First Mile | New boots are stiff; the rubbing is the boots learning your feet | A step small enough to keep doing every week, and a month of it in their record |
| 3 | Companions | Some people carry water, some point the way, some add weight | One person — or group or community — who knows about the wish, and one clear thing asked for |
| 4 | Making Room | A pack only holds so much | One thing set down or made smaller — only if it was theirs to set down |
| 5 | Losing the Trail | The path disappears for a stretch; that is part of the route | One setback looked at plainly, and a way back they chose |
| 6 | The Well | Halfway: rest, drink, look back before looking ahead | A halfway account, and whether the wish still fits |
| 7 | The Craft | Learning the trade of the road | One skill practised on purpose, and someone or something to learn from |
| 8 | Open Ground | The road leaves the trees; you can be seen | One visible act — shown, sent, asked or said out loud |
| 9 | Reading the Weather | When to push on, wait or take shelter | Their own signals for "on course" and "slow down" |
| 10 | The View Back | From high up, the whole road behind you | What these months gave them that wasn't the plan |
| 11 | Passing It On | A marker at a confusing turn for the next traveller | One thing passed on to someone with a wish of their own |
| 12 | Home by a New Road | Back where you started, and it looks different | The year read back, and their own choice: carry on, rest, or a new wish |

The arc of the year mirrors the seven ideas in [articulations](articulations.md): wanting (1), moving (2–4), the hard stretch (5), looking back (6, 10), getting better and being seen (7–9), and home (12).

**After chapter 12** the subscription continues at chapter 2 with a year counter: month 13 is chapter 2 of year 2, month 23 is chapter 12 of year 2, month 24 is chapter 2 of year 3. Chapter 1 is the first-time arc and is not repeated. The account shows "Year N" from year 2. In a later year's chapter 12 the year read-back is drawn from that year only.

## Calls in a month

| Calls | The month |
| --- | --- |
| 1 | the close only |
| 2 | theme 1, close |
| 3 | themes 1 and 3, close |
| 4 | themes 1, 2, 3, close (the original shape) |
| 5–8 | themes 1, 2, 3, then open calls, close |

An **open call** has no new theme: the last step → what is alive right now → the next step. The close is always the last call, whatever the number, and the theme text the guide receives (`chapter_theme`) says which it is. `callPlan(n)` in `chapters.ts` is the mapping.

The close reads back up to five of the chapter's ledger entries, asks the theme question, then offers **the chapter's picture as a summary of the caller's own month**: built only from `month_words` (their saved steps, outcomes, moments and blocks) and what they say in the call, never inventing a fact or embellishing, and dropped if it does not fit. The picture is also said once near the start of the chapter's first call. The sign-off that follows is personal and contextual (see the [README](README.md)).

## Rules every chapter keeps

- **Same call shape.** Every call: last step → the call's theme → next step. The close replaces the next step with the ledger read-back, the theme question, the picture as a summary, a closing reflection and the sign-off.
- **Milestones are not scores.** The milestone is what the account shows *if the caller said it*. The guide never says "you reached" or "you missed" a milestone, never counts, never compares months.
- **The caller leads.** If their week goes elsewhere, the theme yields. The wish may change in any chapter; chapters 6 and 12 ask directly. A wish may be reworded only in a call whose theme says so (`saves: 'wish'` or `revisesWish`) or in an open call, never in the close.
- **No new machinery.** A chapter call saves with an existing `capture_unblock` command (`step`, `block`, `light`, `wish`, `closing`) or saves nothing (`reflect`). Tests enforce this.
- **Same boundaries as the rest of Unblock:** no author or book, no destiny words, no outcome promises, real limits stay real, safety holds stop everything.

## How to add or change a chapter

1. Edit the entry in `CHAPTERS` in `chapters.ts` (a chapter is `themes` (three) plus `close`).
2. Add or update its row in the table above — the test checks every chapter is listed.
3. Run `npm run unblock:chapters -- <n> [calls]` and read it aloud.
4. Run the tests: `node --import tsx --test services/voice/test/unblock-chapters.test.ts`.
5. Set `status: 'approved'` only after owner review. Only approved chapters may be offered to callers.

Chapter 1 is pinned to the weekly script: if you rewrite a theme or close question in `weekly-script.md`, update chapter 1 to match or the test fails.

## How it is wired (implemented)

| Where | How |
| --- | --- |
| Programme | `month` (chapter sequence), `chapterCalls` (frozen at chapter start), `chapterStartedAt`; `weeksHeld` counts held calls in the current chapter. The close held completes the chapter, not the programme. The programme completes only when the subscription ends |
| Chapter clock | The chapter is the subscription's billing month, anchored at first activation (`anchor_at`). The next chapter starts with the next billing month, using the calls per month chosen meanwhile. A late close is offered first, even in the next month |
| Data | Steps, blocks, ledger entries and closings carry `month`; closed chapters' closings are archived in `closings`. Columns `chapter`, `year`, `chapter_started_at`, `calls_per_month`, `pending_calls_per_month` mirror the state (migration 0031) |
| Voice context | `unblock_context` carries `chapter` (number, year, title, `calls_this_month`, `call`), `chapter_theme`, `is_close`, `sign_off` {mode, next_chapter_title, next_call_local, next_call_weekday} and, in the close, `month_words`. No new Speechify variables are needed |
| Scripts | The weekly script follows `chapter_theme`; chapter 1 keeps its own wording. The close and sign-off are in the CLOSE section |
| Account | This month's chapter, one closing per chapter with its milestone, and steps labelled by chapter |

## Open owner decisions

| Decision | Status |
| --- | --- |
| Pricing | Settled: monthly subscription, flat price, 1–8 calls. The next chapter is offered only in the private account, never in a call |
| Continue by default? | Yes: the subscription renews until the caller cancels; each close says what comes next, nothing about buying |
| Pause between chapters | Pause is calls-only and any length; billing continues. The next chapter continues from the caller's current wish and ledger |
| Order | Fixed 1–12, then 2–12 again with a year counter. Letting callers pick a chapter later is possible because each one stands alone |
| Norwegian | Needs its own pack, like the rest of the module |
