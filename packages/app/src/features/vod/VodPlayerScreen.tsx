import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import { streamSource } from '../../net/doh.js';
import type { AudioTrack, SubtitleTrack } from 'expo-video';
import type { AppSession } from '../../session.js';
import { getSubtitlePreference } from '../../storage/settings.js';
import type { SubtitlePreference } from '../../storage/settings.js';
import { getVodItem, listEpisodes, saveProgress, setWatched } from '../../storage/vod.js';
import { cleanVodTitle } from '../../sync/tmdb.js';
import { removeWatchNext, updateWatchNext } from './watchNext.js';
import type { WatchNextEntry } from './watchNext.js';
import type { StoredEpisode } from '../../storage/vod.js';
import { buildEpisodeUrl } from '@norstream/core';
import { nextEpisode } from './episodes.js';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import type { Playback } from './VodDetailScreen.js';
import { TrackPicker } from '../player/TrackPicker.js';
import { LandscapePlayer, useLandscape } from '../player/Landscape.js';
import { externalSubtitleLanguage, pickPreferredSubtitle, sameTrack, trackName } from '../player/tracks.js';
import { SubtitleOverlay } from './SubtitleOverlay.js';
import { loadExternalSubtitles } from './externalSubtitles.js';
import type { Cue } from './openSubtitles.js';
import { SeekButtons } from '../player/SeekButtons.js';
import { surfaceTypeForPlatform } from '../player/format.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';

interface Props {
  session: AppSession;
  playback: Playback;
  onBack: () => void;
}

/** Hvor tit fremdriften skrives. Hvert tiende sekund er nok til "Fortsaet". */
const PROGRESS_INTERVAL_MS = 10_000;

type Picker = 'subtitles' | 'audio' | null;

/** Sprogets navn til undertekst-knappen for hentede undertekster. */
const LANGUAGE_NAMES: Record<string, string> = { da: 'Dansk', en: 'Engelsk', sv: 'Svensk', no: 'Norsk', de: 'Tysk' };

/** Saa laenge efter "klar" ventes paa at filens egne spor er meldt, foer der hentes udefra. */
const EXTERNAL_DELAY_MS = 3000;

/** Sekunder fra et afsnit slutter til det naeste begynder af sig selv. */
const NEXT_COUNTDOWN_S = 10;

/**
 * Afspilleren for film og afsnit.
 *
 * Adskilt fra live-afspilleren, som handler om programdata, arkiv og
 * optagelse — intet af det findes for en film. Til gengaeld findes der spor:
 * en film har tit flere lydspor og undertekster, og de vaelges her. Listen
 * kommer fra afspilleren selv, naar filen er aabnet; foer det ved ingen hvad
 * filen indeholder.
 *
 * Fremdriften gemmes loebende og naar man gaar tilbage, saa "Fortsaet" ved
 * hvor den skal begynde. Samme skaerm, samme regel for film og afsnit.
 */
export function VodPlayerScreen({ session, playback, onBack }: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const landscape = useLandscape();
  /**
   * Det der spilles lige nu. Begynder som det man kom med, og skifter naar
   * naeste afsnit tager over — samme skaerm, ny fil, saa panelets ene
   * forbindelse slippes og tages ét sted.
   */
  const [current, setCurrent] = useState(playback);
  /** Naeste afsnit, naar det nuvaerende er slut, med nedtaelling. */
  const [upcoming, setUpcoming] = useState<StoredEpisode | null>(null);
  const [countdown, setCountdown] = useState(NEXT_COUNTDOWN_S);
  const [picker, setPicker] = useState<Picker>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [subtitle, setSubtitle] = useState<SubtitleTrack | null>(null);
  const [audio, setAudio] = useState<AudioTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resumed = useRef(false);
  /**
   * Undertekster hentet udefra (OpenSubtitles, v338), naar filen ikke selv
   * har dem paa det oenskede sprog. `active`: de vises (og filens egne er
   * slaaet fra). Tegnes af SubtitleOverlay.
   */
  const [external, setExternal] = useState<{ cues: Cue[]; index: number; count: number; language: string } | null>(null);
  const [externalActive, setExternalActive] = useState(false);
  const [externalStatus, setExternalStatus] = useState<{ kind: 'idle' | 'loading' | 'none' | 'nokey' | 'error'; message?: string }>({
    kind: 'idle',
  });

  const player = useVideoPlayer(streamSource(current.url), (p) => {
    p.loop = false;
    // Buffer mere frem, saa film koerer flydende ogsaa naar panelet leverer i
    // stoed. Standarden er kun 20 sek frem og genoptager efter 2 sek buffer —
    // paa en server der sender ujaevnt naar den saa lige tomt igen og hakkede.
    // Ikke baandbredden (brugeren har 400 Mbit), men hvor meget der ligger klar.
    // preferredForwardBufferDuration: 60 sek frem. minBufferForPlayback: vent
    // til 5 sek er hentet foer der spilles videre efter en pause/buffering, saa
    // den ikke starter paa en tynd buffer og straks staar igen.
    // prioritizeTimeOverSizeThreshold: hold de 60 sek selv paa hoej bitrate.
    p.bufferOptions = {
      preferredForwardBufferDuration: 60,
      minBufferForPlayback: 5,
      prioritizeTimeOverSizeThreshold: true,
    };
    // Én gang i sekundet melder afspilleren hvor langt den er. Det er den
    // eneste kilde til fremdriften ved afgang; se `lastKnown`.
    p.timeUpdateEventInterval = 1;
    p.play();
  });

  /**
   * Hvor langt afspilningen sidst var, uden at spoerge afspilleren.
   *
   * Ved afgang frigiver expo-video afspilleren i **sin** oprydning, og den
   * ligger foer vores i raekkefoelgen. Laeses `player.currentTime` derefter,
   * kaster den frigivne afspiller — og en fejl i en oprydning lukker hele
   * appen. Det var det der skete naar man trykkede tilbage under en film.
   * Derfor holdes tallet her, opdateret af afspilleren mens den lever.
   */
  const lastKnown = useRef<{ position: number; duration: number | null }>({
    position: current.resumeAtSeconds ?? 0,
    duration: null,
  });

  /** Laeser sporene af afspilleren. Kaldes naar filen er aabnet — foer det er de tomme. */
  const readTracks = useCallback((): void => {
    setSubtitleTracks(player.availableSubtitleTracks);
    setAudioTracks(player.availableAudioTracks);
    setSubtitle(player.subtitleTrack);
    setAudio(player.audioTrack);
  }, [player]);

  /**
   * Vaelger sproget selv, foerste gang sporene kendes.
   *
   * Brugeren skrev at "dansk tekster ikke kommer med". Filerne bar sporene;
   * afspilleren viste bare ingen af dem foer man selv gik ind og valgte.
   * Det foretrukne sprog fra Indstillinger foerst — som standard telefonens
   * eget — saa engelsk, ellers intet. Kun naar der ikke allerede er valgt et,
   * saa et valg man har taget ikke bliver overskrevet naar sporene meldes
   * igen. Foer indstillingen er laest, vaelges intet: ellers kunne
   * telefonens sprog vinde over det man selv har bedt om.
   */
  const autoPicked = useRef(false);
  const preference = useRef<SubtitlePreference | null>(null);
  const autoSelect = useCallback(
    (tracks: SubtitleTrack[]): void => {
      const preferred = preference.current;
      if (preferred === null || autoPicked.current || player.subtitleTrack !== null) return;
      if (preferred === 'off') {
        autoPicked.current = true;
        return;
      }
      const track = pickPreferredSubtitle(tracks, preferred);
      if (track !== null) {
        autoPicked.current = true;
        player.subtitleTrack = track;
        setSubtitle(track);
      }
    },
    [player],
  );

  useEffect(() => {
    let cancelled = false;
    void getSubtitlePreference(session.db).then((value) => {
      if (cancelled) return;
      preference.current = value;
      // Sporene kan vaere meldt mens indstillingen blev laest.
      try {
        autoSelect(player.availableSubtitleTracks);
      } catch {
        // Afspilleren er vaek allerede.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [session.db, player, autoSelect]);

  /** Henter undertekster udefra; `index` > 0 er "proev en anden". */
  const fetchExternal = useCallback(
    async (language: string, index: number): Promise<void> => {
      setExternalStatus({ kind: 'loading' });
      const url = current.url;
      const result = await loadExternalSubtitles(session.db, {
        progressKey: current.progressKey,
        seriesKey: current.seriesKey,
        episodeKey: current.episodeKey,
        language,
        index,
      });
      // Et andet afsnit er begyndt imens: svaret gaelder ikke laengere.
      if (currentUrl.current !== url) return;
      if (result.kind === 'ok') {
        setExternal({ cues: result.cues, index: result.index, count: result.count, language });
        setExternalActive(true);
        setExternalStatus({ kind: 'idle' });
        try {
          player.subtitleTrack = null;
        } catch {
          // Afspilleren er vaek.
        }
        setSubtitle(null);
      } else if (result.kind === 'error') {
        setExternalStatus({ kind: 'error', message: result.message });
      } else {
        setExternalStatus({ kind: result.kind });
      }
    },
    [session.db, current.url, current.progressKey, current.seriesKey, current.episodeKey, player],
  );
  const currentUrl = useRef(current.url);
  currentUrl.current = current.url;

  // Sporene meldes for sig, og tit et oejeblik **efter** at filen er klar til
  // afspilning. Laeses de kun ved readyToPlay, staar listen tom.
  useEffect(() => {
    const subtitles = player.addListener(
      'availableSubtitleTracksChange',
      ({ availableSubtitleTracks }: { availableSubtitleTracks: SubtitleTrack[] }) => {
        setSubtitleTracks(availableSubtitleTracks);
        autoSelect(availableSubtitleTracks);
      },
    );
    const audio = player.addListener(
      'availableAudioTracksChange',
      ({ availableAudioTracks }: { availableAudioTracks: AudioTrack[] }) => {
        setAudioTracks(availableAudioTracks);
        setAudio(player.audioTrack);
      },
    );
    return () => {
      subtitles.remove();
      audio.remove();
    };
  }, [player, autoSelect]);

  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    const subscription = player.addListener('playingChange', ({ isPlaying }: { isPlaying: boolean }) => {
      setPlaying(isPlaying);
    });
    return () => subscription.remove();
  }, [player]);

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status }: { status: string }) => {
      if (status === 'readyToPlay') {
        setError(null);
        readTracks();
        autoSelect(player.availableSubtitleTracks);
        // Mangler filen undertekster paa det oenskede sprog, hentes de udefra —
        // lidt efter, for sporene meldes tit efter "klar".
        if (!externalTried.current) {
          externalTried.current = true;
          setTimeout(() => {
            try {
              const preferred = preference.current ?? 'auto';
              const language = externalSubtitleLanguage(player.availableSubtitleTracks, preferred);
              if (language !== null) void fetchExternal(language, 0);
            } catch {
              // Afspilleren er vaek.
            }
          }, EXTERNAL_DELAY_MS);
        }
        // Foerst her: et hop foer filen er aabnet, bliver ignoreret.
        if (!resumed.current && current.resumeAtSeconds !== null && current.resumeAtSeconds > 0) {
          resumed.current = true;
          player.currentTime = current.resumeAtSeconds;
        }
      }
      if (status === 'error') {
        // Aldrig den raa besked: adressen baerer panelets kodeord, og ExoPlayer
        // skriver rutinemaessigt adressen ind i teksten.
        setError('Filmen kunne ikke afspilles. Prøv igen, eller prøv et andet afsnit.');
      }
    });
    return () => subscription.remove();
  }, [player, current.resumeAtSeconds, readTracks, autoSelect, fetchExternal]);

  useEffect(() => {
    const subscription = player.addListener('timeUpdate', ({ currentTime }: { currentTime: number }) => {
      if (!Number.isFinite(currentTime) || currentTime <= 0) return;
      let duration: number | null = null;
      try {
        duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : null;
      } catch {
        // Afspilleren er paa vej vaek. Positionen er stadig god.
      }
      lastKnown.current = { position: currentTime, duration };
    });
    return () => subscription.remove();
  }, [player]);

  // En ny fil: hop, sprogvalg og kendt position begynder forfra.
  const externalTried = useRef(false);
  useEffect(() => {
    resumed.current = false;
    autoPicked.current = false;
    externalTried.current = false;
    setExternal(null);
    setExternalActive(false);
    setExternalStatus({ kind: 'idle' });
    lastKnown.current = { position: current.resumeAtSeconds ?? 0, duration: null };
  }, [current.url, current.resumeAtSeconds]);

  /**
   * Slut paa filen: set faerdig, og for et afsnit findes det naeste med
   * en nedtaelling. Skiftet sker paa samme skaerm, saa panelets ene
   * forbindelse slippes og tages ét sted.
   */
  useEffect(() => {
    const subscription = player.addListener('playToEnd', () => {
      void setWatched(session.db, current.progressKey, true).catch(() => undefined);
      // Set til ende: ud af Google TV's "Fortsaet med at se". For en serie
      // kommer den igen, naar man er i gang med naeste afsnit.
      if (isTV) void removeWatchNext(current.seriesKey ?? current.progressKey);
      if (current.seriesKey === null || current.episodeKey === null) return;
      const seriesKey = current.seriesKey;
      const episodeKey = current.episodeKey;
      void listEpisodes(session.db, seriesKey).then((episodes) => {
        const next = nextEpisode(episodes, episodeKey);
        if (next === null) return;
        setCountdown(NEXT_COUNTDOWN_S);
        setUpcoming(next);
      });
    });
    return () => subscription.remove();
  }, [player, session.db, current]);

  const playNext = useCallback(
    (episode: StoredEpisode): void => {
      const creds = session.access(current.sourceId)?.creds ?? null;
      setUpcoming(null);
      if (creds === null) return;
      setCurrent({
        url: buildEpisodeUrl(creds, episode.id, episode.containerExtension),
        title: current.title,
        subtitle: `S${episode.season} · E${episode.episode} · ${episode.title}`,
        progressKey: episode.key,
        resumeAtSeconds: episode.positionSeconds,
        sourceId: current.sourceId,
        seriesKey: current.seriesKey,
        episodeKey: episode.key,
      });
    },
    [session, current],
  );

  useEffect(() => {
    if (upcoming === null) return;
    if (countdown <= 0) {
      playNext(upcoming);
      return;
    }
    const timer = setTimeout(() => setCountdown((value) => value - 1), 1_000);
    return () => clearTimeout(timer);
  }, [upcoming, countdown, playNext]);

  // Fremdriften. Skrives hvert tiende sekund og ved afgang — fra `lastKnown`,
  // aldrig fra afspilleren, som kan vaere frigivet naar oprydningen koerer.
  /**
   * Titel, plakat og afsnit til Google TV's "Fortsaet med at se" (v338,
   * kun tv). Laeses én gang per fil; posten opdateres naar fremdriften gemmes.
   */
  const watchNextInfo = useRef<Omit<WatchNextEntry, 'positionS' | 'durationS'> | null>(null);
  useEffect(() => {
    watchNextInfo.current = null;
    if (!isTV) return undefined;
    let cancelled = false;
    const key = current.seriesKey ?? current.progressKey;
    void (async () => {
      const item = await getVodItem(session.db, key);
      if (cancelled || item === null) return;
      let episode: WatchNextEntry['episode'] = null;
      if (current.seriesKey !== null && current.episodeKey !== null) {
        const found = (await listEpisodes(session.db, current.seriesKey)).find((e) => e.key === current.episodeKey);
        if (found !== undefined) episode = { key: found.key, season: found.season, number: found.episode, title: found.title };
      }
      if (cancelled) return;
      const clean = cleanVodTitle(item.name).title;
      watchNextInfo.current = {
        key,
        title: clean.length > 0 ? clean : item.name,
        posterUrl: item.foundPosterUrl ?? item.posterUrl,
        episode,
      };
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [session.db, current.seriesKey, current.progressKey, current.episodeKey]);

  const persist = useCallback(
    (leaving = false): void => {
      const { position, duration } = lastKnown.current;
      if (position <= 0) return;
      void saveProgress(session.db, current.progressKey, position, duration).catch(() => undefined);
      const info = watchNextInfo.current;
      if (info !== null) void updateWatchNext({ ...info, positionS: position, durationS: duration }, leaving);
    },
    [session.db, current.progressKey],
  );

  useEffect(() => {
    const timer = setInterval(() => persist(false), PROGRESS_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      persist(true);
    };
  }, [persist]);

  function chooseSubtitle(track: SubtitleTrack | null): void {
    player.subtitleTrack = track;
    setSubtitle(track);
    setExternalActive(false);
    setPicker(null);
  }

  /** Valgene for undertekster udefra i listen: vis, proev en anden, eller hent. */
  function externalOptions(): Array<{ key: string; label: string; active: boolean; onPress: () => void }> {
    if (external !== null) {
      const name = LANGUAGE_NAMES[external.language] ?? external.language;
      const options = [
        {
          key: 'os',
          label: `${name} (OpenSubtitles)`,
          active: externalActive,
          onPress: () => {
            player.subtitleTrack = null;
            setSubtitle(null);
            setExternalActive(true);
            setPicker(null);
          },
        },
      ];
      if (external.index + 1 < external.count) {
        options.push({
          key: 'os-next',
          label: externalStatus.kind === 'loading' ? 'Henter en anden …' : 'Passer den ikke? Prøv en anden',
          active: false,
          onPress: () => {
            if (externalStatus.kind !== 'loading') void fetchExternal(external.language, external.index + 1);
          },
        });
      }
      return options;
    }
    const language = externalSubtitleLanguage([], preference.current ?? 'auto') ?? 'da';
    const name = (LANGUAGE_NAMES[language] ?? language).toLowerCase();
    const label =
      externalStatus.kind === 'loading'
        ? `Henter ${name} fra OpenSubtitles …`
        : externalStatus.kind === 'none'
          ? `OpenSubtitles har ingen ${name} til denne`
          : externalStatus.kind === 'nokey'
            ? 'OpenSubtitles: indtast nøgle under Indstillinger'
            : externalStatus.kind === 'error'
              ? `OpenSubtitles: ${externalStatus.message ?? 'fejl'}`
              : `Hent ${name} fra OpenSubtitles`;
    return [
      {
        key: 'os-fetch',
        label,
        active: false,
        onPress: () => {
          if (externalStatus.kind === 'idle' || externalStatus.kind === 'error') void fetchExternal(language, 0);
        },
      },
    ];
  }

  function chooseAudio(track: AudioTrack): void {
    player.audioTrack = track;
    setAudio(track);
    setPicker(null);
  }

  const actions = (
    <>
      {!isTV && (
        <TvPressable style={styles.button} onPress={onBack}>
          <Text style={styles.buttonText}>Tilbage</Text>
        </TvPressable>
      )}
      {/* Paa tv er afspillerens egne knapper slaaet fra: pause og spoling
          her, og foerst i raekken, for det er dem fokus lander paa. */}
      {isTV && <SeekButtons player={player} playing={playing} preferFocus />}
      <TvPressable
        style={styles.button}
        onPress={() => {
          readTracks();
          setPicker(picker === 'subtitles' ? null : 'subtitles');
        }}
      >
        <Text style={styles.buttonText}>
          Undertekster
          {externalActive && external !== null
            ? `: ${LANGUAGE_NAMES[external.language] ?? external.language}`
            : subtitle !== null
              ? `: ${trackName(subtitle)}`
              : ''}
        </Text>
      </TvPressable>
      <TvPressable
        style={styles.button}
        onPress={() => {
          readTracks();
          setPicker(picker === 'audio' ? null : 'audio');
        }}
      >
        <Text style={styles.buttonText}>Lyd{audio !== null ? `: ${trackName(audio)}` : ''}</Text>
      </TvPressable>
    </>
  );

  const nextOverlay =
    upcoming !== null ? (
      <View style={styles.next}>
        <Text style={styles.nextLabel}>Næste afsnit</Text>
        <Text style={styles.nextTitle} numberOfLines={2}>
          S{upcoming.season} · E{upcoming.episode} · {upcoming.title}
        </Text>
        <View style={styles.nextRow}>
          <TvPressable style={[styles.button, styles.buttonAccent]} onPress={() => playNext(upcoming)}>
            <Text style={styles.buttonText}>▶ Afspil nu ({countdown})</Text>
          </TvPressable>
          <TvPressable style={styles.button} onPress={() => setUpcoming(null)}>
            <Text style={styles.buttonText}>Annuller</Text>
          </TvPressable>
        </View>
      </View>
    ) : null;

  const externalOverlay =
    externalActive && external !== null ? <SubtitleOverlay player={player} cues={external.cues} /> : null;

  const pickers = (
    <>
      {nextOverlay}
      {picker === 'subtitles' && (
        <TrackPicker
          title="Undertekster"
          options={[
            { key: 'none', label: 'Ingen', active: subtitle === null && !externalActive, onPress: () => chooseSubtitle(null) },
            ...subtitleTracks.map((track, index) => ({
              key: track.id ?? `${track.language}-${index}`,
              label: trackName(track),
              active: subtitle !== null && sameTrack(subtitle, track) && !externalActive,
              onPress: () => chooseSubtitle(track),
            })),
            ...externalOptions(),
          ]}
          emptyText="Filen har ingen undertekstspor."
          onClose={() => setPicker(null)}
        />
      )}
      {picker === 'audio' && (
        <TrackPicker
          title="Lydspor"
          options={audioTracks.map((track, index) => ({
            key: track.id ?? `${track.language}-${index}`,
            label: trackName(track),
            active: audio !== null && sameTrack(audio, track),
            onPress: () => chooseAudio(track),
          }))}
          emptyText="Filen har kun ét lydspor."
          onClose={() => setPicker(null)}
        />
      )}
    </>
  );

  if (landscape) {
    return (
      <LandscapePlayer
        video={<VideoView style={StyleSheet.absoluteFill} player={player} nativeControls={!isTV} surfaceType={surfaceTypeForPlatform()} />}
        bar={actions}
        overlays={
          <>
            {externalOverlay}
            {pickers}
          </>
        }
        playing={playing}
        // Paa tv: bjaelken skjult fra start, saa pil venstre/hoejre spoler i
        // filmen med det samme. Pil op henter knapperne (Undertekster, Lyd).
        initialBarShown={!isTV}
        onPlayerKey={(key) => {
          try {
            if (key === 'select' || key === 'playPause') {
              if (player.playing) player.pause();
              else player.play();
            } else if (key === 'left' || key === 'rewind') player.seekBy(-10);
            else player.seekBy(30);
            return true;
          } catch {
            return false;
          }
        }}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.video}>
        <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls />
        {externalActive && external !== null && <SubtitleOverlay player={player} cues={external.cues} bottom={8} />}
      </View>

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {current.title}
        </Text>
        {current.subtitle !== null && (
          <Text style={styles.subtitleLine} numberOfLines={1}>
            {current.subtitle}
          </Text>
        )}
        {error !== null && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={[styles.actions, { paddingBottom: theme.spacing.md + insets.bottom }]}>{actions}</View>

      {pickers}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  info: { padding: theme.spacing.md, backgroundColor: colors.background, flex: 1 },
  title: { color: colors.text, fontSize: 18, fontWeight: '700' },
  subtitleLine: { color: colors.textMuted, fontSize: 14, marginTop: 4 },
  error: { color: colors.danger, marginTop: theme.spacing.sm },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    backgroundColor: colors.background,
  },
  button: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm + 2,
    paddingHorizontal: theme.spacing.md,
  },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  buttonAccent: { backgroundColor: colors.accent },
  next: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: 96,
    padding: theme.spacing.md,
    borderRadius: theme.radius,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 8,
  },
  nextLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  nextTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 4 },
  nextRow: { flexDirection: 'row', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
});
