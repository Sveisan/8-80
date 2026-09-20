import { loadScript } from './script.ts';
import { composeRecap } from './recap/compose.ts';
import { openMailer, FileMailer } from './recap/mailer.ts';

/**
 * npm run recap                        — compose a sample recap and print it
 * npm run recap -- --to you@example.com  — and actually send it
 *
 * Because finding out whether email works should not cost a phone call. The
 * recap only goes out after a call that reached a commitment, so the first
 * honest test of a Resend key was: book a call, answer it, have a real
 * twenty-minute conversation, and then check an inbox.
 *
 * This runs the real path — the same composer, the same mailer the loop would
 * pick — so a key that works here works there. The only thing invented is the
 * outcome, which is stated in the email so nobody mistakes it for a real one.
 */
const args = process.argv.slice(2);
const flag = args.includes('--to') ? args[args.indexOf('--to') + 1] : undefined;
// A bare `--to` followed by another flag is a typo, not an address.
const to = flag && !flag.startsWith('--') ? flag : '';

const recap = composeRecap(
  {
    at: new Date().toISOString(),
    durationMs: 11 * 60_000,
    commitment: 'a test of the recap email, which is not a commitment anybody made',
    day: 'Wednesday',
  },
  loadScript(),
  { nextSlot: 'Friday at 08:30' },
);

console.log('\n─'.repeat(1) + '─'.repeat(71));
console.log(`Subject: ${recap.subject}`);
console.log('─'.repeat(72));
console.log(recap.body);
console.log('─'.repeat(72) + '\n');

if (!to) {
  console.log('  Nothing sent. Add --to <address> to send it for real.\n');
  process.exit(0);
}

const mailer = openMailer();
if (mailer instanceof FileMailer) {
  // Saying "sent" here, when it went to a file, is the failure this whole
  // command exists to catch.
  console.error('  ✕ No mailer is configured, so this was written to runs/mail/ instead of sent.');
  console.error('    RESEND_API_KEY and RECAP_FROM_ADDRESS both have to be set. See npm run preflight.\n');
  process.exit(1);
}

try {
  await mailer.send(to, recap);
  console.log(`  ✓ Accepted by the provider. If it does not arrive, the problem is delivery, not configuration.\n`);
} catch (e) {
  console.error(`  ✕ ${(e as Error).message}\n`);
  process.exit(1);
}
