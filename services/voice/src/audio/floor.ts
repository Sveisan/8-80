/**
 * The line's own noise, measured rather than assumed.
 *
 * A fixed speech threshold works in a quiet room and nowhere else. In a café,
 * on a street, in a car, the background sits above it — so the detector hears
 * continuous speech, never finds a silence, and the turn never ends. The most
 * patient endpointer in the world cannot save a call where the line is never
 * quiet.
 *
 * So the floor is tracked as the quietest energy seen recently, and speech is
 * whatever rises clearly above it. A caller in a noisy place gets the same
 * turn-taking as one at a kitchen table.
 */
export class NoiseFloor {
  /** Above this, on a telephone, it is a voice and not a room. */
  private static readonly CLEARLY_SPEECH = 0.15;

  private readonly window: number[] = [];
  private readonly size: number;
  private readonly base: number;

  /** `windowFrames` at 20ms per frame: 100 frames is two seconds of history. */
  constructor(base: number, windowFrames = 100) {
    this.base = base;
    this.size = windowFrames;
  }

  /** The current noise floor: the quietest recent frame. */
  get floor(): number {
    if (this.window.length === 0) return 0;
    return Math.min(...this.window);
  }

  /**
   * The energy speech must exceed. Never below the configured threshold — a
   * silent line must not turn a breath into a turn — and lifted clear of a
   * noisy one.
   */
  get threshold(): number {
    return Math.max(this.base, this.floor * 3 + 0.004);
  }

  /**
   * One frame. Returns whether it carries speech.
   *
   * Frames at unmistakable speech level never enter the history: otherwise
   * someone talking without a gap becomes their own noise floor, and the line
   * goes deaf exactly while they are talking most. Background, by definition,
   * lives below this.
   */
  observe(rms: number): boolean {
    const speaks = rms >= this.threshold;
    if (rms < NoiseFloor.CLEARLY_SPEECH) {
      this.window.push(rms);
      if (this.window.length > this.size) this.window.shift();
    }
    return speaks;
  }
}
