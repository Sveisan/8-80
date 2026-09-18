import { config } from './config.ts';
import { PostgresStore } from './store/postgres.ts';
import { Deliveries } from './webhook/deliveries.ts';
import { shapeOf, UnreadablePayload } from './webhook/speechify.ts';
import { settleConversation } from './loop/settle.ts';
import { Scheduler } from './schedule/scheduler.ts';
import { loadScript } from './script.ts';
import { hasKey } from './store/crypto.ts';
import type { LoopDeps } from './loop/deps.ts';

/**
 * npm run deliveries                    — the last webhooks and what we made of them
 * npm run deliveries -- --shape <id>    — field names and types, never values
 * npm run deliveries -- --replay <id>   — run settle against it again, for real
 * npm run deliveries -- --dry <id>      — parse only: no database writes, no email
 * npm run deliveries -- --prune         — drop everything past the retention window
 *
 * The point of this file is that finding out why a webhook did not work should
 * not cost a phone call. It did, five times in one evening, and each round was
 * twenty minutes of booking a call, answering it, hanging up and reading a log
 * to learn one field name.
 *
 * `--replay` really settles: it writes, it may send a recap. `--dry` is the one
 * to reach for while chasing a parse error, because it touches nothing.
 */
const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

if (!config.database.url) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(1);
}
if (!hasKey()) {
  console.error('DATA_ENCRYPTION_KEY is not set, so nothing was ever stored to replay.');
  process.exit(1);
}

const store = new PostgresStore(config.database.url);
const deliveries = new Deliveries(store.raw);

try {
  if (has('prune')) {
    const gone = await deliveries.prune();
    console.log(`\n  Pruned ${gone} deliver${gone === 1 ? 'y' : 'ies'} past the retention window.\n`);
    process.exit(0);
  }

  const shapeId = flag('shape');
  const dryId = flag('dry');
  const replayId = flag('replay');
  const target = shapeId ?? dryId ?? replayId;

  if (!target) {
    const rows = await deliveries.list(Number(flag('limit') ?? 20));
    if (!rows.length) {
      console.log('\n  No deliveries stored yet. They arrive when a call ends.\n');
      process.exit(0);
    }
    console.log('\n  received             event                     verdict');
    console.log('  ' + '─'.repeat(72));
    for (const r of rows) {
      console.log(
        `  ${r.receivedAt.toISOString().slice(0, 19).replace('T', ' ')}  ` +
          `${(r.event ?? '—').padEnd(24)}  ${r.verdict ?? '(no verdict recorded)'}`,
      );
      console.log(`    ${r.id}${r.conversationId ? `  ${r.conversationId}` : ''}`);
    }
    console.log('\n  npm run deliveries -- --dry <id>    to parse one without touching anything\n');
    process.exit(0);
  }

  const found = await deliveries.body(target);
  if (!found) {
    console.error(`\n  No delivery stored for ${target}. Try it without arguments to see what there is.\n`);
    process.exit(1);
  }

  const payload: unknown = JSON.parse(found.body);

  if (shapeId) {
    console.log(`\n  ${found.event ?? 'no event header'}\n`);
    console.log(`  ${shapeOf(payload)}\n`);
    process.exit(0);
  }

  if (dryId) {
    // Parse only. Nothing here writes, sends, or decides anything about a week.
    const { toTranscript } = await import('./webhook/speechify.ts');
    try {
      const t = toTranscript(payload);
      console.log(`\n  ✓ parsed`);
      console.log(`    conversation  ${t.providerCallId}`);
      console.log(`    duration      ${t.durationMs} ms`);
      console.log(`    ended         ${t.endedReason ?? '—'}`);
      console.log(`    turns         ${t.turns.length} (${t.turns.filter((x) => x.speaker === 'caller').length} theirs)`);
      console.log('\n  Nothing was written. Use --replay to settle it for real.\n');
    } catch (e) {
      if (!(e instanceof UnreadablePayload)) throw e;
      console.log(`\n  ✕ ${e.message}\n`);
      console.log(`  ${shapeOf(payload)}\n`);
      process.exit(1);
    }
    process.exit(0);
  }

  const deps: LoopDeps = {
    store,
    scheduler: new Scheduler(store.raw),
    // Nothing in settle dials, and a replay that could would be a replay that
    // rings somebody about a call from last Tuesday. Made impossible rather
    // than merely unused — this file also stopped compiling honestly the moment
    // the real constructor grew an argument, since every parameter is a string.
    agent: {
      placeCall: () => {
        throw new Error('a replay never places a call');
      },
      conversation: () => {
        throw new Error('a replay never calls the platform');
      },
    } as unknown as LoopDeps['agent'],
    mailer: { send: async () => undefined },
    sms: { send: async () => undefined },
    script: loadScript(),
  };
  // No mailer and no SMS: replaying a call from last Tuesday must not text
  // somebody about it today. The database work is the part being tested.
  const out = await settleConversation(payload, deps, found.event ?? undefined);
  console.log(`\n  ${JSON.stringify(out)}\n`);
  console.log('  Recap and SMS were stubbed out — replay writes, it does not send.\n');
} finally {
  await store.close();
}
