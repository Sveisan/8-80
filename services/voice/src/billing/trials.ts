import { log } from '../log.ts';
import { PostgresStore } from '../store/postgres.ts';
import type { LoopDeps } from '../loop/deps.ts';
import { checkoutLink, composeTrialEnded } from './notice.ts';

/**
 * Free months that have run out.
 *
 * The calls have already stopped by the time this runs — `claimDue` reads the
 * trial date directly, so nothing has to move for somebody to stop being rung.
 * This exists only to tell them, which is the part that would otherwise be a
 * silence: a weekly call that simply stops arriving, from a product whose
 * whole claim is that it turns up.
 *
 * One email each, ever. `expireTrials` flips the status in the same statement
 * that selects the row, so two sweeps cannot both claim the same person.
 */
export async function expireTrials(deps: LoopDeps, now = new Date()): Promise<number> {
  const store = deps.store;
  if (!(store instanceof PostgresStore)) return 0;

  const done = await store.expireTrials(now);
  let told = 0;
  for (const { phoneHash } of done) {
    try {
      const phone = await store.phoneFor(phoneHash);
      if (!phone) continue;
      const caller = await store.load(phone);
      if (!caller.email) continue;

      const letter = composeTrialEnded(deps.script, checkoutLink(phoneHash, caller.email));
      if (!letter) continue;
      await deps.mailer.send(caller.email, letter);
      told++;
    } catch (e) {
      // The status is already flipped, so a failed email is a person who is
      // not being called and has not been told why. That is worth a loud log
      // and is not worth failing the sweep for everybody else.
      log('trial.notice_failed', { reason: (e as Error).message });
    }
  }
  if (done.length) log('trial.ended', { count: done.length, told });
  return done.length;
}
