/**
 * How often one client may ask us to send a text.
 *
 * In memory, because the control plane is one process and a Redis for this
 * would be a second thing to run and keep alive for a counter that may be
 * wrong after a restart without anybody being harmed.
 *
 * Two windows, because they stop different things. Per number stops somebody
 * being texted repeatedly by a form — the attack that costs a stranger their
 * evening. Per client stops one script enumerating numbers — the attack that
 * costs us a phone bill.
 */
export class Limiter {
  private readonly seen = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** True if this one is allowed, and it counts against the window. */
  take(key: string, now = Date.now()): boolean {
    const since = now - this.windowMs;
    const hits = (this.seen.get(key) ?? []).filter((t) => t > since);
    if (hits.length >= this.max) {
      this.seen.set(key, hits);
      return false;
    }
    hits.push(now);
    this.seen.set(key, hits);
    // Cheap sweep: the map only grows while somebody is actively trying, and
    // an unbounded map on a public endpoint is its own denial of service.
    if (this.seen.size > 10_000) {
      for (const [k, v] of this.seen) if (!v.some((t) => t > since)) this.seen.delete(k);
    }
    return true;
  }
}
