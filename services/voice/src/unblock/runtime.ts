import { randomUUID } from 'node:crypto';
import { config } from '../config.ts';
import { encrypt, decrypt } from '../store/crypto.ts';
import type { LoopDeps } from '../loop/deps.ts';
import type postgres from 'postgres';
import { describeAppointment, nextSlotAfter } from '../schedule/time.ts';
import { safetyTier } from '../call/safety.ts';
import { toTranscript, eventOf } from '../webhook/speechify.ts';
import { enqueue } from '../messages/outbox.ts';
import { obj, str } from '../billing/types.ts';
import { PracticeError } from '../beliefs/model.ts';
import { unblockConfig } from './config.ts';
import { unblockReadiness } from './readiness.ts';
import { withinCoverage } from './coverage.ts';
import { UnblockRepository, scheduleOf } from './repository.ts';
import { callWeek, finishCall, firstWeekly, lightEnabled, nextLight, slotKind, voiceProgramme, type CallKind } from './model.ts';
import { sessionToken, verifySessionToken, capture, verifiedProgramme, heldCall, closedSnapshot, type Snapshot } from './protocol.ts';

export interface Session { programme_id: string; id: string; phone_hash: string; kind: CallKind; week: number | null; snapshot_enc: string; complete: boolean; created_at: Date; }
const emptyScript = new Map<string, string>();
const route = (): string => config.link.publicUrl().replace(/\/$/, '') + '/unblock/access';

async function safety(sql: postgres.TransactionSql, session: Session, callerText: string, now: Date): Promise<boolean> {
  const finding = safetyTier([{ speaker: 'caller', text: callerText }], emptyScript); if (!finding) return false;
  await sql`update call_attempts set safety_tier=least(coalesce(safety_tier,3),${finding.tier}) where id=${session.id}`;
  await sql`update callers set held_for_review=true,updated_at=${now} where phone_hash=${session.phone_hash}`;
  if (finding.tier === 1) for (const [i, to] of config.operator.phones().entries()) await enqueue(sql, { eventKey: `unblock:safety:${session.id}:${i}`, phoneHash: session.phone_hash, channel: 'sms', kind: 'safety', to,
    body: '8&80: an Unblock call needs urgent human review (tier 1). All calls for this account are on hold. On the server: npm run enrol -- --review' }, now);
  return true;
}
/** `capture_unblock`: shared envelope and guarantees of `capture_belief`. Every utterance is safety-checked; saves are provisional. */
export async function unblockTool(deps: LoopDeps, input: unknown, now = new Date()): Promise<Record<string, unknown>> {
  const v = obj(input); const id = str(v?.['session_id']) ?? ''; const token = str(v?.['session_token']) ?? '';
  if (!verifySessionToken(id, token, unblockConfig().toolSecret)) throw new PracticeError('unauthorized');
  return deps.store.raw.begin(async tx => {
    const [lookup] = await tx<Session[]>`select * from unblock_sessions where id=${id}`; if (!lookup) throw new PracticeError('unauthorized');
    const [caller] = await tx`select name,held_for_review,all_calls_stopped,sms_opt_out from callers where phone_hash=${lookup.phone_hash} for update`;
    const [session] = await tx<Session[]>`select * from unblock_sessions where id=${id} for update`;
    const [attempt] = await tx`select status from call_attempts where id=${id} for update`;
    if (!caller || !session || session.complete || !['claimed', 'placed'].includes(attempt?.['status']) || +now - +session.created_at > 45 * 60_000) throw new PracticeError('session_closed');
    const callerText = str(v?.['caller_text']) ?? '';
    if (!callerText.trim() || callerText.length > 16000) throw new PracticeError('wording_required');
    if (await safety(tx, session, callerText, now)) return { held: true, instruction: 'Stop the Unblock programme questions and follow the approved safety procedure. Do not continue.' };
    if (caller['held_for_review'] || caller['all_calls_stopped'] || caller['sms_opt_out']) return { held: true, instruction: 'Stop this call. No further changes are accepted.' };
    const loaded = await new UnblockRepository(tx, session.programme_id).load(session.phone_hash);
    const snapshot = JSON.parse(decrypt(session.snapshot_enc)) as Snapshot;
    if (!loaded || loaded.enrollment.standing !== 'active' || loaded.programme.state !== 'active' || loaded.programme.revision !== snapshot.revision) throw new PracticeError('page_changed');
    if (v?.['command'] === undefined || v['command'] === '') return { held: false }; // Caller-utterance safety check.
    const week = session.week ?? 0;
    const next = capture(snapshot, session.kind, week, loaded.enrollment.timezone, input, now);
    await tx`update unblock_sessions set snapshot_enc=${encrypt(JSON.stringify(next))} where id=${id}`;
    return { programme: voiceProgramme(next.programme, { kind: session.kind, week, preferredName: next.programme.contact?.name || caller['name'] || '', schedule: scheduleOf(loaded.enrollment) }),
      coverage: next.coverage, provisional: true, instruction: 'Read back only what the caller said; changes are confirmed after the signed transcript.' };
  });
}

export async function claimUnblock(deps: LoopDeps, now = new Date()): Promise<Session[]> {
  const candidates = await deps.store.raw<{ id: string; phone_hash: string }[]>`select id,phone_hash from unblock_enrollments where is_current and standing='active' and
    (opening_at<=${now} or next_weekly_at<=${now} or next_light_at<=${now}) order by updated_at limit 50`;
  const claimed: Session[] = [];
  for (const candidate of candidates) await deps.store.raw.begin(async tx => {
    const [caller] = await tx`select held_for_review,all_calls_stopped,sms_opt_out,next_call_at from callers where phone_hash=${candidate.phone_hash} for update skip locked`; if (!caller) return;
    const loaded = await new UnblockRepository(tx, candidate.id).load(candidate.phone_hash); if (!loaded || loaded.enrollment.standing !== 'active') return;
    const { enrollment: e, programme: p } = loaded; const schedule = scheduleOf(e);
    const openingDue = !!e.opening_at && e.opening_at <= now, weeklyDue = !!e.next_weekly_at && e.next_weekly_at <= now, lightDue = !!e.next_light_at && e.next_light_at <= now;
    const kind = slotKind(p);
    const due: { kind: CallKind; at: Date }[] = [];
    if (kind === 'opening' && (openingDue || weeklyDue)) due.push({ kind, at: (openingDue ? e.opening_at : e.next_weekly_at)! });
    else if (kind === 'weekly' && weeklyDue) due.push({ kind, at: e.next_weekly_at! });
    if (lightDue && lightEnabled(p, schedule)) due.push({ kind: 'light', at: e.next_light_at! });
    // Advance every due pointer first, under the caller lock: no backlog of ringing after an outage, hold or pause.
    const finished = p.state === 'completed' || kind === undefined;
    const regular = e.weekly_weekday !== null && e.weekly_minute !== null ? nextSlotAfter(now, { weekday: e.weekly_weekday, minute: e.weekly_minute, timezone: e.timezone }) : null;
    // An opening call (whether from its own date or the weekly slot) starts the gap before week 1: an unfinished opening is offered again at the next usual slot, not hours later.
    const openingClaim = due.some(d => d.kind === 'opening') ? firstWeekly(now, schedule) : null;
    const followingLight = !finished && lightEnabled(p, schedule) ? nextLight(now, schedule.lightWeekdays, schedule.lightMinute!, e.timezone) : null;
    await tx`update unblock_enrollments set
      opening_at = case when ${openingDue} then null else opening_at end,
      next_weekly_at = case when ${finished} then null when ${openingClaim !== null} then ${openingClaim} when ${weeklyDue} then ${regular} else next_weekly_at end,
      next_light_at = case when ${finished} or ${lightDue} then ${followingLight} else next_light_at end, updated_at=${now} where id=${e.id}`;
    for (const d of due) {
      const blocked = caller['held_for_review'] || caller['all_calls_stopped'] || caller['sms_opt_out'] || p.state !== 'active';
      const late = +now - +d.at > 5 * 60_000;
      const nearBase = caller['next_call_at'] && Math.abs(+caller['next_call_at'] - +d.at) < 45 * 60_000;
      const recent = await tx`select id from call_attempts where phone_hash=${e.phone_hash} and
        (status in ('claimed','placed','settling') or scheduled_for between ${new Date(+now - 45 * 60_000)} and ${new Date(+now + 45 * 60_000)}) limit 1`;
      if (blocked) continue;
      const id = randomUUID(); const status = late || nearBase || recent.length ? 'missed' : 'claimed';
      const week = callWeek(p, d.kind);
      const snapshot: Snapshot = { revision: p.revision, initial: p, programme: p, receipts: [], coverage: {} };
      const [attempt] = await tx`insert into call_attempts(id,phone_hash,scheduled_for,status,note) values(${id},${e.phone_hash},${d.at},${status},${status === 'missed' ? 'unblock slot skipped: late or overlapping' : null}) on conflict do nothing returning id`;
      if (!attempt) continue;
      const [session] = await tx<Session[]>`insert into unblock_sessions(id,phone_hash,programme_id,kind,week,snapshot_enc,complete,created_at) values(${id},${e.phone_hash},${e.id},${d.kind},${week},${encrypt(status === 'missed' ? closedSnapshot(snapshot, d.kind, week) : JSON.stringify(snapshot))},${status === 'missed'},${now}) returning *`;
      if (status === 'claimed' && session) claimed.push(session);
      // A missed light evening is simply missed: no catch-up call and no text for every skipped evening.
      else if (d.kind !== 'light') await unblockNotice(tx, deps, e.phone_hash, id, recovery(), now);
    }
  });
  return claimed;
}
const recovery = (): string => `Check or change your next Unblock call in your private account: ${route()}`;
async function unblockNotice(sql: postgres.TransactionSql, deps: LoopDeps, hash: string, id: string, text: string, now: Date): Promise<void> {
  const phone = await deps.store.in(sql).phoneFor(hash); if (!phone || !config.link.publicUrl()) return;
  await enqueue(sql, { eventKey: `unblock:call:${id}`, phoneHash: hash, channel: 'sms', kind: 'unblock', reference: id, to: phone, body: text }, now);
}
export async function tickUnblock(deps: LoopDeps, now = new Date(), fetcher: typeof fetch = fetch): Promise<{ claimed: number; placed: number; failed: number }> {
  const out = { claimed: 0, placed: 0, failed: 0 };
  if (!unblockConfig().live || unblockReadiness().length || !withinCoverage(now)) return out;
  const sessions = await claimUnblock(deps, now); out.claimed = sessions.length;
  for (const s of sessions) {
    try {
      // Hold the account lock through the placement request so STOP/deletion cannot race dispatch.
      await deps.store.raw.begin(async tx => {
        const [caller] = await tx`select name,held_for_review,all_calls_stopped,sms_opt_out from callers where phone_hash=${s.phone_hash} for update`;
        const loaded = await new UnblockRepository(tx, s.programme_id).load(s.phone_hash);
        if (!caller || caller['held_for_review'] || caller['all_calls_stopped'] || caller['sms_opt_out'] || !loaded || loaded.enrollment.standing !== 'active' || loaded.programme.state !== 'active') throw new PracticeError('dispatch_stopped');
        const phone = await deps.store.in(tx).phoneFor(s.phone_hash); if (!phone) throw new PracticeError('dispatch_stopped');
        const c = unblockConfig(); const week = s.week ?? 0;
        const context = voiceProgramme(loaded.programme, { kind: s.kind, week, preferredName: loaded.programme.contact?.name || caller['name'] || '', schedule: scheduleOf(loaded.enrollment) });
        const response = await fetcher('https://api.speechify.ai/v1/agents/outbound-calls', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
          headers: { authorization: `Bearer ${process.env['SPEECHIFY_API_KEY']}`, 'content-type': 'application/json', 'Idempotency-Key': `unblock:${s.id}` },
          body: JSON.stringify({ agent_id: c.agentIds[s.kind], to: phone, ...(config.speechify.callerIdNumber ? { caller_id_number: config.speechify.callerIdNumber } : {}),
            dynamic_variables: { unblock_context: JSON.stringify(context), call_kind: s.kind, week: String(week), session_id: s.id, session_token: sessionToken(s.id, c.toolSecret) }, ringing_timeout_ms: 30000 }) });
        if (!response.ok) throw new PracticeError('placement_unconfirmed');
        const result = obj(await response.json()); const conversationId = str(result?.['conversation_id']); if (!conversationId) throw new PracticeError('placement_unconfirmed');
        await tx`update call_attempts set status='placed',provider_call_id=${conversationId},started_at=${now} where id=${s.id} and status='claimed'`;
      });
      out.placed++;
    } catch {
      // An uncertain provider request is never blindly redialled. Sweep owns recovery.
      await deps.store.raw`update call_attempts set note='unblock placement unconfirmed; do not redial' where id=${s.id}`;
      out.failed++;
    }
  }
  return out;
}

/** Signed completion: canonical save only from caller turns that contain the submitted words and an explicit final agreement. */
export async function settleUnblock(payload: unknown, deps: LoopDeps, event?: string, now = new Date()): Promise<{ handled: boolean; status?: string; why?: string } | undefined> {
  const t = toTranscript(payload);
  const [lookup] = await deps.store.raw<Session[]>`select s.* from unblock_sessions s join call_attempts a on a.id=s.id where a.provider_call_id=${t.providerCallId}`;
  if (!lookup) return undefined;
  if (!eventOf(payload, event)) return { handled: false, why: 'event ignored' };
  return deps.store.raw.begin(async tx => {
    const [caller] = await tx`select held_for_review,all_calls_stopped,sms_opt_out from callers where phone_hash=${lookup.phone_hash} for update`;
    const [s] = await tx<Session[]>`select * from unblock_sessions where id=${lookup.id} for update`;
    if (!caller || !s || s.complete) return { handled: false, why: 'already closed' };
    const callerTurns = t.turns.filter(turn => turn.speaker === 'caller').map(turn => turn.text); const said = callerTurns.join(' ');
    const flagged = await safety(tx, s, said, now); const snapshot = JSON.parse(decrypt(s.snapshot_enc)) as Snapshot; const week = s.week ?? 0;
    const repo = new UnblockRepository(tx, s.programme_id); const loaded = await repo.load(s.phone_hash);
    let status = 'interrupted'; let canonicalVerified = false;
    if (!flagged && !caller['held_for_review'] && !caller['all_calls_stopped'] && !caller['sms_opt_out'] && loaded?.enrollment.standing === 'active' && loaded.programme.state === 'active'
      && loaded.programme.revision === snapshot.revision && said.trim() && eventOf(payload, event) === 'conversation.completed') {
      try {
        const verified = verifiedProgramme(snapshot, callerTurns);
        const held = heldCall(snapshot, s.kind, week);
        // Verified partial saves are kept; only a held call advances the arc.
        const next = held ? finishCall(verified, s.kind, week) : verified;
        if (next.revision > snapshot.revision) await repo.confirm(s.phone_hash, snapshot.revision, next, now);
        canonicalVerified = true; status = held ? 'completed' : 'interrupted';
      } catch (error) { if (!(error instanceof PracticeError)) throw error; status = 'unverified'; }
    } else if (!said.trim()) status = 'silent';
    await tx`update unblock_sessions set complete=true,snapshot_enc=${encrypt(closedSnapshot(snapshot, s.kind, week, canonicalVerified))},coverage_enc=${encrypt(JSON.stringify(snapshot.coverage))} where id=${s.id}`;
    await tx`update call_attempts set status=${status},ended_at=${now},duration_ms=${t.durationMs},note=${flagged ? 'unblock call held for human review' : status === 'completed' ? 'unblock call complete' : 'unblock call incomplete'} where id=${s.id}`;
    if (!flagged && !caller['held_for_review']) {
      const latest = await repo.load(s.phone_hash);
      if (latest?.programme.state === 'completed' && status === 'completed') await unblockNotice(tx, deps, s.phone_hash, s.id, `8&80 Unblock: that was the last call. Calls have stopped. Everything is kept in your private account: ${route()}`, now);
      else if (s.kind === 'opening' && status === 'completed' && latest?.enrollment.next_weekly_at)
        await unblockNotice(tx, deps, s.phone_hash, s.id, `8&80 Unblock: your next call is ${describeAppointment(latest.enrollment.next_weekly_at, latest.enrollment.timezone)}. Your private account: ${route()}`, now);
      else if (status !== 'completed' && s.kind !== 'light') await unblockNotice(tx, deps, s.phone_hash, s.id, recovery(), now);
    }
    return { handled: true, status };
  });
}
export async function closeUnblockSession(deps: LoopDeps, id: string, now = new Date()): Promise<boolean> {
  const [s] = await deps.store.raw<Session[]>`select * from unblock_sessions where id=${id}`; if (!s) return false;
  await deps.store.raw.begin(async tx => {
    await tx`select phone_hash from callers where phone_hash=${s.phone_hash} for update`;
    const [a] = await tx`select status from call_attempts where id=${id} for update`;
    if (!a || !['claimed', 'placed', 'settling'].includes(a['status'])) return;
    await tx`update call_attempts set status='failed',ended_at=${now},note='unblock call unconfirmed; no automatic redial' where id=${id}`;
    const [latest] = await tx`select snapshot_enc from unblock_sessions where id=${id} for update`;
    const snapshot = JSON.parse(decrypt(latest!['snapshot_enc'])) as Snapshot;
    await tx`update unblock_sessions set complete=true,snapshot_enc=${encrypt(closedSnapshot(snapshot, s.kind, s.week ?? 0))},coverage_enc=${encrypt(JSON.stringify(snapshot.coverage))} where id=${id}`;
    if (s.kind !== 'light') await unblockNotice(tx, deps, s.phone_hash, id, recovery(), now);
  }); return true;
}
