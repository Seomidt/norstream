/** Genforsoeg tilhoerer afspilningen, ikke den skiftende arkiv-URL. */
export class PlaybackRecovery {
  private attempts = 0;
  private stableSeconds = 0;
  private last: { position: number; now: number } | null = null;
  private endPosition: number | null = null;
  private emptyEnds = 0;

  constructor(private readonly maxAttempts = 2) {}

  reset(): void {
    this.attempts = 0;
    this.stableSeconds = 0;
    this.last = null;
    this.endPosition = null;
    this.emptyEnds = 0;
  }

  /** Et seek eller readyToPlay er ikke fremdrift. Kun sammenhaengende,
   * normal afspilning i ti sekunder giver en ny genforsoegsbudget. */
  position(position: number, now: number, playing: boolean): boolean {
    if (!Number.isFinite(position) || !Number.isFinite(now)) return false;
    const previous = this.last;
    this.last = { position, now };
    if (!playing || previous === null) {
      this.stableSeconds = 0;
      return false;
    }
    const delta = position - previous.position;
    const elapsed = (now - previous.now) / 1000;
    if (delta <= 0 || elapsed <= 0 || elapsed > 4 || delta > elapsed + 1) {
      this.stableSeconds = 0;
      return false;
    }
    this.stableSeconds += Math.min(delta, elapsed);
    if (this.stableSeconds >= 10) {
      this.attempts = 0;
      this.emptyEnds = 0;
    }
    return true;
  }

  beginLoad(): void {
    this.last = null;
    this.stableSeconds = 0;
  }

  failure(): { attempt: number; retry: boolean } {
    this.stableSeconds = 0;
    const attempt = ++this.attempts;
    return { attempt, retry: attempt <= this.maxAttempts };
  }

  /** 42 sekunder efter et seek til 42 er nul nye sekunder, ikke 42.
   * To tomme fortsaettelser maa derfor ikke starte den samme sløjfe igen. */
  ended(absoluteSeconds: number): boolean {
    if (this.endPosition !== null && absoluteSeconds <= this.endPosition + 1) this.emptyEnds += 1;
    else this.emptyEnds = 0;
    this.endPosition = absoluteSeconds;
    return this.emptyEnds < 2;
  }
}
