# Unblock — chapters

Design edition, 8 November 2026. One chapter per month, twelve in a year. Each chapter is the same four-week shape the module already has, with its own **picture** (an analogy, said once) and its own **milestone** (what the caller leaves the month with, in their own words). Chapter 1 is the original arc in [weekly-script](weekly-script.md); nothing in it changes.

The single source of truth is [`services/voice/src/unblock/chapters.ts`](../../services/voice/src/unblock/chapters.ts). Print it with `npm run unblock:chapters` (overview) or `npm run unblock:chapters -- 3` (what the voice agent gets for each week of chapter 3).

## The year

The picture is one long walk. It borrows nothing from any book; see [research](research.md).

| # | Chapter | Picture | Milestone — what the caller leaves the month with |
| --- | --- | --- | --- |
| 1 | The Wish | A map drawn long ago and folded away in a drawer | One wish in their words, what has kept it a wish, first steps, the light ledger started |
| 2 | The First Mile | New boots are stiff; the rubbing is the boots learning your feet | A step small enough to keep doing every week, and a month of it in their record |
| 3 | Companions | Some people carry water, some point the way, some add weight | One person who knows about the wish, and one clear thing asked for |
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

## Rules every chapter keeps

- **Same call shape.** Every weekly call: last step → the chapter's theme for that week → next step. Week 4 is the chapter close: ledger read-back, the theme question, a closing reflection.
- **Milestones are not scores.** The milestone is what the account shows *if the caller said it*. The guide never says "you reached" or "you missed" a milestone, never counts, never compares months.
- **The picture is said once,** in week 1 of the chapter, and never explained or pushed.
- **The caller leads.** If their week goes elsewhere, the theme yields. The wish may change in any chapter; chapters 6 and 12 ask directly.
- **No new machinery.** A chapter week saves with an existing `capture_unblock` command (`step`, `block`, `light`, `wish`, `closing`) or saves nothing (`reflect`). Tests enforce this.
- **Same boundaries as the rest of Unblock:** no author or book, no destiny words, no outcome promises, real limits stay real, safety holds stop everything.

## How to add or change a chapter

1. Edit the entry in `CHAPTERS` in `chapters.ts` (or append a new one with the next number).
2. Add or update its row in the table above — the test checks every chapter is listed.
3. Run `npm run unblock:chapters -- <n>` and read it aloud.
4. Run the tests: `node --import tsx --test services/voice/test/unblock-chapters.test.ts`.
5. Set `status: 'approved'` only after owner review. Only approved chapters may be offered to callers.

Chapter 1 is pinned to the weekly script: if you rewrite a week 1–4 question in `weekly-script.md`, update chapter 1 to match or the test fails.

## Wiring into the build (not done yet)

The core build (database, programme logic, scheduler) currently models one four-week arc. Chapters plug in without changing that shape:

| Where | Change |
| --- | --- |
| Programme | Add `chapter: number` (starts at 1). Completing week 4 of chapter *n* either ends the programme or, if the caller continues, sets `chapter = n + 1` and `weeksHeld = 0`. No new opening call after chapter 1 |
| Data | Add `chapter` to steps, blocks, ledger entries and closings, so each chapter's read-back and account view is scoped |
| Voice context | Pass `{{chapter}}` and `{{chapter_theme}}` = `chapterTheme(chapterFor(chapter), week)` for weekly calls |
| Weekly script | For chapter ≥ 2, follow `{{chapter_theme}}` instead of the WEEK 1–4 branches. The week 4 sign-off becomes "This is the last call of this chapter" unless it is the final chapter or the caller is not continuing |
| Account | One section per chapter: title, picture, and the milestone shown alongside the caller's own closing words |
| Read-back | Chapter close: this chapter's ledger. Chapter 12: spread across the year, one per chapter where possible |

## Open owner decisions

| Decision | Proposed baseline |
| --- | --- |
| Pricing | Chapter 1 stays the one-time purchase. Continuing is offered in the private account after chapter 1, never in a call. One-time per chapter or a year bundle — undecided |
| Continue by default? | No. Each chapter close asks nothing about buying; the account offers the next chapter |
| Pause between chapters | Allowed, any length. The next chapter starts from the caller's current wish and ledger |
| Order | Fixed 1–12 for the pilot. Letting callers pick a chapter later is possible because each one stands alone |
| Norwegian | Needs its own pack, like the rest of the module |
