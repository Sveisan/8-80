import type { ScriptLines } from '../script.ts';
import type { Turn } from './outcome.ts';

/**
 * Reads a finished call against the shape it was meant to have, so "the opener
 * was scattered" becomes "two turns between the greeting and the disclosure,
 * and one of them was a question".
 *
 * Everything is matched against SCRIPT.md rather than against English written
 * here, so rewriting a line moves the check with it. The matching is loose on
 * purpose: a mentor that says a line with one word changed has said the line,
 * and a check that fails on that teaches people to stop reading it.
 */

/** A turn with the time it started, when the source has one. */
export interface TimedTurn extends Turn {
  atMs?: number;
}

export type Severity = 'fail' | 'warn' | 'ok';

export interface Finding {
  check: string;
  severity: Severity;
  detail: string;
}

export interface Scorecard {
  first: boolean;
  findings: Finding[];
}

/** Lines that mean the goal is done with and the call has moved on. */
const MOVE_ON = [
  'work.enough',
  'block.first',
  'read.eight',
  'next.ask.a',
  'next.ask.b',
  'next.ask.c',
  'next.when',
  'setup.when',
];

/**
 * Questions that test a goal rather than learn its shape. Each is a thing the
 * last real call actually asked, or one SCRIPT.md §1a names.
 */
const PROBES: RegExp[] = [
  /\bwhy\b/,
  /\brealistic\b/,
  /\breal (goal|thing)\b/,
  /\bwhat if\b/,
  /\bmeasure\b|\bsuccess look/,
  /\bspecifically\b/,
  /\bwhat happened with\b/,
  /\bgot further\b|\bhow far\b/,
  /\bunderneath\b|\bmatter to you\b/,
];

/** Roughly how fast anyone speaks on a call, for estimating when a turn ended. */
const WORDS_PER_SECOND = 2.7;
/** Silence on a phone line longer than this is somebody waiting, not thinking. */
const DEAD_AIR_MS = 12_000;

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  return normalise(text).split(' ').filter(Boolean);
}

/**
 * Whether `said` carries `line`. Short lines ("Which day?") must appear whole,
 * or every turn with "which" and "day" in it would count; longer ones need
 * most of their words, because the model rarely drops none of them.
 */
export function carries(said: string, line: string): boolean {
  const want = words(line);
  if (!want.length) return false;
  if (want.length < 5) return ` ${normalise(said)} `.includes(` ${want.join(' ')} `);
  const have = new Set(words(said));
  return want.filter((w) => have.has(w)).length / want.length >= 0.8;
}

function sentences(line: string): string[] {
  return line
    .split(/(?<=[.?])\s+/)
    .map((s) => s.trim())
    .filter((s) => words(s).length > 0);
}

function quote(text: string, max = 70): string {
  const t = text.trim();
  return `"${t.length > max ? `${t.slice(0, max - 1)}…` : t}"`;
}

/** The question in a turn, which is the part worth quoting. */
function asked(text: string): string {
  return sentences(text).filter((s) => s.includes('?')).pop() ?? text;
}

function indexOfLine(turns: TimedTurn[], line: string | undefined, from = 0): number {
  if (!line) return -1;
  for (let i = from; i < turns.length; i++) {
    const t = turns[i];
    if (t && t.speaker === 'agent' && carries(t.text, line)) return i;
  }
  return -1;
}

export function scoreCall(script: ScriptLines, turns: TimedTurn[], opts: { first?: boolean } = {}): Scorecard {
  const agentTurns = turns.filter((t) => t.speaker === 'agent');
  const greet = script.get('open.first.greet');
  const first = opts.first ?? (!!greet && !!agentTurns[0] && carries(agentTurns[0].text, greet));
  const findings: Finding[] = [];
  const add = (check: string, severity: Severity, detail: string) => findings.push({ check, severity, detail });

  if (first) findings.push(...scoreOpening(script, turns), ...scoreGoal(script, turns), ...scoreDeliverables(script, turns));
  else findings.push(...scoreReturn(script, turns));

  // Whichever call it is.
  const cut = agentTurns.filter((t) => words(t.text).length <= 6 && !/[.?!…—-]\s*$/.test(t.text.trim()));
  add(
    'cut_off',
    cut.length ? 'warn' : 'ok',
    cut.length
      ? `${cut.length} mentor turn${cut.length === 1 ? '' : 's'} started over them and stopped: ${cut.map((t) => quote(t.text, 30)).join(', ')}`
      : 'the mentor never started a turn and abandoned it',
  );

  const stacked = agentTurns.filter((t) => (t.text.match(/\?/g) ?? []).length >= 2);
  add(
    'stacked_questions',
    stacked.length ? 'warn' : 'ok',
    stacked.length ? `two questions in one turn: ${stacked.map((t) => quote(t.text)).join('; ')}` : 'one question per turn',
  );

  findings.push(...scoreSilence(turns));
  return { first, findings };
}

function scoreOpening(script: ScriptLines, turns: TimedTurn[]): Finding[] {
  const out: Finding[] = [];
  const greet = script.get('open.first.greet');
  const disclosure = script.get('open.first.disclosure') ?? '';
  const frame = script.get('open.first.frame') ?? '';
  const question = script.get('open.first.first_question');

  const firstAgent = turns.findIndex((t) => t.speaker === 'agent');
  const g = indexOfLine(turns, greet);
  out.push({
    check: 'opening.greeting',
    severity: g >= 0 && g === firstAgent ? 'ok' : 'fail',
    detail: g === firstAgent ? 'opened on the greeting' : 'the first thing said was not the greeting',
  });

  const greetings = turns.filter((t) => t.speaker === 'agent' && greet && carries(t.text, greet)).length;
  if (greetings > 1) out.push({ check: 'opening.greeting_repeated', severity: 'warn', detail: `the greeting was said ${greetings} times` });

  // The disclosure is found by its first sentence, so a turn that said only
  // part of it still marks where it began.
  const discSentences = sentences(disclosure);
  const d = indexOfLine(turns, discSentences[0] ?? disclosure);
  const q = indexOfLine(turns, question, Math.max(d, 0));
  const beforeQuestion = turns
    .slice(0, q >= 0 ? q + 1 : turns.length)
    .filter((t) => t.speaker === 'agent')
    .map((t) => t.text)
    .join(' ');

  const missing = discSentences.filter((s) => !carries(beforeQuestion, s));
  out.push({
    check: 'disclosure.complete',
    severity: d < 0 || missing.length ? 'fail' : 'ok',
    detail:
      d < 0
        ? 'the disclosure was never said'
        : missing.length
          ? `missing from the disclosure: ${missing.map((s) => quote(s, 50)).join(', ')}`
          : 'every sentence of the disclosure was said',
  });

  // Nobody is asked anything before they know the terms. The greeting, said
  // again or re-asked after a mishearing, is the only question allowed ahead.
  const allowed = [greet, script.get('open.first.unclear')].filter((l): l is string => !!l);
  const askedFirst = turns
    .slice(0, d >= 0 ? d : turns.length)
    .filter((t) => t.speaker === 'agent' && t.text.includes('?') && !allowed.some((l) => carries(t.text, l)));
  out.push({
    check: 'disclosure.first',
    severity: askedFirst.length ? 'fail' : 'ok',
    detail: askedFirst.length
      ? `asked before the disclosure: ${askedFirst.map((t) => quote(asked(t.text))).join('; ')}`
      : 'nothing was asked before the disclosure',
  });

  const frameMissing = sentences(frame).filter((s) => !carries(beforeQuestion, s));
  out.push({
    check: 'frame.complete',
    severity: frameMissing.length ? 'fail' : 'ok',
    detail: frameMissing.length ? `missing from the frame: ${frameMissing.map((s) => quote(s, 50)).join(', ')}` : 'the whole frame was said',
  });

  // Greeting, disclosure, frame-and-question: three turns is the design.
  if (q >= 0) {
    const openingTurns = turns.slice(0, q + 1).filter((t) => t.speaker === 'agent').length;
    out.push({
      check: 'opening.turns',
      severity: openingTurns > 4 ? 'warn' : 'ok',
      detail: `${openingTurns} mentor turns to reach the first question (3 is the design)`,
    });
  } else {
    out.push({ check: 'opening.turns', severity: 'fail', detail: 'the first question was never asked as written' });
  }
  return out;
}

function scoreGoal(script: ScriptLines, turns: TimedTurn[]): Finding[] {
  const out: Finding[] = [];
  const q = indexOfLine(turns, script.get('open.first.first_question'));
  if (q < 0) return out;

  const next = MOVE_ON.map((id) => ({ id, at: indexOfLine(turns, script.get(id), q + 1) })).filter((m) => m.at >= 0);
  const end = next.length ? Math.min(...next.map((m) => m.at)) : turns.length;
  const window = turns.slice(q + 1, end);
  // An exchange is the mentor answering them. Abandoned half-turns are talk-
  // over, not exchanges, and are counted on their own.
  const replies = window.filter((t) => t.speaker === 'agent' && /[.?!…]\s*$/.test(t.text.trim()));
  const reachedBy = next.find((m) => m.at === end)?.id;

  out.push({
    check: 'goal.exchanges',
    severity: replies.length > 3 ? 'fail' : 'ok',
    detail: `${replies.length} exchange${replies.length === 1 ? '' : 's'} between the first question and ${reachedBy ? `the next scripted step (${reachedBy})` : 'the end of the call, which never reached a scripted next step'} — the ceiling is 3`,
  });

  const probes = replies.filter((t) => t.text.includes('?') && PROBES.some((p) => p.test(normalise(t.text))));
  out.push({
    check: 'goal.probes',
    severity: probes.length ? 'fail' : 'ok',
    detail: probes.length
      ? `tested the goal instead of accepting it: ${probes.map((t) => quote(asked(t.text))).join('; ')}`
      : 'the goal was taken as given',
  });
  return out;
}

function scoreDeliverables(script: ScriptLines, turns: TimedTurn[]): Finding[] {
  const said = (id: string) => indexOfLine(turns, script.get(id)) >= 0;
  const need: [string, string, string[]][] = [
    ['deliverable.day', 'asked which day the one thing lands on', ['next.when']],
    ['deliverable.readback', 'read the commitment and its day back', ['next.confirm']],
    ['deliverable.slot', 'asked for the weekly slot', ['setup.when']],
    ['deliverable.close', 'closed the call', ['close.end', 'close.logistics']],
  ];
  return need.map(([check, what, ids]) => ({
    check,
    severity: ids.some(said) ? ('ok' as const) : ('fail' as const),
    detail: ids.some(said) ? what : `never ${what}`,
  }));
}

function scoreReturn(script: ScriptLines, turns: TimedTurn[]): Finding[] {
  const greet = script.get('open.return.greet');
  const firstAgent = turns.find((t) => t.speaker === 'agent');
  const found = indexOfLine(turns, script.get('next.when')) >= 0 || indexOfLine(turns, script.get('next.confirm')) >= 0;
  return [
    {
      check: 'return.greeting',
      severity: firstAgent && greet && carries(firstAgent.text, greet) ? 'ok' : 'warn',
      detail: firstAgent ? `opened with ${quote(firstAgent.text)}` : 'the mentor never spoke',
    },
    {
      check: 'return.commitment',
      severity: found ? 'ok' : 'fail',
      detail: found ? 'reached a commitment and its day' : 'never reached next week\'s commitment',
    },
  ];
}

/**
 * Dead air: a gap between the estimated end of one turn and the start of the
 * next. Only possible when the source has timestamps; a transcript without
 * them says so rather than reporting a clean line it cannot see.
 */
function scoreSilence(turns: TimedTurn[]): Finding[] {
  if (turns.some((t) => t.atMs === undefined)) {
    return [{ check: 'dead_air', severity: 'warn', detail: 'no timestamps in this transcript, so silence was not measured' }];
  }
  const gaps: string[] = [];
  for (let i = 0; i + 1 < turns.length; i++) {
    const a = turns[i];
    const b = turns[i + 1];
    if (!a || !b || a.atMs === undefined || b.atMs === undefined) continue;
    const ends = a.atMs + (words(a.text).length / WORDS_PER_SECOND) * 1000;
    const gap = b.atMs - ends;
    if (gap < DEAD_AIR_MS) continue;
    const who = a.speaker === 'agent' ? `after the mentor said ${quote(a.text, 50)}` : `after they said ${quote(a.text, 50)}`;
    gaps.push(`${Math.round(gap / 1000)}s at ${clock(ends)}, ${who}`);
  }
  return [
    {
      check: 'dead_air',
      severity: gaps.length ? 'fail' : 'ok',
      detail: gaps.length ? `silence on the line: ${gaps.join('; ')}` : `no silence longer than ${DEAD_AIR_MS / 1000}s`,
    },
  ];
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * The transcript as the Speechify console exports it:
 *
 *     [0:28] Agent: Two quick things, and then they're done with.
 *     [0:56] User: Okay.
 *     [0:05] system: flow node entered: main (subagent)
 *
 * System lines are the platform talking to itself and are dropped.
 */
export function parseConsoleExport(text: string): TimedTurn[] {
  const out: TimedTurn[] = [];
  for (const raw of text.split('\n')) {
    const m = /^\s*\[(?:(\d+):)?(\d+):(\d{2})\]\s*(agent|user|caller|system)\s*:\s?(.*)$/i.exec(raw);
    if (!m) continue;
    const role = (m[4] ?? '').toLowerCase();
    if (role === 'system') continue;
    const atMs = ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000;
    out.push({ speaker: role === 'agent' ? 'agent' : 'caller', text: (m[5] ?? '').trim(), atMs });
  }
  return out;
}

export function formatScorecard(card: Scorecard): string {
  const mark: Record<Severity, string> = { fail: '✕', warn: '!', ok: '·' };
  const order: Record<Severity, number> = { fail: 0, warn: 1, ok: 2 };
  const rows = [...card.findings].sort((a, b) => order[a.severity] - order[b.severity]);
  const fails = rows.filter((f) => f.severity === 'fail').length;
  return [
    `${card.first ? 'First call' : 'Returning call'} · ${fails} failed · ${rows.filter((f) => f.severity === 'warn').length} to look at`,
    '',
    ...rows.map((f) => `  ${mark[f.severity]} ${f.check.padEnd(26)} ${f.detail}`),
  ].join('\n');
}
