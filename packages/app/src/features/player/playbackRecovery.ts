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

/** Korte live-forbindelser kan se raske ud i ti sekunder og alligevel ende
 * hvert minut. Denne historik overlever det normale genforsoegsbudget. */
export class LivePlaybackHealth {
  private failures: number[] = [];
  private first: { position: number; now: number } | null = null;
  private last: { position: number; now: number } | null = null;
  private stableSeconds = 0;
  private recorded = false;
  private playedSeconds = 0;

  reset(): void { this.failures = []; this.beginLoad(); }
  beginLoad(): void {
    this.first = null; this.last = null; this.stableSeconds = 0; this.playedSeconds = 0; this.recorded = false;
  }
  /** Pause/baggrund er ikke et kort provider-EOF. */
  suspend(): void { this.first = null; this.last = null; this.stableSeconds = 0; this.playedSeconds = 0; }
  ready(position: number, now: number): void {
    if (this.first === null && Number.isFinite(position) && position >= 0 && Number.isFinite(now)) this.first = { position, now };
  }
  position(position: number, now: number, playing: boolean): void {
    if (!playing) return;
    if (!Number.isFinite(position) || position < 0 || !Number.isFinite(now)) return;
    this.ready(position, now);
    const previous = this.last;
    this.last = { position, now };
    if (previous === null) return;
    const elapsed = (now - previous.now) / 1000;
    const delta = position - previous.position;
    if (elapsed <= 0 || elapsed > 4 || delta <= 0 || delta > elapsed + 1) { this.stableSeconds = 0; return; }
    this.stableSeconds += Math.min(delta, elapsed);
    this.playedSeconds += Math.min(delta, elapsed);
    if (this.stableSeconds >= 180) this.failures = [];
  }
  /** Én observation per load: idle og EOF fra samme kilde taelles kun én gang. */
  failure(reason: string, _position: number, now: number): { shortEnds: number; escalate: boolean } {
    this.failures = this.failures.filter(at => now >= at && now - at <= 10 * 60_000);
    if (!this.recorded && (reason === 'eof' || reason === 'idle') && this.first !== null) {
      const elapsed = (now - this.first.now) / 1000;
      // EOF kan nulstille native uret til nul. Kun allerede bekraeftede,
      // normale positionsdeltaer taeller; et enkelt PTS-spring er ikke nok.
      const progressed = this.playedSeconds;
      if (progressed >= 10 && elapsed >= 10 && elapsed <= 120 && progressed <= elapsed + 2) {
        this.recorded = true;
        this.failures.push(now);
      }
    }
    return { shortEnds: this.failures.length, escalate: this.failures.length >= 2 };
  }
}
