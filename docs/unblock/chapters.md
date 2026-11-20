# Unblock — chapters

Design edition, 8 November 2026. One chapter per month of the subscription, twelve in a year. A chapter has a **picture** (an analogy), a **milestone** (what the caller leaves the month with, in their own words), up to three ordered **themes** and a **close**. The caller chooses 1 to 8 calls a month; the last call of the month is always the close. Chapter 1 is the original arc in [weekly-script](weekly-script.md); its questions stay in sync with that script.

Owner content review, 15 November 2026: **Chapter 1 is approved** in the local review source, including the softer risk question, the brief conversational arrival before personal questions, Unblock-only spoken identification unless asked about 8&80, and “even just for a minute”. This records content approval; safety procedure, staffed timing, provider verification and production activation remain separate decisions. The review changes have not yet been deployed or published to the voice provider.

Owner content review, 17 November 2026: **Chapter 2 is approved** with the rolling next-seven-days prompt, the comma before “even in a bad week”, the plain obstacle question, the combined moment question and explicit acknowledgement of the caller's check-in answer before proceeding. Shared script edits are part of the local review source and await the final script release.

Owner content review, 17 November 2026: **Chapter 3 is approved** with the contextual support question, clearer sharing follow-up, colleague example, simplified read-back introduction, rolling last-30-days reflection and optional step timing. The ordinary closing context uses that actual rolling period and each chapter's own closing questions. Operational approvals and provider publication remain pending.

Owner content review, 17 November 2026: **Chapter 4 is approved** with the plain central question and introduction, self-clarity about trying the wish, “put it to the side” / “set aside”, and next-step prompts that name the caller's actual wish or chosen focus. The shared script release and operational approvals are still pending.

Owner content review, 17 November 2026: **Chapter 5 is approved** with its original trail/fog picture retained and its clearer takeaway: understanding what got in the way and choosing a small step toward the wish. Its closing question follows the caller's actual reflection period, as refined below on 18 November. This is content approval in the local review source, pending the shared script release and operational approvals.

Owner content review, 17 November 2026: **Chapter 6 is approved** as a pause along the way, without inferring 50% progress from its chapter number. The central question, picture, takeaway and close reflect that framing. The contextual difficult-day response bank and its short light-call variant are included in the shared script review. Provider publication, voice verification and operational activation remain pending.

Owner content review, 18 November 2026: **Chapter 7 is approved** with its everyday recipe picture, references to the caller's actual aim instead of unexplained “wish” wording, and Practice questions that ask what they noticed and what they would change next. The review source has not yet been deployed or published to the voice provider.

Owner's Chapter 8 annotation, 18 November 2026: the shared close must match the caller's actual time in the programme. Use “since we started” before 30 local dates, then “the last 30 days”; if the start is unknown, say “recently”. Opening calls have no historical read-back; ordinary regular calls retain “since we last spoke”. Chapter 2, 5 and 7 closing questions no longer assume a full 30-day history. This authorised shared wording/runtime correction is included in the subsequent approval below.

Owner content review, 18 November 2026: **Chapter 8 is approved** with the caller-choice visibility picture and the age-aware closing wording and matching reflection records. This includes the related Chapter 2, 5 and 7 closing-question adjustments. Provider publication, deployment and operational approvals remain pending.

Chapter 9 annotations, 18 November 2026: replace the walking/weather picture with someone who grew up in a very rainy town and recognises familiar signs of possible rain. Shared opening/regular-call arrival guidance asks one light follow-up only when the caller seems very engaged. Action invitations vary with the conversation and chapter, preserve the actual-aim context and avoid asking again when the caller already chose an action. Chapter 9 remains draft; these are authorised edits, not full chapter approval. The review source has not been published or deployed.

Chapter 9 follow-up annotations, 19 November 2026: make the signs concrete — a sudden shift in light or small breezes of cooler wind. Familiar rain may not bother the person much; if they plan to stay outside for a while, they adapt by bringing an umbrella or putting on a raincoat. This replaces the earlier head-out/wait/take-a-coat ending. Chapter 9 remains draft; no provider publication or deployment was performed.

Further owner wording refinement, 19 November 2026: “they're probably used to it” adds the requested light humour; the final sentence now says they “adapt and plan accordingly by bringing an umbrella or putting on a raincoat”. Chapter 9 remains draft.

Owner content review, 19 November 2026: **Chapter 9 is approved** with the rainy-town picture, concrete light/cooler-wind signs, “probably” and adaptation/planning ending, engagement-dependent check-in follow-up and varied action invitations. The preceding draft notes describe the stages before this explicit decision. This records local content approval; provider publication, deployment and operational approvals remain pending.

Owner content review, 19 November 2026: **Chapter 10, The View Back, is approved as written**, including its road-behind picture, possible takeaway, central question, three themes and From here close within the presented shared conversation flow. No chapter-specific wording was changed when recording this approval. There are twelve chapters in the current programme. This is local content approval; provider publication, deployment and operational approvals remain pending.

Owner content review, 19 November 2026: **Chapter 11, Passing It On, is approved** following the owner's “Looks good. Proceed to chapter 12” response to its full presentation. Its wording and shared conversation flow are unchanged. This is local content approval; provider publication, deployment and operational approvals remain pending.

Owner content review, 19 November 2026: **Chapter 12, Home by a New Road, is approved as written**, including its return-home picture, three themes, new-wish follow-up, programme-year read-back and Home close within the presented shared conversation flow. All twelve chapters are now owner-approved in the local review source. No chapter-specific wording was changed to record this decision. Final light-call timing and matching wording, provider publication, deployment, real-call verification and operational launch approvals remain pending; see [launch approval](launch-approval.md).

The single source of truth is [`services/voice/src/unblock/chapters.ts`](../../services/voice/src/unblock/chapters.ts). Print it with `npm run unblock:chapters` (overview) or `npm run unblock:chapters -- 3 [calls]` (what the voice agent gets for each call of chapter 3, default four calls).

## The year

The pictures use familiar situations to make each chapter easier to understand. Walking images remain where they fit; a chapter can use another everyday example. See [research](research.md) for the original boundaries.

| # | Chapter | Picture | Milestone — what the caller leaves the month with |
| --- | --- | --- | --- |
| 1 | The Wish | A map drawn long ago and folded away in a drawer | One wish in their words, what has kept it a wish, first steps, the light ledger started |
| 2 | The First Mile | New boots are stiff; the rubbing is the boots learning your feet | A step small enough to keep doing every week, and a month of it in their record |
| 3 | Companions | Some people carry water, some point the way, some add weight | One person — or group or community — who knows about the wish, and one clear thing asked for |
| 4 | Making Room | Decide for yourself that the wish is worth trying, then look for one small practical change | One thing set aside or made smaller — chosen by the caller, and only if it was theirs to set aside |
| 5 | Losing the Trail | The path disappears for a stretch; that is part of the route | What got in the way, and one small step they chose toward their wish |
| 6 | The Well | A place to pause along the road, wherever the caller is with the wish | What has changed, what to keep, and whether the wish still fits |
| 7 | The Craft | Trying a recipe shows what to adjust on the next attempt | One useful skill, a learning source, and a clear next thing to try or change |
| 8 | Open Ground | The road leaves the trees; the caller chooses whether and how to be seen | One visible act — shown, sent, asked or said out loud |
| 9 | Reading the Weather | Growing up in a rainy town and recognising familiar weather signs | Their own signals for "on course" and "slow down" |
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

The ordinary close reads back up to five ledger entries **since the caller started, capped at the last 30 caller-local dates**, independent of calendar/billing boundaries, and asks the selected chapter's own closing question and follow-ups. If the start is unknown, use the recent entries without claiming a full month. The year close retains its programme-year read-back. It then offers **the chapter's picture as a summary of the caller's reflection period**: built only from `month_words` (their saved steps, outcomes, moments and blocks from that period) and what they say in the call, never inventing a fact or embellishing, and dropped if it does not fit. `reflection_period` supplies the actual spoken period label. The picture is also said once near the start of the chapter's first call. The sign-off that follows is personal and contextual (see the [README](README.md)). Step timing is optional; an exact day/time is never required to confirm a chosen step.

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
| Voice context | `unblock_context` carries `chapter` (number, year, title, `calls_this_month`, `call`), `chapter_theme`, `is_close`, `sign_off` {mode, next_chapter_title, next_call_local, next_call_weekday} and, in the close, `reflection_period` and `month_words`. No new Speechify variables are needed |
| Scripts | The weekly script follows `chapter_theme`; chapter 1 keeps its own wording. The close and sign-off are in the CLOSE section |
| Account | This month's chapter, one closing per chapter with its milestone, and steps labelled by chapter |

## Open owner decisions

| Decision | Status |
| --- | --- |
| Pricing | Settled: monthly subscription, flat price, 1–4 calls. The next chapter is offered only in the private account, never in a call |
| Continue by default? | Yes: the subscription renews until the caller cancels; each close says what comes next, nothing about buying |
| Pause between chapters | Pause is calls-only and any length; billing continues. The next chapter continues from the caller's current wish and ledger |
| Order | Fixed 1–12, then 2–12 again with a year counter. Letting callers pick a chapter later is possible because each one stands alone |
| Norwegian | Needs its own pack, like the rest of the module |
