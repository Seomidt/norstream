import type { BufferOptions, VideoSource } from 'expo-video';

/** En enkelt native afspiller. Kildeskift serialiseres, og gammel klargoering
 * maa hverken starte en forladt kanal eller bruge et nyt arkivs spoletid. */
export interface PlaybackPort {
  replaceAsync(source: VideoSource): Promise<void>;
  pause(): void;
  play(): void;
  currentTime: number;
  muted: boolean;
  playbackRate: number;
  bufferOptions: BufferOptions;
}

export const LIVE_BUFFER: BufferOptions = {
  preferredForwardBufferDuration: 20,
  minBufferForPlayback: 1,
  prioritizeTimeOverSizeThreshold: true,
};
/** Efter et udfald skal bufferen kunne absorbere mere end ét sekunders jitter. */
export const LIVE_REBUFFER: BufferOptions = { ...LIVE_BUFFER, minBufferForPlayback: 4 };
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
  private timedOut = false;
  private endedShort = false;
  private expectedUri: string | null = null;
  private seekSeconds = 0;
  private archive = false;
  private liveRebuffered = false;
  private linear = false;
  private replay = false;
  private preroll: { muted: boolean; rate: number; timer: ReturnType<typeof setInterval> } | null = null;
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
    return this.prepared && this.ready;
  }

  /** Den bekraeftede position gaelder ogsaa under senere genbuffring. */
  get prepared(): boolean {
    return !this.disposed && !this.failed && this.loaded && this.replaced && this.seekConfirmed;
  }

  get committed(): boolean {
    return !this.disposed && !this.failed && this.loaded && this.replaced;
  }

  get seeking(): boolean {
    return this.seekSeconds > 0 && !this.seekConfirmed;
  }

  get seekTimedOut(): boolean {
    return this.timedOut && this.seekApplied && !this.seekConfirmed;
  }

  /** Arkivstykket sluttede foer spoletiden blev naaet: panelet havde ikke saa meget (v424). */
  get endedBeforeSeek(): boolean {
    return this.endedShort;
  }

  /** Kun fase-navne, aldrig en kilde-URL eller en native fejlbesked. */
  get preparationPhase(): string {
    if (this.preroll !== null) return 'sekventielt overlap';
    if (!this.replaced) return 'kildeskift';
    if (!this.loaded) return 'metadata';
    if (!this.ready) return this.seekApplied && this.seekSeconds > 0 ? 'buffer efter spoling' : 'buffer';
    if (!this.seekConfirmed) return 'spoling';
    return 'klar';
  }

  /** Hver anmodning er ny, ogsaa naar den skal genindlaese samme URL. */
  load(source: VideoSource, archive: boolean, seekSeconds = 0, wantsPlay = true, linear: boolean | 'replay' = false): Promise<void> {
    this.finishPreparation();
    const generation = ++this.generation;
    this.loaded = false;
    this.replaced = false;
    this.ready = false;
    this.seekApplied = false;
    this.seekConfirmed = false;
    this.failed = false;
    this.timedOut = false;
    this.endedShort = false;
    this.started = false;
    const nextUri = uriOf(source);
    if (archive || nextUri !== this.expectedUri) this.liveRebuffered = false;
    this.expectedUri = nextUri;
    this.seekSeconds = Math.max(0, Number.isFinite(seekSeconds) ? seekSeconds : 0);
    this.archive = archive;
    this.linear = archive && linear === true;
    this.replay = archive && linear === 'replay';
    this.wantsPlay = wantsPlay;
    // replaceAsync paa Android afslutter kun prepare()-kaldet. Det lover
    // hverken nye spor, en seek-map eller en faerdig buffer. Vent paa begge
    // native haendelser, og afgraens ogsaa ventetid uden statusChange.
    const prepared = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (generation !== this.generation || this.disposed) return;
        this.failed = true;
        this.timedOut = true;
        this.finishPreparation(new Error(`preparation-timeout:${this.preparationPhase}`));
      // Live efter et udfald skal ogsaa naa 4 s buffer (LIVE_REBUFFER) inden
      // deadline; et frisk zap beholder de 8 s (v424).
      }, this.linear && this.seekSeconds > 0 ? 45_000 : archive ? 30_000 : this.liveRebuffered ? 12_000 : 8000);
      this.preparation = { resolve, reject, timer };
    });
    const run = async (): Promise<void> => {
      if (this.disposed || this.failed || generation !== this.generation) return;
      this.player.pause();
      // Native replay laeser ved behov fra byte 0 og kasserer samples uden
      // at spille overlap i 4x. Den behoever kun normal startup-buffer.
      // Andre seekbare arkiver skal have overlap i sample-koeerne FOER seek. De 90 s
      // fremadbuffer var kun et efterfoelgende maal: foerste READY kom ved
      // 5 s, og et seek til 59.946 s forlod derfor den eksisterende buffer.
      // Media3 maatte saa hente ved en TS-byteposition, som PHP-arkivet kan
      // levere forkert. Startup stiler mod overlap + 5 s, stadig med samme
      // 64 MiB loft; efter bekraeftelse bruges normal genbuffring igen.
      // v424: med oplyst varighed kan Media3 spole i sample-koeerne, saa et
      // overlap over 5 s buffres FOER seek i stedet for at blive genlaest fra
      // byte 0. Smaa spolinger og spoling 0 beholder 5 s.
      this.player.bufferOptions = archive
        ? { ...ARCHIVE_BUFFER, minBufferForPlayback: this.linear || this.seekSeconds <= 5 ? 5 : Math.min(90, this.seekSeconds + 5) }
        : this.liveRebuffered ? LIVE_REBUFFER : LIVE_BUFFER;
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
    // Et arkivstykke der melder slut mens spolingen stadig venter paa sin
    // position, indeholdt ikke spoletiden: panelets fil var kortere end
    // bestilt. Foer stod det i 30 s til deadline og brugte to genforsoeg paa
    // praecis samme minut (v424). Live har seekSeconds 0 og rammes ikke.
    if (status === 'idle' && this.archive && this.committed && this.seekApplied && !this.seekConfirmed && this.seekSeconds > 0) {
      this.failed = true;
      this.endedShort = true;
      this.finishPreparation(new Error('ended-before-seek'));
      return;
    }
    // Kun en allerede startet live-stream: foerste opstart og arkiv bevares.
    // Ingen replace(), ekstra forbindelse eller gentagne buffer-omstillinger.
    if (status === 'loading' && !this.archive && this.prepared && this.started && !this.liveRebuffered) {
      this.liveRebuffered = true;
      this.player.bufferOptions = LIVE_REBUFFER;
    }
    this.ready = status === 'readyToPlay';
    if (status === 'error') {
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
      if (this.linear && seconds < this.seekSeconds) return false;
      if (seconds < this.seekSeconds - 1 || seconds > this.seekSeconds + 10) return false;
      this.seekConfirmed = true;
      try {
        this.restorePreroll();
        this.restoreBuffer();
        this.startIfWanted();
        this.finishPreparation();
      } catch (error: unknown) {
        this.failed = true;
        this.finishPreparation(error);
        return false;
      }
    }
    return true;
  }

  private prepareIfReady(): void {
    if (this.disposed || this.failed || this.seekApplied || !this.replaced || !this.loaded || !this.ready) return;
    try {
      // Praecis én gang, efter DEN NYE kildes metadata og foerste buffer.
      // Afspilleren er pauset indtil en frisk position bekraefter seek.
      this.seekApplied = true;
      if (this.linear && this.seekSeconds > 0) {
        // Laes det korte minut-overlap i raekkefoelge. Intet seekTo() og
        // dermed ingen ny Range-anmodning til en gaettet TS-byteposition.
        const muted = this.player.muted;
        const rate = this.player.playbackRate;
        const timer = setInterval(() => {
          try { this.position(this.player.currentTime); }
          catch (error: unknown) { this.failed = true; this.finishPreparation(error); }
        }, 50);
        this.preroll = { muted, rate, timer };
        this.player.muted = true;
        this.player.playbackRate = 4;
        this.player.play();
        return;
      }
      if (!this.linear) this.player.currentTime = this.seekSeconds;
      this.seekConfirmed = this.seekSeconds === 0;
      if (this.seekConfirmed) {
        this.restoreBuffer();
        this.startIfWanted();
        this.finishPreparation();
      }
      // Positivt seek har samme absolutte deadline som metadata og buffer.
      // READY foer seek maa ikke afslutte ventetiden eller starte en 8 s retry.
    } catch (error: unknown) {
      this.failed = true;
      this.finishPreparation(error);
    }
  }

  private restorePreroll(): void {
    const previous = this.preroll;
    if (previous === null) return;
    this.preroll = null;
    clearInterval(previous.timer);
    // Oprydning maa ikke kaste fra timeout eller unmount hvis native er vaek.
    try { this.player.pause(); } catch { /* Frigivet afspiller. */ }
    try { this.player.playbackRate = previous.rate; } catch { /* Frigivet afspiller. */ }
    try { this.player.muted = previous.muted; } catch { /* Frigivet afspiller. */ }
  }

  private finishPreparation(error?: unknown): void {
    this.restorePreroll();
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

  private restoreBuffer(): void {
    if (this.archive) this.player.bufferOptions = ARCHIVE_BUFFER;
  }

  /**
   * Slip kilden helt, i koe efter et eventuelt igangvaerende kildeskift (v424).
   * Appen i baggrunden holdt foer forbindelsen aaben med en pauset afspiller;
   * paa et panel med én forbindelse spaerrede den for alle andre enheder.
   */
  release(): Promise<void> {
    this.cancel();
    const operation = this.tail.then(() => this.player.replaceAsync(null));
    this.tail = operation.catch(() => undefined);
    return this.tail;
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
