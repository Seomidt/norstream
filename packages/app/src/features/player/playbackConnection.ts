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
  // Bevar tidsmaalet, men stop hentningen ved byte-budgettet paa Android.
  // Med tidsprioritet ignoreres stoerrelsesgraensen indtil alle 90 sekunder
  // er hentet; en hoej bitrate kan dermed presse appens Java-hukommelse.
  maxBufferBytes: 64 * 1024 * 1024,
  prioritizeTimeOverSizeThreshold: false,
};

export class PlaybackConnection {
  private generation = 0;
  private tail: Promise<void> = Promise.resolve();
  private loaded = false;
  private replaced = false;
  private ready = false;
  private seekApplied = false;
  private seekConfirmed = false;
  private failed = false;
  private expectedUri: string | null = null;
  private seekSeconds = 0;
  private wantsPlay = true;
  private started = false;
  private disposed = false;
  private preparation: {
    resolve: () => void;
    reject: (error: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;

  constructor(private readonly player: PlaybackPort) {}

  setPlayingIntent(playing: boolean): void {
    this.wantsPlay = playing;
  }

  get active(): boolean {
    return !this.disposed && !this.failed && this.loaded && this.replaced && this.ready && this.seekConfirmed;
  }

  get committed(): boolean {
    return !this.disposed && !this.failed && this.loaded && this.replaced;
  }

  get seeking(): boolean {
    return this.seekSeconds > 0 && !this.seekConfirmed;
  }

  /** Kun fase-navne, aldrig en kilde-URL eller en native fejlbesked. */
  get preparationPhase(): string {
    if (!this.replaced) return 'kildeskift';
    if (!this.loaded) return 'metadata';
    if (!this.ready) return 'buffer';
    if (!this.seekConfirmed) return 'spoling';
    return 'klar';
  }

  /** Hver anmodning er ny, ogsaa naar den skal genindlaese samme URL. */
  load(source: VideoSource, archive: boolean, seekSeconds = 0, wantsPlay = true): Promise<void> {
    this.finishPreparation();
    const generation = ++this.generation;
    this.loaded = false;
    this.replaced = false;
    this.ready = false;
    this.seekApplied = false;
    this.seekConfirmed = false;
    this.failed = false;
    this.started = false;
    this.expectedUri = uriOf(source);
    this.seekSeconds = Math.max(0, Number.isFinite(seekSeconds) ? seekSeconds : 0);
    this.wantsPlay = wantsPlay;
    // replaceAsync paa Android afslutter kun prepare()-kaldet. Det lover
    // hverken nye spor, en seek-map eller en faerdig buffer. Vent paa begge
    // native haendelser, og afgraens ogsaa ventetid uden statusChange.
    const prepared = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (generation !== this.generation || this.disposed) return;
        this.failed = true;
        this.finishPreparation(new Error(`preparation-timeout:${this.preparationPhase}`));
      }, archive ? 30_000 : 8000);
      this.preparation = { resolve, reject, timer };
    });
    const run = async (): Promise<void> => {
      if (this.disposed || this.failed || generation !== this.generation) return;
      this.player.pause();
      this.player.bufferOptions = archive ? ARCHIVE_BUFFER : LIVE_BUFFER;
      // Android frigiver den gamle MediaSource foer den nye forberedes.
      // iOS' asynkrone forberedelse afsluttes foer naeste replace starter.
      await this.player.replaceAsync(source);
      if (this.disposed || this.failed || generation !== this.generation) return;
      this.replaced = true;
      this.prepareIfReady();
    };
    const operation = this.tail.then(run);
    // Et mislykket kald maa ikke blokere alle efterfoelgende genforsoeg.
    this.tail = operation.catch((error: unknown) => {
      if (generation === this.generation) {
        this.failed = true;
        this.finishPreparation(error);
      }
    });
    // Metadata-ventetiden maa ikke blokere koeen for et nyt zap eller retry.
    // Selve native replace-kaldene er stadig serialiseret.
    return Promise.all([operation, prepared]).then(() => undefined);
  }

  sourceLoaded(source: VideoSource | null): boolean {
    if (this.disposed || this.failed || this.expectedUri === null || uriOf(source) !== this.expectedUri) return false;
    this.loaded = true;
    this.prepareIfReady();
    return true;
  }

  status(status: string): void {
    this.ready = status === 'readyToPlay';
    if (status === 'error' && this.preparation !== null) {
      this.failed = true;
      this.finishPreparation(new Error('native-preparation-error'));
      return;
    }
    this.prepareIfReady();
  }

  /** Spoletid er foerst brugt, naar den nye kilde faktisk naaede dertil.
   * Interval-haendelser fra en gammel kilde eller under indlaesning ignoreres. */
  position(seconds: number): boolean {
    if (!this.loaded || !this.replaced || !this.ready || !this.seekApplied || this.failed || this.disposed || !Number.isFinite(seconds)) return false;
    // Tiden i en allerede koesat haendelse kan tilhoere foer seek/skift.
    if (Math.abs(seconds - this.player.currentTime) > 2) return false;
    if (!this.seekConfirmed) {
      if (seconds < this.seekSeconds - 1 || seconds > this.seekSeconds + 10) return false;
      this.seekConfirmed = true;
      this.startIfWanted();
    }
    return true;
  }

  private prepareIfReady(): void {
    if (this.disposed || this.failed || this.seekApplied || !this.replaced || !this.loaded || !this.ready) return;
    try {
      // Praecis én gang, efter DEN NYE kildes metadata og foerste buffer.
      // Afspilleren er pauset indtil en frisk position bekraefter seek.
      this.seekApplied = true;
      this.player.currentTime = this.seekSeconds;
      this.seekConfirmed = this.seekSeconds === 0;
      if (this.seekConfirmed) this.startIfWanted();
      this.finishPreparation();
    } catch (error: unknown) {
      this.failed = true;
      this.finishPreparation(error);
    }
  }

  private finishPreparation(error?: unknown): void {
    const pending = this.preparation;
    if (pending === null) return;
    this.preparation = null;
    clearTimeout(pending.timer);
    if (error === undefined) pending.resolve();
    else pending.reject(error);
  }

  private startIfWanted(): void {
    if (!this.wantsPlay || this.started || this.disposed) return;
    this.started = true;
    this.player.play();
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.finishPreparation();
  }

  /** Reacts effect-cleanup og hurtige zap afviser gamle promises. En ny
   * load er stadig tilladt, ogsaa efter Strict Modes kontrol-mount. */
  cancel(): void {
    this.generation += 1;
    this.finishPreparation();
    this.loaded = false;
    this.replaced = false;
    this.ready = false;
    this.seekApplied = false;
    this.seekConfirmed = false;
    this.started = false;
    this.expectedUri = null;
  }
}

function uriOf(source: VideoSource | null): string | null {
  return typeof source === 'string' ? source : typeof source === 'object' && source !== null ? source.uri ?? null : null;
}
