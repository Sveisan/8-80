import { resolve } from 'node:path';

/**
 * Unblock chapters: one per month of the subscription. A chapter has a picture
 * (an analogy), a milestone (what the caller leaves the month with, in their own
 * words), up to three ordered themes and a close. The caller chooses 1-8 calls
 * per month; the last call of every month is always the close. Chapter 1 is the
 * original arc in weekly-script.md.
 *
 * To add or rewrite a chapter, edit CHAPTERS below and run the unblock tests.
 * A chapter needs no new tool commands, tables or scripts: its calls reuse the
 * existing capture_unblock commands and reach the voice agent as `chapter_theme`
 * inside {{unblock_context}}. See docs/unblock/chapters.md.
 */

/** Existing capture_unblock commands a chapter call may save with, or 'reflect' for nothing saved. */
export type ChapterSave = 'step' | 'block' | 'light' | 'wish' | 'closing' | 'reflect';
export interface ChapterWeek {
  title: string;
  /** The opening question for the theme, spoken as written. */
  question: string;
  /** Optional follow-ups; the guide uses at most one or two. */
  followUps: string[];
  saves: ChapterSave;
  /** The wish may be reworded in this call (a theme that saves `wish` always may). */
  revisesWish?: boolean;
}
export interface Chapter {
  number: number;
  slug: string;
  title: string;
  /** The month's picture. Said once near the start of the first call, and used in the close as a summary of the caller's own month. */
  analogy: string;
  /** What the caller leaves the month with. Shown in the account in their words; never scored or announced as reached. */
  milestone: string;
  /** The month's one question. */
  question: string;
  /** draft: written, not reviewed · approved: owner-approved script copy, may be offered to callers. */
  status: 'draft' | 'approved';
  /** Ordered themes for the calls before the close. With fewer calls they are spread; with more, the extra calls are open calls. */
  themes: [ChapterWeek, ChapterWeek, ChapterWeek];
  /** The last call of the month, whatever the number of calls. */
  close: ChapterWeek;
  /** Which entries the close reads back. 'year' only for the final chapter. */
  readback: 'chapter' | 'year';
}

export const CHAPTERS: readonly Chapter[] = [
  {
    number: 1, slug: 'the-wish', title: 'The Wish', status: 'draft', readback: 'chapter',
    analogy: 'Most people have a map they drew a long time ago and folded away in a drawer. This month is about taking it out and looking at it again.',
    milestone: 'One wish in your own words, what has kept it a wish, a first few steps, and the start of your light ledger.',
    question: 'What have you wanted for a long time and kept for "someday"?',
    // Must stay verbatim with the WEEK 1–4 branches of docs/unblock/weekly-script.md (tested).
    themes: [
      { title: 'What keeps it a wish', saves: 'block', question: 'If you moved properly toward this, what would it put at risk?',
        followUps: ['Which part of that is happening now, and which part is what you expect would happen?'] },
      { title: 'Signs', saves: 'light', question: 'When did you last feel the pull toward this, even for a minute?',
        followUps: ['Is there a person who keeps coming up when you think about it?', 'Has anything opened up — a small chance, a coincidence, a conversation?', "What do you find yourself coming back to, when no one's asking?"] },
      { title: 'The hard stretch', saves: 'step', revisesWish: true, question: 'Has anything got harder since you started?',
        followUps: ['What is it teaching you?', 'Do you want to keep the step, make it smaller, change it — or pause?'] },
    ],
    close: { title: 'Home', saves: 'closing', question: 'Hearing those — what was already here, before any of this started?',
      followUps: ['And the wish — where is it now?', "How do you want to live with both — the wish and what's already here?"] },
  },
  {
    number: 2, slug: 'the-first-mile', title: 'The First Mile', status: 'draft', readback: 'chapter',
    analogy: "New boots are stiff for the first mile. The rubbing isn't a sign you chose the wrong road; it's the boots learning your feet.",
    milestone: 'A step small enough to keep doing every week, and a month of it in your own record — whatever happened each time.',
    question: 'What could you keep doing, even in a bad week?',
    themes: [
      { title: 'A rhythm', saves: 'step', question: "What's the smallest version of your step that you could do even in a bad week?",
        followUps: ['When in the week does it fit most naturally?'] },
      { title: 'Where it rubs', saves: 'block', question: 'Where does it rub — what makes the step harder than it needs to be?',
        followUps: ['Is that the step itself, the timing, or something around it?'] },
      { title: 'The fit', saves: 'step', question: 'What would you change so it fits your life a bit better?',
        followUps: ['Do you want to keep it, shrink it, or move it?'] },
    ],
    close: { title: 'The mile walked', saves: 'closing', question: "Looking back at this month's steps, what do you notice about how you move?",
      followUps: ['What do you want to keep from this month?'] },
  },
  {
    number: 3, slug: 'companions', title: 'Companions', status: 'draft', readback: 'chapter',
    analogy: 'Nobody walks a long road completely alone. Some people carry water, some point the way, and some, without meaning to, add weight to the pack.',
    milestone: 'One person who knows about the wish, and one clear thing you asked for.',
    question: 'Who walks with you on this?',
    themes: [
      { title: 'Who knows', saves: 'reflect', question: 'Who knows about this wish right now?',
        followUps: ['Who would you like to know?'] },
      { title: 'Lighter and heavier', saves: 'light', question: 'Is there someone who makes the wish feel lighter — and someone who makes it feel heavier?',
        followUps: ['What do they do that has that effect?'] },
      { title: 'Asking', saves: 'step', question: 'Is there one specific thing you could ask someone for this week?',
        followUps: ['What would make it easy for them to say yes, or no?'] },
    ],
    close: { title: 'Who is beside you', saves: 'closing', question: 'What did telling or asking someone change, if anything?',
      followUps: ['Who do you want beside you next month?'] },
  },
  {
    number: 4, slug: 'making-room', title: 'Making Room', status: 'draft', readback: 'chapter',
    analogy: "A pack only holds so much. To carry something new a long way, something else usually comes out — not because it was bad, but because there's only so much room.",
    milestone: 'One thing set down or made smaller to make room for the wish — chosen by you, and only if it was yours to set down.',
    question: 'What could you set down to make room?',
    themes: [
      { title: 'What you carry', saves: 'reflect', question: 'Where do your time and energy go in an ordinary week?',
        followUps: ['Which of those do you actually choose, and which are real obligations?'] },
      { title: 'Out of habit', saves: 'block', question: 'Is there something you keep carrying out of habit rather than because it matters to you?',
        followUps: ['What would it cost to put it down for a while?'] },
      { title: 'Setting it down', saves: 'step', question: "What's one thing you could set down or make smaller this week?",
        followUps: ['What would you do with that room?'] },
    ],
    close: { title: 'The room you made', saves: 'closing', question: 'What did you notice with a little more room?',
      followUps: ['Is there anything you want to pick back up?'] },
  },
  {
    number: 5, slug: 'losing-the-trail', title: 'Losing the Trail', status: 'draft', readback: 'chapter',
    analogy: "On any long walk there's a stretch where the path disappears — fog, a wrong turn, a missing sign. Being lost for a while is part of the route, not proof you shouldn't have set out.",
    milestone: 'One setback looked at plainly, in your words, and a way back that you chose yourself.',
    question: 'When you lose the way, how do you find it again?',
    themes: [
      { title: 'Where it went quiet', saves: 'reflect', question: 'Has there been a moment recently when you lost the thread of this?',
        followUps: ['What was happening around you then?'] },
      { title: 'What helped before', saves: 'light', question: "When you've found your way back before — with anything — what helped?",
        followUps: ['Who or what was there when you did?'] },
      { title: 'A step back on', saves: 'step', question: "What's a small step back onto the path, from where you are now?",
        followUps: [] },
    ],
    close: { title: 'Knowing the fog', saves: 'closing', question: "What do you know about getting lost now that you didn't a month ago?",
      followUps: ['What do you want to remember the next time the path disappears?'] },
  },
  {
    number: 6, slug: 'the-well', title: 'The Well', status: 'draft', readback: 'chapter',
    analogy: "Halfway along a long road there's often a place to stop — a well, a bench, some shade. You rest, drink, and look back at the distance before you look ahead.",
    milestone: "A halfway account in your own words: what has changed, what you're keeping, and whether the wish still fits.",
    question: 'What do you need, halfway?',
    themes: [
      { title: 'Rest', saves: 'step', question: 'What would real rest look like for you this week?',
        followUps: ['Could resting be this week\'s step?'] },
      { title: 'The distance behind', saves: 'light', question: 'Since you first named the wish, what has changed — in you or around you?',
        followUps: [] },
      { title: 'Does it still fit', saves: 'wish', question: 'Does the wish still fit — or has it changed shape?',
        followUps: ["It's allowed to change. What do you want now?"] },
    ],
    close: { title: 'The second half', saves: 'closing', question: 'What are you taking with you into the second half?',
      followUps: ['What are you leaving at the well?'] },
  },
  {
    number: 7, slug: 'the-craft', title: 'The Craft', status: 'draft', readback: 'chapter',
    analogy: 'On a long road you stop just walking and start learning the trade — how to read the ground, pack lighter, pace yourself. Skill grows quietly, by doing the same thing a little better.',
    milestone: "One skill the wish needs, practised on purpose, and one person or source you're learning from.",
    question: 'What does this wish ask you to get better at?',
    themes: [
      { title: 'The skill', saves: 'reflect', question: "What's one skill this wish asks of you?",
        followUps: ['Where are you with it now, honestly?'] },
      { title: 'A teacher', saves: 'step', question: 'Who or what could you learn it from?',
        followUps: ['What would a first small lesson look like?'] },
      { title: 'Practice', saves: 'light', question: "What did practising teach you that thinking about it didn't?",
        followUps: [] },
    ],
    close: { title: 'A little better', saves: 'closing', question: "What can you do now that you couldn't do a month ago — however small?",
      followUps: ['What do you want to keep practising?'] },
  },
  {
    number: 8, slug: 'open-ground', title: 'Open Ground', status: 'draft', readback: 'chapter',
    analogy: 'Sooner or later the road leaves the trees and crosses open ground, where you can be seen. It usually feels more exposed than it is.',
    milestone: 'One visible act toward the wish — something shown, sent, asked or said out loud, in a way that suits you.',
    question: 'What would it mean to be seen doing this?',
    themes: [
      { title: 'Out of sight', saves: 'block', question: 'What part of this have you kept out of sight so far?',
        followUps: ['What would being seen with it risk?'] },
      { title: 'A small way to be seen', saves: 'step', question: "What's the smallest way to let this be seen — by one person, or in one place?",
        followUps: [] },
      { title: 'What happened', saves: 'light', question: 'What happened when you did — or what stopped you?',
        followUps: ['What surprised you?'] },
    ],
    close: { title: 'Seen', saves: 'closing', question: 'What did being seen teach you?',
      followUps: ['What do you want to show next?'] },
  },
  {
    number: 9, slug: 'reading-the-weather', title: 'Reading the Weather', status: 'draft', readback: 'chapter',
    analogy: 'People who walk far learn to read the weather: when to push on, when to wait, when to take shelter. The signs are usually there before the storm.',
    milestone: "A short list, in your own words, of the signals that tell you you're on course — and the ones that tell you to slow down.",
    question: "How do you know when you're on course?",
    themes: [
      { title: 'Fair weather', saves: 'light', question: 'When this is going well, how do you notice — in your body, your mood, your days?',
        followUps: [] },
      { title: 'Clouds', saves: 'reflect', question: "And when it's going badly, what's the first sign?",
        followUps: ['How early can you usually tell?'] },
      { title: 'Push, wait or rest', saves: 'step', question: 'Is this a week to push on, to wait, or to rest?',
        followUps: ['What would that look like?'] },
    ],
    close: { title: 'Your forecast', saves: 'closing', question: 'Which signals do you want to remember?',
      followUps: [] },
  },
  {
    number: 10, slug: 'the-view-back', title: 'The View Back', status: 'draft', readback: 'chapter',
    analogy: 'From high enough up you can see the whole road behind you, including the stretches that felt like nothing at the time.',
    milestone: "A record of what these months have given you that wasn't the plan.",
    question: "What have you gained that you weren't looking for?",
    themes: [
      { title: 'Unplanned', saves: 'light', question: "Looking back over these months, what's turned up that you weren't looking for?",
        followUps: [] },
      { title: 'Seen differently', saves: 'light', question: 'Is there a person, a habit, or a time of day you appreciate more than you used to?',
        followUps: [] },
      { title: 'To the first month', saves: 'reflect', question: 'What would you tell yourself in the first month, if you could?',
        followUps: [] },
    ],
    close: { title: 'From here', saves: 'closing', question: 'Hearing those — what do you see, from here?',
      followUps: [] },
  },
  {
    number: 11, slug: 'passing-it-on', title: 'Passing It On', status: 'draft', readback: 'chapter',
    analogy: 'Travellers leave things for the people behind them: a marker at a confusing turn, water at the well, a word about the road ahead.',
    milestone: "One thing you passed on — help, encouragement or something you've learned — to someone with a wish of their own.",
    question: 'What could you pass on?',
    themes: [
      { title: 'Others on the road', saves: 'reflect', question: 'Who around you is holding a wish of their own?',
        followUps: [] },
      { title: 'What you know now', saves: 'light', question: "What have you learned on this road that might help someone else?",
        followUps: [] },
      { title: 'Leaving a marker', saves: 'step', question: 'Is there one thing you could pass on this week?',
        followUps: ['To whom?'] },
    ],
    close: { title: 'What giving changed', saves: 'closing', question: 'What did passing it on change for you, if anything?',
      followUps: [] },
  },
  {
    number: 12, slug: 'home-by-a-new-road', title: 'Home by a New Road', status: 'draft', readback: 'year',
    analogy: 'At the end of a long journey you come back to where you started, and it looks different — not because it changed, but because you did.',
    milestone: 'The year read back in your own words, and your own choice about what comes next: carry on, rest, or a new wish.',
    question: "What do you see now that you're back?",
    themes: [
      { title: 'A year ago', saves: 'reflect', question: 'When you think of where you were a year ago, what comes to mind first?',
        followUps: [] },
      { title: 'Here all along', saves: 'light', question: "What's been here all along that you see differently now?",
        followUps: [] },
      { title: 'What next', saves: 'wish', question: 'What do you want next — to carry on with this, to rest, or something new?',
        followUps: ['If it is something new, how would you say it?'] },
    ],
    close: { title: 'Home', saves: 'closing', question: 'Hearing those — what do you want to carry into the year ahead?',
      followUps: [] },
  },
];

/** The default number of calls in a month. */
export const CHAPTER_WEEKS = 4;
export const MIN_CALLS = 1;
export const MAX_CALLS = 8;

export function chapterFor(number: number): Chapter | undefined {
  return CHAPTERS.find(c => c.number === number);
}
/** The chapter after this one, or undefined when the last chapter of the year is reached. */
export function nextChapter(number: number): Chapter | undefined {
  return chapterFor(number + 1);
}
/**
 * Which chapter month N of the subscription uses. Months 1-12 are chapters 1-12 (year 1).
 * After chapter 12 the sequence continues at chapter 2 (chapter 1 is the first-time arc and is not repeated),
 * so month 13 is chapter 2 of year 2, month 23 is chapter 12 of year 2 and month 24 is chapter 2 of year 3.
 */
export function chapterPos(month: number): { number: number; year: number } {
  const m = Math.max(1, Math.floor(month));
  if (m <= CHAPTERS.length) return { number: m, year: 1 };
  const cycle = CHAPTERS.length - 1, k = m - CHAPTERS.length - 1;
  return { number: 2 + (k % cycle), year: 2 + Math.floor(k / cycle) };
}
export const chapterOfMonth = (month: number): Chapter => chapterFor(chapterPos(month).number)!;

export type CallStep = { kind: 'theme'; index: number } | { kind: 'open' } | { kind: 'close' };
/**
 * What each call of a month with `calls` calls is. The last call is the close. Calls before it take the themes in order:
 * with fewer than three they are spread (one call: theme 1; two calls: themes 1 and 3), with more the extra calls are open calls.
 */
export function callPlan(calls: number): CallStep[] {
  const n = Math.min(MAX_CALLS, Math.max(MIN_CALLS, Math.floor(calls)));
  const before = n - 1;
  const picks: CallStep[] = [];
  for (let i = 0; i < before; i++) {
    picks.push(i < 3 && before >= 3 ? { kind: 'theme', index: i }
      : before < 3 ? { kind: 'theme', index: before === 1 ? 0 : Math.round(i * 2 / (before - 1)) }
        : { kind: 'open' });
  }
  return [...picks, { kind: 'close' }];
}

/** The theme of call `call` of a `calls`-call month (undefined for open calls and the close). */
export function themeOfCall(chapter: Chapter, call: number, calls: number): ChapterWeek | undefined {
  const step = callPlan(calls)[call - 1];
  return step?.kind === 'theme' ? chapter.themes[step.index] : undefined;
}

/**
 * The value of `chapter_theme` for a call: the month's picture (first call of the chapter), the call's theme,
 * and what may be saved. In the close it also tells the guide to summarise the caller's own month with the picture.
 * Plain guidance for the voice agent, not caller data.
 */
export function chapterTheme(chapter: Chapter, call: number, calls = CHAPTER_WEEKS): string {
  const plan = callPlan(calls);
  const step = plan[call - 1];
  if (!step) throw new RangeError(`chapter ${chapter.number} has no call ${call} of ${plan.length}`);
  const w = step.kind === 'close' ? chapter.close : step.kind === 'theme' ? chapter.themes[step.index]! : undefined;
  const label = step.kind === 'open' ? 'OPEN CALL' : w!.title.toUpperCase();
  const lines = [
    `CHAPTER ${chapter.number} OF ${CHAPTERS.length} — ${chapter.title.toUpperCase()} · CALL ${call} OF ${plan.length} — ${label}`,
    `The month's question: "${chapter.question}"`,
  ];
  if (call === 1 && step.kind !== 'close') lines.push(`Near the start, offer the month's picture once, in these words or close to them: "${chapter.analogy}" Do not explain it.`);
  if (!w) {
    lines.push('No new theme this call. After the last step, ask what is alive in their days right now, and what has changed since last time. Then the next step. Follow the caller.');
    lines.push('On read-back and agreement, save a moment with command light and the next step with command step.');
    return lines.join('\n');
  }
  lines.push(`Theme question: "${w.question}"`);
  if (w.followUps.length) lines.push(`Possible follow-ups, at most one or two: ${w.followUps.map(f => `"${f}"`).join(' · ')}`);
  lines.push(w.saves === 'reflect'
    ? 'Reflect what they say; nothing needs saving from the theme.'
    : `On read-back and agreement, save with command ${w.saves}.`);
  if (step.kind === 'close') {
    lines.push(chapter.readback === 'year'
      ? 'This is the closing call of the year. Before the theme question, read back up to five ledger entries spread across the year, verbatim.'
      : "This is the chapter's closing call, the last call of the month. Before the theme question, read back up to five of this chapter's ledger entries, verbatim.");
    lines.push(`After the theme question, offer the month's picture as a summary of THEIR month: "${chapter.analogy}" Build it only from month_words in the context and what they have said today: one or two plain sentences that use their own words for their steps, what happened and the moments they noticed. Never add facts, never embellish, never claim progress they did not describe. Ask whether it fits; if not, drop it and use their version.`);
    lines.push(`What the caller may leave with this month: ${chapter.milestone} Never announce it as reached or missed.`);
  }
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const n = Number(process.argv[2]);
  const calls = process.argv[3] ? Number(process.argv[3]) : CHAPTER_WEEKS;
  const chosen = process.argv[2] ? chapterFor(n) : undefined;
  if ((process.argv[2] && !chosen) || !Number.isInteger(calls) || calls < MIN_CALLS || calls > MAX_CALLS) {
    console.error(`Use: npm run unblock:chapters -- [1-${CHAPTERS.length}] [calls 1-${MAX_CALLS}]`);
    process.exitCode = 1;
  } else if (chosen) {
    for (let w = 1; w <= calls; w++) console.log(`${chapterTheme(chosen, w, calls)}\n`);
  } else {
    for (const c of CHAPTERS) console.log(`${String(c.number).padStart(2)}. ${c.title} [${c.status}] — ${c.question}\n    Picture: ${c.analogy}\n    Milestone: ${c.milestone}\n`);
  }
}
