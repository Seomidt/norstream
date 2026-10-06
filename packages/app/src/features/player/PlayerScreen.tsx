import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { SubtitleTrack } from 'expo-video';
import { buildTimeshiftUrl, detectTimeshiftDialect } from '@norstream/core';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { listChannels } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { getNowNext } from '../../storage/programmes.js';
import {
  getPanelOffsetMinutes,
  getSubtitlePreference,
  getTimeshiftDialect,
  setTimeshiftDialect,
} from '../../storage/settings.js';
import type { SubtitlePreference } from '../../storage/settings.js';
import { ensureEpg } from '../../sync/epgCache.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { liveUrlFor } from '../../sources/access.js';
import { streamSource } from '../../net/doh.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { setLastChannelId } from '../../storage/settings.js';
import { recordChannelWatch, saveArchiveProgress } from '../../storage/history.js';
import { archiveContinuation, archiveWindow } from './archiveContinuation.js';
import { PlaybackConnection } from './playbackConnection.js';
import { PlaybackRecovery } from './playbackRecovery.js';
import { clockOf, logEvent } from '../../diagnostics/log.js';
import { FALLBACK_FORMAT, formatForPlatform, hasFormatFallback, surfaceTypeForPlatform } from './format.js';
import { restartBlockFor, restartHint } from './restart.js';
import { TrackPicker } from './TrackPicker.js';
import { ChannelOverlay } from './ChannelOverlay.js';
import { LandscapePlayer, useLandscape } from './Landscape.js';
import { isRadioKey } from '../../sync/radioBrowser.js';
import { RadioView } from './RadioView.js';
import { useSaveSong } from '../radio/useSaveSong.js';
import { useRadioNowPlaying } from './useRadioNowPlaying.js';
import type { RadioState } from './RadioView.js';
import { pickPreferredSubtitle, sameTrack, trackName } from './tracks.js';
import type { RestartBlock } from './restart.js';
import { SeekButtons } from './SeekButtons.js';

interface Props {
  session: AppSession;
  channel: StoredChannel;
  onBack: () => void;
  /**
   * Programmet der skal afspilles fra begyndelsen. Saettes af guiden, hvor
   * start-forfra har sit synlige hjem: man trykker paa et afsluttet program,
   * ikke paa en knap man skal vide findes.
   */
  startFrom?: Programme;
  /**
   * Listen kanalen stod i, til at zappe op og ned uden at gaa tilbage.
   * Uden den er der ingen pile.
   */
  zap?: StoredChannel[];
  /** Forsidens "Fortsaet": spol hertil naar arkivstreamen er klar. */
  resumeAtSeconds?: number;
}

const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1500;
/** Hvor laenge afspilleren maa haenge i buffering MIDT i afspilningen foer vi
 *  kalder det et udfald og genforbinder. Laengere, saa en kort genbuffring
 *  ikke river billedet ned. */
const STALL_TIMEOUT_MS = 15_000;
/** Live maa genforbinde hurtigt; arkivets foerste seek faar laengere tid. */
const INITIAL_STALL_TIMEOUT_MS = 8000;
/** Arkivets foerste buffer og seek skal naa at blive klar foer genforbindelse. */
const ARCHIVE_INITIAL_TIMEOUT_MS = 30_000;
/** Frosset billede: hvor tit positionen tjekkes, og hvor laenge den maa staa stille foer der genforbindes (v353). */
const FROZEN_CHECK_MS = 3000;
const FROZEN_AFTER_MS = 12_000;

export function PlayerScreen({
  session,
  channel: initialChannel,
  onBack,
  startFrom: initialStartFrom,
  zap,
  resumeAtSeconds,
}: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const landscape = useLandscape();
  /**
   * Kanalen der spilles. Begynder som den man kom med, og skifter naar man
   * zapper: samme skaerm, samme afspiller, ny stream — saa panelets ene
   * forbindelse slippes og tages igen ét sted, ikke gennem en ny skaerm.
   */
  const [channel, setChannel] = useState(initialChannel);
  /** Start-forfra gaelder kun den kanal man kom med; et zap er altid direkte. */
  const [startFrom, setStartFrom] = useState(initialStartFrom);
  /** Kanalen foer sidste zap, til ⇄ mellem kampen og nyhederne. */
  const [previous, setPrevious] = useState<StoredChannel | null>(null);
  /** Banneret efter et zap: navn og nu-titel, i tre sekunder. */
  const [bannerUntil, setBannerUntil] = useState(0);
  // Uden den ligger Tilbage-knappen under telefonens navigationslinje.
  const insets = useSafeAreaInsets();
  /**
   * Null indtil arkiv-URLen er bygget, naar afspilningen kommer fra guiden.
   *
   * Panelet tillader én samtidig forbindelse. Startede vi paa live-URLen og
   * skiftede bagefter, ville arkiv-streamen bede om forbindelse nummer to og
   * blive afvist — af den stream vi selv lige havde aabnet.
   */
  const access = session.access(channel.sourceId);
  const [streamRequest, setStreamRequest] = useState(() => ({
    uri: startFrom !== undefined ? null : liveUrlFor(access, channel, formatForPlatform()),
    revision: 0,
  }));
  const source = streamRequest.uri;
  const sourceRevision = streamRequest.revision;
  const changingSource = useRef(false);
  const archiveRequest = useRef(0);
  const preparingArchive = useRef(false);
  const startFromHandled = useRef(false);
  const recovery = useRef(new PlaybackRecovery(MAX_RETRIES));
  const cancelPendingRetry = useRef<() => void>(() => undefined);
  const nativeFailure = useRef<() => void>(() => undefined);
  const playbackStatus = useRef<(status: string) => void>(() => undefined);
  const playIntent = useRef(true);
  const refreshArchiveEnd = useRef<() => void>(() => undefined);
  const requestSource = useCallback((uri: string | null): void => {
    changingSource.current = true;
    // En fejl kan kraeve en ny indlaesning af praecis samme URL.
    setStreamRequest((request) => ({ uri, revision: request.revision + 1 }));
  }, []);
  const [now, setNow] = useState<Programme | null>(null);
  const [next, setNext] = useState<Programme | null>(null);
  /**
   * Hvorfor start-forfra ikke kan bruges lige nu — eller `null` naar den kan.
   *
   * Knappen skjulte sig foer, naar en af forudsaetningerne manglede. Det ser
   * ud som om funktionen ikke findes, og der er ingen vej videre for den der
   * staar med telefonen. Nu staar den der og siger hvad der mangler.
   *
   * `undefined` betyder "ved det ikke endnu": foerste render sker foer
   * programdata er laest, og hverken knappen eller forklaringen maa blinke
   * forbi paa et grundlag vi ikke har naaet at faa.
   */
  const [restartBlock, setRestartBlock] = useState<RestartBlock | null | undefined>(undefined);
  const [repairing, setRepairing] = useState(false);
  /**
   * Sat naar en start-forfra endte som direkte udsendelse alligevel.
   *
   * Foer skete det i stilhed: man trykkede paa et afsluttet program og fik
   * live-udsendelsen uden et ord om hvorfor. Det ligner en app der ikke
   * virker, og der er ingen vej videre naar man ikke ved hvad der manglede.
   */
  const [fellBackToLive, setFellBackToLive] = useState(false);
  /**
   * Sat naar en start-forfra indhentede den levende kant og gled over i
   * direkte. En udsendelse man ser forfra mens den stadig sendes, har kun
   * arkiv frem til "nu"; naar afspilningen naar dertil, ville billedet ellers
   * staa sort midt i udsendelsen. Saa fortsaetter vi direkte i stedet.
   */
  const [caughtUpToLive, setCaughtUpToLive] = useState(false);
  // Kommer vi fra guiden med et program, er afspilningen en start-forfra fra
  // foerste billede — ogsaa foer dialekten er laest, saa format-fallbacket
  // aldrig naar at slaa til paa en timeshift-URL.
  const [restarted, setRestarted] = useState(startFrom !== undefined);
  const [triedFallback, setTriedFallback] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  /**
   * Radio har intet billede, saa der er intet at se paa mens man venter.
   * Derfor siges det med ord hvor langt afspilleren er: forbinder, spiller
   * (og med hvor mange lydspor), eller fejl. Det er ogsaa det der skal til
   * for at kunne sige *hvorfor* en radiokanal er stum.
   */
  const [audioState, setAudioState] = useState<string>('Forbinder …');
  const [radioState, setRadioState] = useState<RadioState>('connecting');
  const [playing, setPlaying] = useState(true);
  /**
   * Det arkiv-stykke der spiller: udsendelsen, hvor stykket begynder (ms), og
   * hvor langt ind der skal spoles naar det er klar. Et stykke slutter dér
   * hvor panelets arkiv sluttede, da det blev bedt om — ved start-forfra paa
   * en udsendelse der sendes, er det midt i den. Se archiveContinuation.
   */
  const archiveRef = useRef<{ programme: Programme; segmentStart: number; seekSeconds: number } | null>(null);
  /** Afspillerens position i det nuvaerende stykke, i sekunder. */
  const positionRef = useRef(0);
  /** playFromStart, til lyttere der er sat op foer den er defineret laengere nede. */
  const playFromStartRef = useRef<(programme: Programme, from?: Date, seekSeconds?: number, reconnect?: boolean) => Promise<void>>(async () => undefined);

  // "Se videre" oeverst i favoritterne: den kanal der sidst blev set.
  useEffect(() => {
    void setLastChannelId(session.db, channel.id).catch(() => undefined);
    // Og forsidens "Sidst sete".
    void recordChannelWatch(session.db, channel.id).catch(() => undefined);
  }, [session.db, channel.id]);

  /**
   * Listen der zappes i: den man kom fra. Aabnes kanallisten (v340) uden
   * en liste, bliver det favoritterne — ogsaa for pil venstre/hoejre.
   */
  const [zapChannels, setZapChannels] = useState<StoredChannel[]>(zap ?? []);
  const zapList = zapChannels;
  const zapIndex = zapList.findIndex((entry) => entry.id === channel.id);
  /** Kanallisten oven paa billedet (v340). */
  const [showingChannels, setShowingChannels] = useState(false);
  const openChannels = useCallback((): void => {
    if (zapChannels.length > 1) {
      setShowingChannels(true);
      return;
    }
    void listChannels(session.db, { favouritesOnly: true, limit: 120 })
      .then((favourites) => {
        if (favourites.length > 0) setZapChannels(favourites);
        setShowingChannels(true);
      })
      .catch(() => setShowingChannels(true));
  }, [zapChannels.length, session.db]);

  const zapTo = useCallback(
    (target: StoredChannel): void => {
      if (target.id === channel.id) return;
      setPrevious(channel);
      archiveRequest.current += 1;
      preparingArchive.current = false;
      recovery.current.reset();
      playIntent.current = true;
      setChannel(target);
      setStartFrom(undefined);
      setRestarted(false);
      archiveRef.current = null;
      setFellBackToLive(false);
      setCaughtUpToLive(false);
      setTriedFallback(false);
      setStreamError(null);
      setRestartBlock(undefined);
      setNow(null);
      setNext(null);
      setBannerUntil(Date.now() + 3_000);
      requestSource(liveUrlFor(session.access(target.sourceId), target, formatForPlatform()));
    },
    [channel, session, requestSource],
  );

  const [bannerTick, setBannerTick] = useState(0);
  useEffect(() => {
    if (bannerUntil === 0) return;
    const timer = setTimeout(() => setBannerTick((value) => value + 1), Math.max(0, bannerUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [bannerUntil]);
  const bannerShown = bannerUntil > Date.now() && bannerTick >= 0;

  /**
   * Radio spiller videre naar skaermen slukkes eller appen gaar i baggrunden,
   * med styring i notifikationen. Kraever supportsBackgroundPlayback i
   * app.json (forgrundstjeneste paa Android). Tv goer det ikke: et
   * billede uden skaerm er bare panelets ene forbindelse brugt paa ingenting.
   */
  // Radio-behandling (skjult video, baggrundslyd, radio-UI) er for AEGTE
  // radio: en internetradio-station (isRadioKey), eller en panel-kanal hvis
  // navn ligner radio OG som viser sig ikke at have billede. Foer var alene
  // navnet nok — saa en video-kanal med "radio" i navnet (fx en musik-tv-
  // kanal) fik radio-UI'et, videoen blev skjult, og i fuld skaerm stod den
  // sort selv om previewet (uden radio-grenen) viste billede. hasVideo
  // afgoeres naar streamen melder sine spor; indtil da vises billedet.
  const nameLooksRadio = /radio/i.test(channel.name);
  const definiteRadio = isRadioKey(channel.id);
  const [hasVideo, setHasVideo] = useState<boolean | null>(null);
  useEffect(() => setHasVideo(null), [channel.id]);
  const isRadio = definiteRadio || (nameLooksRadio && hasVideo === false);
  // Sang og cover, kun for internetradio (stationens egen Icecast-adresse):
  // panelets radiokanaler gaar gennem panelet og sender ingen titel.
  const nowPlaying = useRadioNowPlaying(isRadioKey(channel.id) ? channel.streamUrl : null, channel.name, isRadio && radioState === 'playing');
  const saveSong = useSaveSong(session.db, nowPlaying, channel.name);
  // En vedvarende native afspiller. En dynamisk source her oprettede en NY
  // afspiller ved hvert URL-skift; replace-effekten aabnede derefter kilden
  // endnu en gang og smed dens buffer vaek. Panelet har kun én forbindelse.
  const player = useVideoPlayer(null, (p) => {
    p.loop = false;
    p.staysActiveInBackground = isRadio;
    p.showNowPlayingNotification = isRadio;
    // Hvert sekund: hvor langt arkivstreamen er naaet, til "Fortsaet".
    p.timeUpdateEventInterval = 1;
  });
  const connection = useMemo(() => new PlaybackConnection(player), [player]);
  const changePlaybackIntent = useCallback((desired: boolean): void => {
    playIntent.current = desired;
    connection.setPlayingIntent(desired);
    if (!desired) {
      cancelPendingRetry.current();
    } else if (player.status === 'error' && source !== null) {
      recovery.current.reset();
      const segment = archiveRef.current;
      if (segment !== null) segment.seekSeconds = positionRef.current;
      requestSource(source);
    } else if (player.status === 'idle' && archiveRef.current !== null && connection.committed) {
      refreshArchiveEnd.current();
    } else {
      playbackStatus.current(player.status);
    }
  }, [player, connection, source, requestSource]);

  /**
   * Fremdrift i arkivet, til forsidens "Fortsaet": gemmes hvert tiende
   * sekund mens en udsendelse startet forfra spiller. Og "Fortsaet" den
   * anden vej: naar streamen er klar, spoles der til hvor man slap.
   */
  const lastSaved = useRef(0);
  useEffect(() => {
    const subscription = player.addListener('timeUpdate', ({ currentTime }: { currentTime: number }) => {
      if (changingSource.current || !connection.position(currentTime)) return;
      positionRef.current = currentTime;
      const segment = archiveRef.current;
      const absolutePosition = currentTime + (segment === null ? 0 : segment.segmentStart / 1000);
      if (recovery.current.position(absolutePosition, Date.now(), player.playing)) {
        cancelPendingRetry.current();
        setStreamError(null);
      }
      if (!restarted || startFrom === undefined) return;
      // Positionen i hele udsendelsen, ogsaa naar et senere stykke af arkivet spiller.
      const absolute = currentTime + (segment === null ? 0 : (segment.segmentStart - startFrom.start.getTime()) / 1000);
      if (absolute - lastSaved.current < 10 && absolute >= lastSaved.current) return;
      lastSaved.current = absolute;
      void saveArchiveProgress(session.db, channel.id, startFrom, absolute).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [player, connection, restarted, startFrom, session.db, channel.id]);
  useEffect(() => {
    try {
      player.staysActiveInBackground = isRadio;
      player.showNowPlayingNotification = isRadio;
    } catch {
      // Afspilleren er vaek.
    }
  }, [player, isRadio]);

  /**
   * Undertekster i live-tv. Samme regler som for film: det foretrukne sprog
   * fra Indstillinger vaelges af sig selv naar streamen melder sine spor,
   * og man kan skifte i vaelgeren. Streamen skifter ved start-forfra og ved
   * fallback til det andet format, og hver ny stream melder sine spor
   * paa ny — derfor vaelges der igen for hver kilde, ikke kun én gang.
   */
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [subtitle, setSubtitle] = useState<SubtitleTrack | null>(null);
  const [showingSubtitles, setShowingSubtitles] = useState(false);
  const preference = useRef<SubtitlePreference | null>(null);
  /** Kilden der sidst fik valgt spor af sig selv; en ny kilde faar et nyt valg. */
  const autoPickedFor = useRef<string | null>(null);
  /** Brugeren har valgt selv for denne kilde; saa roeres der ikke ved det. */
  const userPickedFor = useRef<string | null>(null);

  const autoSelectSubtitle = useCallback(
    (tracks: SubtitleTrack[]): void => {
      const preferred = preference.current;
      if (preferred === null || source === null) return;
      if (userPickedFor.current === source || autoPickedFor.current === source) return;
      const track = pickPreferredSubtitle(tracks, preferred);
      if (track === null) return;
      autoPickedFor.current = source;
      try {
        player.subtitleTrack = track;
        setSubtitle(track);
      } catch {
        // Afspilleren er vaek.
      }
    },
    [player, source],
  );

  useEffect(() => {
    let cancelled = false;
    void getSubtitlePreference(session.db).then((value) => {
      if (cancelled) return;
      preference.current = value;
      try {
        autoSelectSubtitle(player.availableSubtitleTracks);
      } catch {
        // Afspilleren er vaek.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session.db, player, autoSelectSubtitle]);

  useEffect(() => {
    const subscription = player.addListener('playingChange', ({ isPlaying }: { isPlaying: boolean }) => {
      setPlaying(isPlaying);
    });
    return () => subscription.remove();
  }, [player]);

  // Kun metadata fra den kilde vi faktisk har bedt om maa godkendes.
  useEffect(() => {
    const loaded = player.addListener('sourceLoad', ({ videoSource }) => {
      connection.sourceLoaded(videoSource);
      if (connection.committed && !changingSource.current) playbackStatus.current(player.status);
    });
    const status = player.addListener('statusChange', ({ status }) => connection.status(status));
    return () => { loaded.remove(); status.remove(); };
  }, [player, connection]);

  /** Et endt arkiv-stykke er ikke noedvendigvis en faerdig udsendelse.
   * Fortsaet ved dens faktiske position; mangler panelet data, vent uden at
   * gentage gamle minutter eller springe resten af udsendelsen over. */
  const caughtUpHandled = useRef(false);
  useEffect(() => {
    if (restarted) caughtUpHandled.current = false;
  }, [restarted]);
  useEffect(() => {
    let waitTimer: ReturnType<typeof setTimeout> | null = null;
    const continueArchive = (): void => {
      if (isRadio || !restarted || caughtUpHandled.current || changingSource.current || preparingArchive.current || !connection.committed || !playIntent.current) return;
      if (waitTimer !== null) return;
      const segment = archiveRef.current;
      // Intet arkiv-stykke endnu (v362): fra guiden skabes afspilleren uden
      // kilde, og play() paa en tom afspiller melder straks "spillet til
      // ende". Det blev taget for "indhentet live" — appen bad om
      // live-stroemmen og et sekund senere om arkivet, to forbindelser i
      // traek til et panel der tillader én, og skiltet "Du er naaet til
      // direkte" stod paa. Loggen fra tv'et viste det: "stroemmen sluttede
      // ved 0 s (stykke fra ?) → live" i samme sekund som "beder om arkiv".
      if (segment === null) {
        logEvent('arkiv', 'spillet til ende uden arkiv-stykke (tom afspiller): ignoreres');
        return;
      }
      const airing = segment.programme;
      // Det sidste timeUpdate kan ligge et sekund foer slut. Native tid
      // giver den faktiske ende, saa hvert styk-skift ikke gentager et sekund.
      const endedAt = player.currentTime;
      if (Number.isFinite(endedAt) && endedAt > positionRef.current) positionRef.current = endedAt;
      const nowMs = Date.now();
      const next = archiveContinuation(airing, segment.segmentStart, positionRef.current, nowMs);
      logEvent(
        'arkiv',
        `stroemmen sluttede ved ${Math.round(positionRef.current)} s (stykke fra ${clockOf(segment.segmentStart)}) → ${next.kind}${next.kind === 'continue' ? ` fra ${clockOf(next.from.getTime())} +${Math.round(next.seekSeconds)} s` : ''}`,
      );
      if (next.kind === 'wait') {
        // Ingen nye data endnu. Genstart ikke det samme minut, og spring
        // heller ikke de sidste sekunder over naar programmet lige sluttede.
        const waitingAt = positionRef.current;
        waitTimer = setTimeout(() => {
          waitTimer = null;
          // Brugeren kan have spolet tilbage eller genoptaget i det gamle
          // stykke mens vi ventede. Afbryd aldrig sund afspilning for det.
          if (player.playing || positionRef.current < waitingAt - 1) return;
          continueArchive();
        }, 15_000);
        return;
      }
      if (next.kind === 'continue') {
        // Arkivet sluttede midt i udsendelsen: hent det igen fra det punkt man
        // naaede. Kom der intet nyt to gange i traek, har panelet ikke mere.
        if (recovery.current.ended(segment.segmentStart / 1000 + positionRef.current)) {
          void playFromStartRef.current(airing, next.from, next.seekSeconds, true);
          return;
        }
        logEvent('arkiv', 'to fortsaettelser uden nye sekunder: stopper gentagelsen');
        setStreamError('Arkivet leverer ikke mere lige nu. Prøv igen.');
        return;
      }
      if (next.kind !== 'live') return;
      archiveRef.current = null;
      caughtUpHandled.current = true;
      setRestarted(false);
      setCaughtUpToLive(true);
      setBannerUntil(Date.now() + 3_000);
      recovery.current.reset();
      requestSource(liveUrlFor(access, channel, formatForPlatform()));
    };
    refreshArchiveEnd.current = continueArchive;
    const subscription = player.addListener('playToEnd', continueArchive);
    return () => {
      subscription.remove();
      if (waitTimer !== null) clearTimeout(waitTimer);
      if (refreshArchiveEnd.current === continueArchive) refreshArchiveEnd.current = () => undefined;
    };
  }, [player, connection, sourceRevision, isRadio, restarted, access, channel, requestSource]);

  /**
   * Videosporet, til én linje i bjaelken paa tv: format, stoerrelse og om
   * enheden kan afkode det. Groen skaerm med lyd (DR startet forfra) kan
   * ikke ses herfra, men det kan et "understoettet: nej".
   */
  const [videoInfo, setVideoInfo] = useState<string | null>(null);
  useEffect(() => {
    const describe = (track: { mimeType: string | null; size: { width: number; height: number }; isSupported: boolean; frameRate?: number | null } | null): string | null => {
      if (track === null) return null;
      const codec = (track.mimeType ?? 'ukendt').replace('video/', '');
      const fps = typeof track.frameRate === 'number' && track.frameRate > 0 ? ` ${Math.round(track.frameRate)} fps` : '';
      return `${codec} ${track.size.width}×${track.size.height}${fps} · ${track.isSupported ? 'understøttet' : 'IKKE understøttet af enheden'}`;
    };
    const subscription = player.addListener('videoTrackChange', ({ videoTrack }: { videoTrack: { mimeType: string | null; size: { width: number; height: number }; isSupported: boolean; frameRate?: number | null } | null }) => {
      setVideoInfo(describe(videoTrack));
      // Meldte streamen et billedspor, er det ikke radio (uanset navn). Kun
      // opgradering til "har billede": et forbigaaende null under opstart maa
      // ikke faa en video-kanal til at skifte til radio-UI.
      if (videoTrack !== null) setHasVideo(true);
    });
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    const subscription = player.addListener(
      'availableSubtitleTracksChange',
      ({ availableSubtitleTracks }: { availableSubtitleTracks: SubtitleTrack[] }) => {
        setSubtitleTracks(availableSubtitleTracks);
        setSubtitle(player.subtitleTrack);
        autoSelectSubtitle(availableSubtitleTracks);
      },
    );
    return () => subscription.remove();
  }, [player, autoSelectSubtitle]);

  function chooseSubtitle(track: SubtitleTrack | null): void {
    if (source !== null) userPickedFor.current = source;
    player.subtitleTrack = track;
    setSubtitle(track);
    setShowingSubtitles(false);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadEpg(): Promise<void> {
      // Opslaget sker paa kanalens eget id — Xtreams stream_id. I v1 gik det
      // gennem epg_channel_id, som 87 % af panelets kanaler ikke har, saa
      // start-forfra var utilgaengeligt for dem uanset deres arkiv.
      const result = await getNowNext(session.db, channel.id, new Date());
      if (cancelled) return;
      setNow(result.now);
      setNext(result.next);

      const dialect = await getTimeshiftDialect(session.db, channel.sourceId);
      if (cancelled) return;
      setRestartBlock(restartBlockFor(channel.hasArchive, dialect !== null, result.now !== null));

    }

    void loadEpg();
    return () => {
      cancelled = true;
    };
  }, [session.db, channel, startFrom]);

  useEffect(() => {
    if (source === null) return;
    let cancelled = false;
    recovery.current.beginLoad();
    const seek = archiveRef.current?.seekSeconds ?? 0;
    positionRef.current = seek;
    void connection.load(streamSource(source), archiveRef.current !== null, seek, playIntent.current)
      .then(() => {
        if (cancelled) return;
        changingSource.current = false;
        playbackStatus.current(player.status);
      })
      .catch(() => {
        if (cancelled) return;
        changingSource.current = false;
        nativeFailure.current();
      });
    return () => {
      cancelled = true;
      connection.cancel();
    };
  }, [player, connection, source, sourceRevision]);

  // Har afspilleren vist det foerste billede for DENNE stream endnu? Nulstilles
  // ved hvert kildeskift (ny kanal/format), saa den foerste forbindelse
  // genforbinder hurtigt (INITIAL_STALL_TIMEOUT_MS), mens en genbuffring midt i
  // afspilningen faar den laengere snor (STALL_TIMEOUT_MS).
  const everReady = useRef(false);
  useEffect(() => {
    everReady.current = false;
  }, [source, sourceRevision]);

  // Spec sec.9: IPTV-streams falder ud hele tiden. To forsoeg med backoff,
  // derefter fallback til det andet containerformat der hvor et saadant
  // findes, og automatisk genforbindelse naar afspilningen stopper eller
  // haenger midt i. Uden det opfoerer appen sig som de Norlys-anmeldelser
  // der klagede over konstante udfald.
  useEffect(() => {
    if (source === null) return;

    let cancelled = false;
    let gaveUp = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelRetry = (): void => {
      if (retryTimer !== null) clearTimeout(retryTimer);
      retryTimer = null;
      gaveUp = false;
    };
    cancelPendingRetry.current = cancelRetry;

    function clearStallTimer(): void {
      if (stallTimer !== null) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    }

    // Faelles vej for baade haarde fejl og stall.
    function handleFailure(): void {
      if (cancelled || gaveUp || retryTimer !== null || preparingArchive.current || changingSource.current) return;
      clearStallTimer();
      if (!playIntent.current) return;

      const { attempt, retry } = recovery.current.failure();
      logEvent('afspiller', `fejl/haengt ved ${Math.round(positionRef.current)} s, forsoeg ${attempt} af ${MAX_RETRIES}${restarted ? ' (arkiv)' : ''}`);
      if (retry) {
        const reconnect = (): void => {
          retryTimer = null;
          if (cancelled || source === null) return;
          // Start-forfra: genforbind fra det punkt man naaede, ikke fra
          // udsendelsens begyndelse (samme URL ville starte forfra).
          const segment = archiveRef.current;
          if (restarted && segment !== null) {
            const next = archiveContinuation(segment.programme, segment.segmentStart, positionRef.current, Date.now());
            if (next.kind === 'continue') {
              void playFromStartRef.current(segment.programme, next.from, next.seekSeconds, true);
              return;
            }
            if (next.kind === 'wait') {
              retryTimer = setTimeout(reconnect, 15_000);
              return;
            }
            if (next.kind === 'done') return;
            // Ogsaa ved 0–5 s bevares arkivets spoletid. Hver genindlaesning
            // af samme URL faar en ny revision og nulstiller ikke budgettet.
            segment.seekSeconds = positionRef.current;
          }
          requestSource(source);
        };
        retryTimer = setTimeout(reconnect, attempt * RETRY_BACKOFF_MS);
        return;
      }

      // Foerst efter at begge forsoeg fejlede proever vi det andet format, og
      // kun hvor der findes et brugbart et — se hasFormatFallback(). Under
      // start-forfra springes fallback ogsaa over: arkivets beholder og
      // position bevares, i stedet for at skifte til live ved en fejl.
      if (hasFormatFallback() && !triedFallback && !restarted) {
        setTriedFallback(true);
        recovery.current.reset();
        logEvent('afspiller', `skifter til det andet format (${FALLBACK_FORMAT})`);
        requestSource(liveUrlFor(access, channel, FALLBACK_FORMAT));
        return;
      }

      logEvent('afspiller', 'opgiver: "Streamen kunne ikke afspilles"');
      gaveUp = true;
      // Den raa besked fra expo-video maa aldrig vises. Den stammer fra
      // ExoPlayer eller AVPlayer, som rutinemaessigt skriver den fejlende URI
      // ind i teksten — og live-URLen har panelets adgangskode som et
      // sti-segment. En fast dansk tekst i stedet, aldrig error.message.
      setStreamError('Streamen kunne ikke afspilles. Prøv igen.');
    }

    nativeFailure.current = handleFailure;
    const handleStatus = (status: string): void => {
      if (cancelled) return;

      if (status === 'readyToPlay') {
        if (!connection.committed || changingSource.current) return;
        if (!everReady.current) logEvent('afspiller', `klar (${restarted ? 'arkiv' : 'live'}, ${/\.m3u8(\?|$)/.test(source) ? 'hls' : 'ts'})`);
        everReady.current = true;
        clearStallTimer();
        try {
          const audioTracks = player.availableAudioTracks;
          // Et spor der findes men ikke er valgt, vaelges. ExoPlayer goer
          // det selv for video; for en stream uden billede har det vist
          // sig ikke altid at ske.
          if (player.audioTrack === null && audioTracks.length > 0) {
            const first = audioTracks[0];
            if (first !== undefined) player.audioTrack = first;
          }
          setAudioState(
            audioTracks.length === 0
              ? 'Spiller, men streamen melder intet lydspor'
              : `Spiller · ${audioTracks.length} lydspor · lyd ${Math.round(player.volume * 100)} %${player.muted ? ' · dæmpet' : ''}`,
          );
        } catch {
          setAudioState('Spiller');
        }
        try {
          // Radio-afgoerelse: er streamen klar helt uden billedspor, er det
          // lyd alene (en aegte radiokanal). Har den billede, er det video —
          // ogsaa selv om navnet indeholder "radio". setHasVideo(true) fra
          // videoTrackChange nedgraderes aldrig.
          const hasVideoTrack = player.availableVideoTracks.length > 0 || player.videoTrack !== null;
          setHasVideo((prev) => (prev === true ? true : hasVideoTrack));
        } catch {
          // Afspilleren er vaek.
        }
        setRadioState('playing');
        // Sporene kan vaere meldt foer lytteren kom paa. Laeses her igen.
        setSubtitleTracks(player.availableSubtitleTracks);
        setSubtitle(player.subtitleTrack);
        autoSelectSubtitle(player.availableSubtitleTracks);
        return;
      }

      if (status === 'error') {
        logEvent('afspiller', `status: error ved ${Math.round(positionRef.current)} s`);
        setAudioState('Streamen svarede med en fejl');
        setRadioState('error');
        handleFailure();
        return;
      }
      if (status === 'loading') {
        if (everReady.current) logEvent('afspiller', `buffrer ved ${Math.round(positionRef.current)} s`);
        setAudioState('Forbinder …');
        setRadioState('connecting');
      }

      // Spec sec.9 kraever ogsaa genforbindelse paa buffer-haendelser:
      // bliver afspilleren haengende i 'loading' uden at komme videre, er
      // streamen faldet ud midt i afspilningen, selv om der aldrig kom en
      // egentlig fejl.
      if (status === 'loading' && stallTimer === null) {
        stallTimer = setTimeout(handleFailure, everReady.current ? STALL_TIMEOUT_MS : restarted ? ARCHIVE_INITIAL_TIMEOUT_MS : INITIAL_STALL_TIMEOUT_MS);
      }
    };
    playbackStatus.current = handleStatus;
    const subscription = player.addListener('statusChange', ({ status }) => handleStatus(status));

    // Frosset billede (v353): afspilleren melder 'readyToPlay' og 'playing',
    // men tiden staar stille. Det er det brugeren saa som "billedet fryser
    // jaevnligt ved fuld skaerm; tilbage til guiden og ind igen, saa koerer
    // det" — altsaa en ny forbindelse hjaelper. Staar positionen stille i
    // FROZEN_AFTER_MS mens der skulle spilles, genforbindes der som ved et
    // stall. Pause og en stream der er sluttet taeller ikke (playing er falsk).
    let lastPosition = positionRef.current;
    let stillSince: number | null = null;
    const frozenTimer = setInterval(() => {
      if (cancelled || changingSource.current || preparingArchive.current) return;
      let shouldAdvance = false;
      try {
        shouldAdvance = player.playing && player.status === 'readyToPlay';
      } catch {
        return;
      }
      const position = positionRef.current;
      if (!shouldAdvance || position !== lastPosition) {
        lastPosition = position;
        stillSince = null;
        return;
      }
      if (stillSince === null) {
        stillSince = Date.now();
        return;
      }
      if (Date.now() - stillSince < FROZEN_AFTER_MS) return;
      stillSince = null;
      // v363: hvor langt bufferen naaede, saa loggen skelner "data i bufferen,
      // dekoderen staar" (buffer langt foran) fra "sultet, men status spiller".
      let buffered = -1;
      try {
        buffered = player.bufferedPosition;
      } catch {
        // Afspilleren er vaek.
      }
      logEvent(
        'afspiller',
        `billedet staar stille ved ${Math.round(position)} s i ${Math.round(FROZEN_AFTER_MS / 1000)} s (buffer til ${buffered < 0 ? '?' : Math.round(buffered)} s): genforbinder`,
      );
      handleFailure();
    }, FROZEN_CHECK_MS);

    return () => {
      cancelled = true;
      clearStallTimer();
      clearInterval(frozenTimer);
      if (retryTimer !== null) clearTimeout(retryTimer);
      subscription.remove();
      if (cancelPendingRetry.current === cancelRetry) cancelPendingRetry.current = () => undefined;
      if (nativeFailure.current === handleFailure) nativeFailure.current = () => undefined;
      if (playbackStatus.current === handleStatus) playbackStatus.current = () => undefined;
    };
  }, [player, connection, source, sourceRevision, triedFallback, restarted, access, channel, autoSelectSubtitle, requestSource]);

  const playFromStart = useCallback(
    async (programme: Programme, from: Date = programme.start, seekSeconds = 0, reconnect = false): Promise<void> => {
      if (preparingArchive.current) return;
      const request = ++archiveRequest.current;
      preparingArchive.current = true;
      changingSource.current = true;
      startFromHandled.current = true;
      if (!reconnect) {
        recovery.current.reset();
        lastSaved.current = 0;
        playIntent.current = true;
      }
      try {
        const [dialect, offset] = await Promise.all([
          getTimeshiftDialect(session.db, channel.sourceId),
          getPanelOffsetMinutes(session.db, channel.sourceId),
        ]);
        if (request !== archiveRequest.current) return;
        if (dialect === null || access?.creds == null) {
          // Uden dialekt kan arkiv-URLen ikke bygges. Kom vi fra guiden, staar
          // skaermen sort uden dette: fald tilbage paa live frem for ingenting —
          // men sig det, i stedet for at lade folk tro at trykket ikke virkede.
          archiveRef.current = null;
          requestSource(liveUrlFor(access, channel, formatForPlatform()));
          setRestarted(false);
          setFellBackToLive(true);
          setRestartBlock(restartBlockFor(channel.hasArchive, false, true));
          return;
        }
        setFellBackToLive(false);
        setCaughtUpToLive(false);

        // Fra `from` til udsendelsens slutning — men aldrig ud i fremtiden
        // (v347): bedes panelet om arkiv der endnu ikke findes (en udsendelse
        // der stadig sendes), leverede det en stroem der froes efter et minut
        // paa tv'et, mens faerdige udsendelser spillede igennem. Nu bedes der
        // kun om det der ligger dér (til lidt foer nu); naar det stykke er
        // spillet, henter archiveContinuation det naeste uden at skifte til
        // en ny native afspiller eller genbruge et gammelt spoletidspunkt.
        const window = archiveWindow(programme, from, seekSeconds, Date.now());
        if (window === null || window.seekSeconds >= window.minutes * 60) {
          changingSource.current = false;
          setStreamError('Arkivet er ikke klart endnu. Prøv igen om lidt.');
          return;
        }
        logEvent(
          'arkiv',
          `beder om ${dialect}-arkiv fra ${clockOf(window.from.getTime())}, ${window.minutes} min (udsendelse ${clockOf(programme.start.getTime())}–${clockOf(programme.stop.getTime())}, offset ${offset} min, spol ${Math.round(window.seekSeconds)} s)`,
        );
        archiveRef.current = { programme, segmentStart: window.from.getTime(), seekSeconds: window.seekSeconds };
        positionRef.current = window.seekSeconds;
        // Samme beholder som live (.ts paa Android): arkivet som HLS gav groen
        // skaerm med lyd paa DR-kanalerne paa tv, mens live i .ts var fint.
        // Streamformat under Indstillinger gaelder ogsaa her.
        requestSource(
          buildTimeshiftUrl(
            access.creds,
            channel.streamId,
            window.from,
            window.minutes,
            dialect,
            offset,
            formatForPlatform(),
          ),
        );
        setStreamError(null);
        setStartFrom(programme);
        setRestarted(true);
      } catch {
        if (request !== archiveRequest.current) return;
        changingSource.current = false;
        setStreamError('Arkivet kunne ikke åbnes. Prøv igen.');
      } finally {
        if (request === archiveRequest.current) preparingArchive.current = false;
      }
    },
    [session.db, access, channel, requestSource],
  );
  playFromStartRef.current = playFromStart;

  /**
   * Raader bod paa det der spaerrer for start-forfra, og opdaterer tilstanden.
   *
   * Begge veje er billige og kan koeres af brugeren selv: dialekten findes med
   * de samme to probes som under onboarding, og programdata hentes for netop
   * denne ene kanal. Alternativet — at bede folk logge ud og ind igen for at
   * faa onboarding til at koere forfra — er ikke et svar.
   */
  const repairRestart = useCallback(async (): Promise<void> => {
    if (restartBlock === null || restartBlock === undefined) return;
    if (restartBlock === 'no-archive') return;
    setRepairing(true);
    try {
      if (restartBlock === 'no-dialect') {
        const offset = await getPanelOffsetMinutes(session.db, channel.sourceId);
        const found =
          access?.creds == null
            ? null
            : await detectTimeshiftDialect(
                access.creds,
                channel.streamId,
                session.fetchImpl,
                new Date(),
                offset,
              );
        await setTimeshiftDialect(session.db, found, channel.sourceId);
      } else {
        try {
          await ensureEpg(session.db, session.credsBySource, session.fetchImpl, [channel.id]);
        } catch {
          // Kunne panelet ikke naas, staar beskeden bare uaendret.
        }
      }

      const [result, dialect] = await Promise.all([
        getNowNext(session.db, channel.id, new Date()),
        getTimeshiftDialect(session.db, channel.sourceId),
      ]);
      setNow(result.now);
      setNext(result.next);
      setRestartBlock(restartBlockFor(channel.hasArchive, dialect !== null, result.now !== null));
    } finally {
      setRepairing(false);
    }
  }, [restartBlock, session, channel, access]);


  // Guiden aabner afspilleren med et afsluttet program: byg arkiv-URLen med
  // det samme, i stedet for at vente paa at brugeren finder en knap.
  useEffect(() => {
    if (startFrom === undefined || startFromHandled.current) return;
    startFromHandled.current = true;
    void playFromStart(startFrom, startFrom.start, resumeAtSeconds ?? 0);
  }, [startFrom, playFromStart, resumeAtSeconds]);

  // Et sent database-svar maa ikke starte arkivet efter Tilbage eller et zap.
  useEffect(() => () => {
    archiveRequest.current += 1;
    preparingArchive.current = false;
    startFromHandled.current = false;
  }, []);

  // Bjaelken bygges op forfra hver gang den kommer frem, og paa tv skal
  // en knap have fokus med det samme: ellers skulle man trykke sig ned til
  // den ("skal trykke en masse gange"). Spoler man, er det 30 s frem;
  // ellers Start forfra; og er den der ikke, Tilbage.
  const canRestart = !restarted && restartBlock === null && now !== null;
  // Raekkefoelgen er Googles: den primaere handling foerst, for det er den
  // fokus lander paa. Start forfra eller spoling, saa tekst, saa zap.
  const actions = (
    <>
      {/* Ingen Tilbage-knap paa tv: Google — "brug fjernbetjeningens
          Tilbage, vis ikke en knap paa skaermen". */}
      {!isTV && (
        <TvPressable style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>Tilbage</Text>
        </TvPressable>
      )}
      {canRestart && (
        <TvPressable
          style={[styles.button, styles.buttonAccent]}
          hasTVPreferredFocus={isTV}
          onPress={() => {
            void playFromStart(now);
          }}
        >
          <Text style={styles.buttonText}>Start forfra</Text>
        </TvPressable>
      )}
      {/* Startet forfra paa tv: pause og spoling, saa reklamerne kan
          springes over. Paa telefonen har afspillerens egne knapper det. */}
      {restarted && isTV && <SeekButtons player={player} playing={playing} preferFocus onPlaybackIntentChange={changePlaybackIntent} />}
      <TvPressable
        style={styles.button}
        hasTVPreferredFocus={isTV && !restarted && !canRestart}
        onPress={() => {
          setSubtitleTracks(player.availableSubtitleTracks);
          setSubtitle(player.subtitleTrack);
          setShowingSubtitles((value) => !value);
        }}
      >
        <Text style={styles.buttonText}>
          Tekst{subtitle !== null ? `: ${trackName(subtitle)}` : ''}
        </Text>
      </TvPressable>
      {/* Kanallisten oven paa billedet (v340): paa tv ogsaa med pil ned fra billedet. */}
      <TvPressable style={styles.button} onPress={openChannels}>
        <Text style={styles.buttonText}>Kanaler</Text>
      </TvPressable>
      {/* De to zap-pile (‹ ›) er fjernet: paa tv zapper man med fjernbetjeningens
          pil venstre/hoejre i fuld skaerm, saa knapperne var overfloedige. */}
      {previous !== null && (
        <TvPressable style={styles.button} hitSlop={6} onPress={() => zapTo(previous)}>
          <Text style={styles.buttonText}>⇄ {shortName(previous.name)}</Text>
        </TvPressable>
      )}
      {restarted && isTV && videoInfo !== null && <Text style={styles.videoInfo}>{videoInfo}</Text>}
    </>
  );

  const subtitlePicker = showingSubtitles ? (
    <TrackPicker
      title="Undertekster"
      options={[
        { key: 'none', label: 'Ingen', active: subtitle === null, onPress: () => chooseSubtitle(null) },
        ...subtitleTracks.map((track, index) => ({
          key: track.id ?? `${track.language}-${index}`,
          label: trackName(track),
          active: subtitle !== null && sameTrack(subtitle, track),
          onPress: () => chooseSubtitle(track),
        })),
      ]}
      emptyText="Streamen har ingen undertekstspor. De fleste live-kanaler sender teksten indbrændt i billedet eller slet ikke."
      onClose={() => setShowingSubtitles(false)}
    />
  ) : null;

  const channelOverlay = showingChannels ? (
    <ChannelOverlay
      session={session}
      channels={zapChannels}
      currentId={channel.id}
      onPick={(target) => {
        setShowingChannels(false);
        zapTo(target);
      }}
      onClose={() => setShowingChannels(false)}
    />
  ) : null;

  const banner = bannerShown ? (
    <View style={styles.banner} pointerEvents="none">
      <Text style={styles.bannerName} numberOfLines={1}>
        {zapIndex === -1 ? '' : `${zapIndex + 1} · `}
        {channel.name}
      </Text>
      <Text style={styles.bannerTitle} numberOfLines={1}>
        {now?.title ?? 'Henter programdata …'}
        {next !== null ? `  ·  Derefter: ${next.title}` : ''}
      </Text>
    </View>
  ) : null;

  // Mens billedet buffres, staar skaermen ellers sort — det foelte langsomt,
  // som om kanalen ikke kom. Et roligt lag med logo, navn og "Forbinder …"
  // giver med det samme svar paa at der sker noget. Kun paa video (radioen har
  // sin egen skaerm) og kun til billedet er klart (radioState skifter til
  // 'playing'); en fejl viser sin egen tekst i stedet.
  const connectingOverlay =
    !isRadio && radioState === 'connecting' && hasVideo !== true && streamError === null ? (
      <View style={styles.connecting} pointerEvents="none">
        <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={48} />
        <Text style={styles.connectingName} numberOfLines={1}>
          {channel.name}
        </Text>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.connectingHint}>Forbinder …</Text>
      </View>
    ) : null;

  if (isRadio) {
    const shown: RadioState = radioState === 'playing' && !playing ? 'paused' : radioState;
    return (
      <RadioView
        channel={channel}
        state={shown}
        nowPlaying={nowPlaying}
        saveSong={saveSong}
        stateText={shown === 'paused' ? 'Pause' : streamError ?? audioState}
        hiddenVideo={<VideoView style={styles.hiddenVideo} player={player} nativeControls={false} />}
        hasPrevious={zapList.length > 1 && zapIndex !== -1}
        hasNext={zapList.length > 1 && zapIndex !== -1}
        onBack={onBack}
        onPrevious={() => {
          const target = zapList[(zapIndex - 1 + zapList.length) % zapList.length];
          if (target !== undefined) zapTo(target);
        }}
        onNext={() => {
          const target = zapList[(zapIndex + 1) % zapList.length];
          if (target !== undefined) zapTo(target);
        }}
        onToggle={() => {
          try {
            changePlaybackIntent(!player.playing);
            if (player.playing) player.pause();
            else player.play();
          } catch {
            // Afspilleren er vaek.
          }
        }}
      />
    );
  }

  if (landscape) {
    return (
      <LandscapePlayer
        // Paa tv uden afspillerens egne knapper: de tog fjernbetjeningen,
        // saa Tilbage foerst lukkede dem og saa maaske kanalen. Appens egen
        // bjaelke har det samme, og Tilbage gaar altid til listen.
        video={<VideoView style={StyleSheet.absoluteFill} player={player} nativeControls={!isTV} surfaceType={surfaceTypeForPlatform()} />}
        bar={actions}
        playing={playing}
        // Paa tv: staar man og spoler (start-forfra/arkiv), skjules bjaelken fra
        // start, saa pil venstre/hoejre spoler med det samme. Paa en direkte
        // live-kanal bliver bjaelken fremme, saa "Start forfra" kan ses.
        initialBarShown={!isTV || !restarted}
        suspended={showingChannels}
        onPlayerKey={(key) => {
          try {
            if (key === 'select' || key === 'playPause') {
              changePlaybackIntent(!player.playing);
              if (player.playing) player.pause();
              else player.play();
              return true;
            }
            // Pil venstre/hoejre paa en LIVE-kanal: zap til forrige/naeste kanal
            // i den liste man kom fra (som en fjernbetjenings kanal-op/-ned).
            // I arkivet (start forfra) spoler de i stedet — der er noget at spole i.
            if ((key === 'left' || key === 'right') && !restarted) {
              if (zapList.length > 1 && zapIndex !== -1) {
                const target =
                  key === 'left'
                    ? zapList[(zapIndex - 1 + zapList.length) % zapList.length]
                    : zapList[(zapIndex + 1) % zapList.length];
                if (target !== undefined) {
                  zapTo(target);
                  return true;
                }
              }
              return false;
            }
            // Pil ned paa billedet: kanallisten oven paa (v340). Pil op henter bjaelken.
            if (key === 'down') {
              openChannels();
              return true;
            }
            if (key === 'up') return false;
            // Spoling kun i arkivet: en live-kanal har intet at spole i.
            if (!restarted) return false;
            if (key === 'left' || key === 'rewind') player.seekBy(-10);
            else player.seekBy(30);
            return true;
          } catch {
            return false;
          }
        }}
        overlays={
          <>
            {banner}
            {connectingOverlay}
            {subtitlePicker}
            {channelOverlay}
          </>
        }
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* allowsFullscreen findes ikke i den installerede expo-video (57.0.3) —
          fuldskaerm er slaaet til som standard via fullscreenOptions.enable. */}
      <View>
        <VideoView style={styles.video} player={player} nativeControls />
        {banner}
      </View>

      <View style={styles.info}>
        <View style={styles.channelLine}>
          <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={36} />
          <Text style={styles.channelName}>{channel.name}</Text>
        </View>
        {/* Kommer vi fra guiden, er det programmet der genafspilles der staar
            oeverst — ikke det der sendes lige nu. */}
        <Text style={styles.nowTitle}>
          {startFrom?.title ?? now?.title ?? 'Ingen programdata'}
        </Text>
        {(startFrom ?? now) !== null && (
          <Text style={styles.airtime}>{airtime(startFrom ?? now)}</Text>
        )}
        {startFrom === undefined && next !== null && (
          <Text style={styles.nextTitle}>Derefter: {next.title}</Text>
        )}
        {restarted && <Text style={styles.badge}>Afspilles fra begyndelsen</Text>}
        {caughtUpToLive && (
          <Text style={styles.badge}>Du er nået til direkte — ser resten live</Text>
        )}
        {fellBackToLive && (
          <Text style={styles.warn}>
            Udsendelsen kunne ikke hentes fra arkivet. Du ser direkte i stedet.
          </Text>
        )}
        {streamError !== null && <Text style={styles.error}>{streamError}</Text>}
      </View>

      <View style={[styles.actions, { paddingBottom: theme.spacing.md + insets.bottom }]}>{actions}</View>

      {subtitlePicker}
      {channelOverlay}
      {(fellBackToLive || !restarted) && restartBlock !== null && restartBlock !== undefined && (
        <RestartBlocked
          block={restartBlock}
          busy={repairing}
          onRepair={() => {
            void repairRestart();
          }}
        />
      )}
    </View>
  );
}

/**
 * Forklaringen paa hvorfor der ikke kan startes forfra, med den handling der
 * kan aendre det. Egen komponent, saa afspillerens returnering ikke vokser til
 * noget man skal laese to gange.
 */
function RestartBlocked({
  block,
  busy,
  onRepair,
}: {
  block: RestartBlock;
  busy: boolean;
  onRepair: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const hint = restartHint(block);
  return (
    <View style={styles.blocked}>
      <Text style={styles.blockedTitle}>Start forfra er ikke klar</Text>
      <Text style={styles.blockedText}>{hint.text}</Text>
      {hint.action !== null && (
        <TvPressable style={styles.blockedAction} disabled={busy} onPress={onRepair}>
          {busy ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={styles.blockedActionText}>{hint.action}</Text>
          )}
        </TvPressable>
      )}
    </View>
  );
}

/** "13:30 – 14:30", som paa afspillerens tidslinje hos de store udbydere. */
function airtime(programme: Programme | null | undefined): string {
  if (programme === null || programme === undefined) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  const clock = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${clock(programme.start)} – ${clock(programme.stop)}`;
}

/** Kanalnavnet uden panelets praefiks og kvalitetsmaerke, til en lille knap. */
function shortName(name: string): string {
  const withoutPrefix = name.includes('|') ? name.slice(name.lastIndexOf('|') + 1) : name;
  return withoutPrefix.replace(/\b(FHD|UHD|HD|SD|4K|HEVC|RAW)\b/gi, '').replace(/\s+/g, ' ').trim().slice(0, 14);
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  banner: {
    position: 'absolute',
    top: theme.spacing.sm,
    left: theme.spacing.sm,
    right: 64,
    padding: theme.spacing.sm,
    borderRadius: theme.radius,
    backgroundColor: '#000000aa',
  },
  bannerName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  bannerTitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  connecting: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    backgroundColor: '#000000',
  },
  connectingName: { color: colors.text, fontSize: 18, fontWeight: '700' },
  connectingHint: { color: colors.textMuted, fontSize: 14 },
  container: { flex: 1, backgroundColor: '#000000' },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  hiddenVideo: { width: 1, height: 1 },
  info: { padding: theme.spacing.md },
  channelLine: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  channelName: { color: colors.text, fontSize: 20, fontWeight: '600', flexShrink: 1 },
  airtime: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  blocked: {
    marginHorizontal: theme.spacing.md,
    padding: theme.spacing.md,
    borderRadius: theme.radius,
    backgroundColor: colors.surface,
  },
  blockedTitle: { color: colors.text, fontSize: 14, fontWeight: '600' },
  blockedText: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: theme.spacing.xs,
    lineHeight: 18,
  },
  blockedAction: { alignSelf: 'flex-start', marginTop: theme.spacing.sm, minHeight: 20 },
  blockedActionText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  nowTitle: { color: colors.text, fontSize: 15, marginTop: theme.spacing.xs },
  nextTitle: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  badge: { color: colors.accent, fontSize: 13, marginTop: theme.spacing.sm },
  warn: {
    color: colors.danger,
    fontSize: 13,
    marginTop: theme.spacing.sm,
    lineHeight: 18,
  },
  error: { color: colors.danger, fontSize: 13, marginTop: theme.spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', padding: theme.spacing.md, gap: theme.spacing.sm },
  button: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  buttonAccent: { backgroundColor: colors.accent },
  videoInfo: { color: colors.textMuted, fontSize: 12, alignSelf: 'center', paddingHorizontal: theme.spacing.sm },
  buttonDone: { backgroundColor: colors.surface },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
});
