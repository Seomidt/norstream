import type { BufferOptions, VideoSource } from 'expo-video';

/** En enkelt native afspiller. Kildeskift serialiseres, og gammel klargoering
 * maa hverken starte en forladt kanal eller bruge et nyt arkivs spoletid. */
export interface PlaybackPort {
  replaceAsync(source: VideoSource): Promise<void>;
  pause(): void;
  play(): void;
  currentTime: number;
  bufferOptions: BufferOptions;
}

export const LIVE_BUFFER: BufferOptions = {
  preferredForwardBufferDuration: 20,
  minBufferForPlayback: 1,
  prioritizeTimeOverSizeThreshold: true,
};
export const ARCHIVE_BUFFER: BufferOptions = {
  preferredForwardBufferDuration: 90,
  minBufferForPlayback: 5,
  prioritizeTimeOverSizeThreshold: true,
};

export class PlaybackConnection {
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();
  private loaded = false;
  private replaced = false;
  private ready = false;
  private seekConfirmed = false;
  private expectedUri: string | null = null;
  private seekSeconds = 0;
  private wantsPlay = true;
  private disposed = false;

  constructor(private readonly player: PlaybackPort) {}

  setPlayingIntent(playing: boolean): void {
    this.wantsPlay = playing;
  }

  get active(): boolean {
    return !this.disposed && this.loaded && this.replaced && this.ready && this.seekConfirmed;
  }

  get committed(): boolean {
    return !this.disposed && this.loaded && this.replaced;
  }

  /** Hver anmodning er ny, ogsaa naar den skal genindlaese samme URL. */
  load(source: VideoSource, archive: boolean, seekSeconds = 0, wantsPlay = true): Promise<void> {
    const generation = ++this.generation;
    this.loaded = false;
    this.replaced = false;
    this.ready = false;
    this.seekConfirmed = false;
    this.expectedUri = uriOf(source);
    this.seekSeconds = Math.max(0, Number.isFinite(seekSeconds) ? seekSeconds : 0);
    this.wantsPlay = wantsPlay;
    const run = async (): Promise<void> => {
      if (this.disposed || generation !== this.generation) return;
      this.player.pause();
      this.player.bufferOptions = archive ? ARCHIVE_BUFFER : LIVE_BUFFER;
      // Android frigiver den gamle MediaSource foer den nye forberedes.
      // iOS' asynkrone forberedelse afsluttes foer naeste replace starter.
      await this.player.replaceAsync(source);
      if (this.disposed || generation !== this.generation) return;
      this.replaced = true;
      // Seek saettes FOER play, ikke i en ready-haendelse fra den gamle kilde.
      this.player.currentTime = this.seekSeconds;
      this.seekConfirmed = this.seekSeconds === 0;
      if (this.wantsPlay) this.player.play();
    };
    const operation = this.tail.then(run);
    // Et mislykket kald maa ikke blokere alle efterfoelgende genforsoeg.
    this.tail = operation.catch(() => undefined);
    return operation;
  }

  sourceLoaded(source: VideoSource | null): void {
    if (this.disposed || this.expectedUri === null || uriOf(source) !== this.expectedUri) return;
    this.loaded = true;
  }

  status(status: string): void {
    this.ready = status === 'readyToPlay';
  }

  /** Spoletid er foerst brugt, naar den nye kilde faktisk naaede dertil.
   * Interval-haendelser fra en gammel kilde eller under indlaesning ignoreres. */
  position(seconds: number): boolean {
    if (!this.loaded || !this.replaced || !this.ready || this.disposed || !Number.isFinite(seconds)) return false;
    if (!this.seekConfirmed) {
      if (seconds < this.seekSeconds - 1 || seconds > this.seekSeconds + 10) return false;
      this.seekConfirmed = true;
    }
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
  }

  /** Reacts effect-cleanup og hurtige zap afviser gamle promises. En ny
   * load er stadig tilladt, ogsaa efter Strict Modes kontrol-mount. */
  cancel(): void {
    this.generation += 1;
    this.loaded = false;
    this.replaced = false;
    this.ready = false;
    this.seekConfirmed = false;
    this.expectedUri = null;
  }
}

function uriOf(source: VideoSource | null): string | null {
  return typeof source === 'string' ? source : typeof source === 'object' && source !== null ? source.uri ?? null : null;
}
