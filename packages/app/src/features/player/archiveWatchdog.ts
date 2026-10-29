/** Raa native fejl kan indeholde kodeord i URI; kun faste kategorier logges. */
export function playbackFailureKind(message: string | undefined): string {
  if (message === undefined) return 'ukendt';
  if (/discontinuity|timestamp/i.test(message)) return 'tidsstempel';
  if (/decoder|codec|mediacodec/i.test(message)) return 'dekoder';
  if (/response code[ :=]+(?:401|403)|http (?:401|403)/i.test(message)) return 'adgang afvist';
  if (/response code[ :=]+404|http 404/i.test(message)) return 'arkiv/kilde mangler';
  if (/timeout|network|connection|socket|http|source error/i.test(message)) return 'netvaerk/kilde';
  return 'ukendt';
}

/** Ekstra native felter findes paa Android fra v380. Aldrig raa tekst/URI. */
export function nativeFailureDetails(error: unknown): string {
  if (typeof error !== 'object' || error === null) return 'kode ?, type ?';
  const data = error as { errorCode?: unknown; errorType?: unknown };
  const code = typeof data.errorCode === 'number' && Number.isInteger(data.errorCode) && data.errorCode >= 0 && data.errorCode <= 10_000 ? data.errorCode : '?';
  const type = typeof data.errorType === 'number' && Number.isInteger(data.errorType) && data.errorType >= 0 && data.errorType <= 3 ? data.errorType : '?';
  return `kode ${code}, type ${type}`;
}

/** Native uret afgoer om en stream staar stille, ikke koesatte JS-haendelser. */
export function playbackClock(eventPosition: number, nativePosition: number, active: boolean): number {
  return active && Number.isFinite(nativePosition) && nativePosition >= 0 ? nativePosition : eventPosition;
}

/** READY og playing kan skifte flere gange i sekundet ved en tom TS-buffer.
 * Kun reel native fremdrift, pause eller kildeskift nulstiller denne vagt. */
export class ArchiveWatchdog {
  private anchor: { position: number; now: number } | null = null;
  private fired = false;

  constructor(private readonly timeoutMs: number) {}

  reset(): void {
    this.anchor = null;
    this.fired = false;
  }

  stalled(position: number, now: number, expected: boolean): boolean {
    if (!expected || !Number.isFinite(position) || position < 0 || !Number.isFinite(now)) {
      this.reset();
      return false;
    }
    const previous = this.anchor;
    // Smal tidsstempeljitter taeller ikke som nye billeder. Bevaegelsen
    // maales fra ankeret, saa langsom men vedvarende fremdrift stadig ses.
    if (previous === null || now < previous.now || Math.abs(position - previous.position) >= 0.25) {
      this.anchor = { position, now };
      this.fired = false;
      return false;
    }
    if (this.fired || now - previous.now < this.timeoutMs) return false;
    this.fired = true;
    return true;
  }
}

/** Et fremadgaaende lydur maa ikke flytte resume forbi det sidste billede. */
export class ArchiveVideoClock {
  private rendered: number | null = null;
  private seconds = 0;
  private maximum = Number.POSITIVE_INFINITY;
  private pendingSeek: number | null = null;
  reset(seconds: number, maximum = Number.POSITIVE_INFINITY): void {
    this.rendered = null;
    this.seconds = seconds;
    this.maximum = maximum;
    this.pendingSeek = null;
  }
  get hasFrames(): boolean { return this.rendered !== null; }
  get position(): number { return this.seconds; }
  get seekTarget(): number | null { return this.pendingSeek; }
  /** Native seekBy er asynkront: gamle samples maa ikke ophaeve et tilbage-seek. */
  requestSeek(seconds: number): void { this.pendingSeek = seconds; }
  cancelSeek(): void { this.pendingSeek = null; }
  private confirmSeek(seconds: number): boolean {
    if (this.pendingSeek === null) return true;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > this.maximum + 2 || Math.abs(seconds - this.pendingSeek) > 2) return false;
    this.pendingSeek = null;
    this.seconds = seconds;
    this.rendered = null;
    return true;
  }
  private advance(seconds: number): void {
    // Native EOF kan nulstille uret. En TS-PTS-vaerdi maa heller ikke
    // ligne fremdrift flere timer uden for det bestilte arkivstykke.
    if (Number.isFinite(seconds) && seconds >= this.seconds && seconds <= this.maximum + 2) this.seconds = seconds;
  }
  /** Uden brugbare billedmaalinger bruges det bekraeftede native ur.
   * Ved EOF tillades hoejst to sekunders hale efter sidste billedhaendelse. */
  read(seconds: number, ended = false): number {
    if (!this.confirmSeek(seconds)) return this.seconds;
    if (!this.hasFrames || (ended && seconds <= this.seconds + 2)) this.advance(seconds);
    return this.seconds;
  }
  observe(seconds: number, rendered: unknown): number {
    if (!Number.isFinite(seconds) || seconds < 0) return this.seconds;
    if (!this.confirmSeek(seconds)) return this.seconds;
    if (typeof rendered !== 'number' || !Number.isSafeInteger(rendered) || rendered < 0) return this.read(seconds);
    if (rendered > 0 && (this.rendered === null || rendered > this.rendered)) this.advance(seconds);
    // Nul er ogsaa standardvaerdien naar native ikke leverer taelleren.
    // Den bliver foerst autoritet efter mindst ét faktisk vist billede.
    if (rendered > 0 || this.rendered !== null) this.rendered = rendered;
    else this.advance(seconds);
    return this.seconds;
  }
}
