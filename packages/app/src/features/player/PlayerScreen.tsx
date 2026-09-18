import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { SubtitleTrack } from 'expo-video';
import { buildTimeshiftUrl, detectTimeshiftDialect } from '@norstream/core';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
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
import { FALLBACK_FORMAT, formatForPlatform, hasFormatFallback, surfaceTypeForPlatform } from './format.js';
import { restartBlockFor, restartHint } from './restart.js';
import { TrackPicker } from './TrackPicker.js';
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
/** Hvor laenge afspilleren maa haenge i buffering foer vi kalder det et udfald. */
const STALL_TIMEOUT_MS = 15_000;

export function PlayerScreen({
  session,
  channel: initialChannel,
  onBack,
  startFrom: initialStartFrom,
  zap,
  resumeAtSeconds,
}: Props) {
  const styles = useStyles(makeStyles);
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
  const [source, setSource] = useState<string | null>(() =>
    startFrom !== undefined ? null : liveUrlFor(access, channel, formatForPlatform()),
  );
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

  // "Se videre" oeverst i favoritterne: den kanal der sidst blev set.
  useEffect(() => {
    void setLastChannelId(session.db, channel.id).catch(() => undefined);
    // Og forsidens "Sidst sete".
    void recordChannelWatch(session.db, channel.id).catch(() => undefined);
  }, [session.db, channel.id]);

  const zapList = zap ?? [];
  const zapIndex = zapList.findIndex((entry) => entry.id === channel.id);

  const zapTo = useCallback(
    (target: StoredChannel): void => {
      if (target.id === channel.id) return;
      setPrevious(channel);
      setChannel(target);
      setStartFrom(undefined);
      setRestarted(false);
      setFellBackToLive(false);
      setTriedFallback(false);
      setStreamError(null);
      setRestartBlock(undefined);
      setNow(null);
      setNext(null);
      setBannerUntil(Date.now() + 3_000);
      setSource(liveUrlFor(session.access(target.sourceId), target, formatForPlatform()));
    },
    [channel, session],
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
  const isRadio = /radio/i.test(channel.name) || isRadioKey(channel.id);
  // Sang og cover, kun for internetradio (stationens egen Icecast-adresse):
  // panelets radiokanaler gaar gennem panelet og sender ingen titel.
  const nowPlaying = useRadioNowPlaying(isRadioKey(channel.id) ? channel.streamUrl : null, channel.name, isRadio && radioState === 'playing');
  const saveSong = useSaveSong(session.db, nowPlaying, channel.name);
  const player = useVideoPlayer(source === null ? null : streamSource(source), (p) => {
    p.loop = false;
    p.staysActiveInBackground = isRadio;
    p.showNowPlayingNotification = isRadio;
    // Hvert sekund: hvor langt arkivstreamen er naaet, til "Fortsaet".
    p.timeUpdateEventInterval = 1;
    p.play();
  });

  /**
   * Fremdrift i arkivet, til forsidens "Fortsaet": gemmes hvert tiende
   * sekund mens en udsendelse startet forfra spiller. Og "Fortsaet" den
   * anden vej: naar streamen er klar, spoles der til hvor man slap.
   */
  const lastSaved = useRef(0);
  const resumed = useRef(false);
  useEffect(() => {
    const subscription = player.addListener('timeUpdate', ({ currentTime }: { currentTime: number }) => {
      if (!restarted || startFrom === undefined || !Number.isFinite(currentTime)) return;
      if (currentTime - lastSaved.current < 10 && currentTime >= lastSaved.current) return;
      lastSaved.current = currentTime;
      void saveArchiveProgress(session.db, channel.id, startFrom, currentTime).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [player, restarted, startFrom, session.db, channel.id]);
  useEffect(() => {
    if (resumeAtSeconds === undefined || resumeAtSeconds <= 0) return;
    const subscription = player.addListener('statusChange', ({ status }: { status: string }) => {
      if (status !== 'readyToPlay' || resumed.current || !restarted) return;
      resumed.current = true;
      try {
        player.currentTime = resumeAtSeconds;
      } catch {
        // Afspilleren er vaek.
      }
    });
    return () => subscription.remove();
  }, [player, resumeAtSeconds, restarted]);
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

  /**
   * Start-forfra naaede den levende kant — fortsaet direkte i stedet for sort.
   *
   * Ser man en udsendelse forfra mens den stadig sendes, findes arkivet kun
   * frem til "nu". Naar afspilningen indhenter det, melder expo-video
   * playToEnd, og billedet ville ellers staa sort midt i udsendelsen (en far
   * meldte netop det paa TV 2). Sender udsendelsen stadig, skifter vi til
   * live-streamen, saa resten ses direkte. Er programmet rigtigt slut (et
   * afsluttet program aabnet fra guiden), roeres intet — arkivet sluttede,
   * fordi udsendelsen sluttede.
   */
  const caughtUpHandled = useRef(false);
  useEffect(() => {
    if (restarted) caughtUpHandled.current = false;
  }, [restarted]);
  useEffect(() => {
    const subscription = player.addListener('playToEnd', () => {
      if (isRadio || !restarted || caughtUpHandled.current) return;
      const airing = startFrom ?? now;
      if (airing === null || airing.stop.getTime() <= Date.now()) return;
      caughtUpHandled.current = true;
      setRestarted(false);
      setCaughtUpToLive(true);
      setBannerUntil(Date.now() + 3_000);
      setSource(liveUrlFor(access, channel, formatForPlatform()));
    });
    return () => subscription.remove();
  }, [player, isRadio, restarted, startFrom, now, access, channel]);

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
    player.replace(streamSource(source));
    player.play();
  }, [player, source]);

  // Spec sec.9: IPTV-streams falder ud hele tiden. To forsoeg med backoff,
  // derefter fallback til det andet containerformat der hvor et saadant
  // findes, og automatisk genforbindelse naar afspilningen stopper eller
  // haenger midt i. Uden det opfoerer appen sig som de Norlys-anmeldelser
  // der klagede over konstante udfald.
  useEffect(() => {
    if (source === null) return;

    let cancelled = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    function clearStallTimer(): void {
      if (stallTimer !== null) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
    }

    // Faelles vej for baade haarde fejl og stall.
    function handleFailure(): void {
      if (cancelled) return;
      clearStallTimer();

      attempt += 1;
      if (attempt <= MAX_RETRIES) {
        if (retryTimer !== null) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          if (cancelled || source === null) return;
          player.replace(streamSource(source));
          player.play();
        }, attempt * RETRY_BACKOFF_MS);
        return;
      }

      // Foerst efter at begge forsoeg fejlede proever vi det andet format, og
      // kun hvor der findes et brugbart et — se hasFormatFallback(). Under
      // start-forfra springes fallback ogsaa over: timeshift-URLen er altid
      // HLS uanset platform.
      if (hasFormatFallback() && !triedFallback && !restarted) {
        setTriedFallback(true);
        attempt = 0;
        setSource(liveUrlFor(access, channel, FALLBACK_FORMAT));
        return;
      }

      // Den raa besked fra expo-video maa aldrig vises. Den stammer fra
      // ExoPlayer eller AVPlayer, som rutinemaessigt skriver den fejlende URI
      // ind i teksten — og live-URLen har panelets adgangskode som et
      // sti-segment. En fast dansk tekst i stedet, aldrig error.message.
      setStreamError('Streamen kunne ikke afspilles. Prøv igen.');
    }

    const subscription = player.addListener(
      'statusChange',
      ({ status }: { status: string }) => {
        if (cancelled) return;

        if (status === 'readyToPlay') {
          attempt = 0;
          clearStallTimer();
          setStreamError(null);
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
          setRadioState('playing');
          // Sporene kan vaere meldt foer lytteren kom paa. Laeses her igen.
          setSubtitleTracks(player.availableSubtitleTracks);
          setSubtitle(player.subtitleTrack);
          autoSelectSubtitle(player.availableSubtitleTracks);
          return;
        }

        if (status === 'error') {
          setAudioState('Streamen svarede med en fejl');
          setRadioState('error');
          handleFailure();
          return;
        }
        if (status === 'loading') {
          setAudioState('Forbinder …');
          setRadioState('connecting');
        }

        // Spec sec.9 kraever ogsaa genforbindelse paa buffer-haendelser:
        // bliver afspilleren haengende i 'loading' uden at komme videre, er
        // streamen faldet ud midt i afspilningen, selv om der aldrig kom en
        // egentlig fejl.
        if (status === 'loading' && stallTimer === null) {
          stallTimer = setTimeout(handleFailure, STALL_TIMEOUT_MS);
        }
      },
    );

    return () => {
      cancelled = true;
      clearStallTimer();
      if (retryTimer !== null) clearTimeout(retryTimer);
      subscription.remove();
    };
  }, [player, source, triedFallback, restarted, access, channel, autoSelectSubtitle]);

  const playFromStart = useCallback(
    async (programme: Programme): Promise<void> => {
      const dialect = await getTimeshiftDialect(session.db, channel.sourceId);
      if (dialect === null || access?.creds == null) {
        // Uden dialekt kan arkiv-URLen ikke bygges. Kom vi fra guiden, staar
        // skaermen sort uden dette: fald tilbage paa live frem for ingenting —
        // men sig det, i stedet for at lade folk tro at trykket ikke virkede.
        setSource((current) => current ?? liveUrlFor(access, channel, formatForPlatform()));
        setRestarted(false);
        setFellBackToLive(true);
        setRestartBlock(restartBlockFor(channel.hasArchive, false, true));
        return;
      }
      setFellBackToLive(false);
      const offset = await getPanelOffsetMinutes(session.db, channel.sourceId);

      const durationMinutes = Math.ceil(
        (programme.stop.getTime() - programme.start.getTime()) / 60_000,
      );
      // Samme beholder som live (.ts paa Android): arkivet som HLS gav groen
      // skaerm med lyd paa DR-kanalerne paa tv, mens live i .ts var fint.
      // Streamformat under Indstillinger gaelder ogsaa her.
      setSource(
        buildTimeshiftUrl(
          access.creds,
          channel.streamId,
          programme.start,
          durationMinutes,
          dialect,
          offset,
          formatForPlatform(),
        ),
      );
      setRestarted(true);
    },
    [session.db, access, channel],
  );

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
  const startFromHandled = useRef(false);
  useEffect(() => {
    if (startFrom === undefined || startFromHandled.current) return;
    startFromHandled.current = true;
    void playFromStart(startFrom);
  }, [startFrom, playFromStart]);

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
      {restarted && isTV && <SeekButtons player={player} playing={playing} preferFocus />}
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
      {zapList.length > 1 && zapIndex !== -1 && (
        <>
          <TvPressable
            style={styles.button}
            hitSlop={6}
            onPress={() => {
              const target = zapList[(zapIndex - 1 + zapList.length) % zapList.length];
              if (target !== undefined) zapTo(target);
            }}
          >
            <Text style={styles.buttonText}>‹</Text>
          </TvPressable>
          <TvPressable
            style={styles.button}
            hitSlop={6}
            onPress={() => {
              const target = zapList[(zapIndex + 1) % zapList.length];
              if (target !== undefined) zapTo(target);
            }}
          >
            <Text style={styles.buttonText}>›</Text>
          </TvPressable>
        </>
      )}
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
        onPlayerKey={(key) => {
          try {
            if (key === 'select' || key === 'playPause') {
              if (player.playing) player.pause();
              else player.play();
              return true;
            }
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
            {subtitlePicker}
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
