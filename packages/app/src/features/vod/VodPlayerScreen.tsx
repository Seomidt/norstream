import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import type { AudioTrack, SubtitleTrack } from 'expo-video';
import type { AppSession } from '../../session.js';
import { getSubtitlePreference } from '../../storage/settings.js';
import type { SubtitlePreference } from '../../storage/settings.js';
import { saveProgress } from '../../storage/vod.js';
import { theme } from '../../ui/theme.js';
import type { Playback } from './VodDetailScreen.js';
import { TrackPicker } from '../player/TrackPicker.js';
import { LandscapePlayer, useLandscape } from '../player/Landscape.js';
import { pickPreferredSubtitle, sameTrack, trackName } from '../player/tracks.js';

interface Props {
  session: AppSession;
  playback: Playback;
  onBack: () => void;
}

/** Hvor tit fremdriften skrives. Hvert tiende sekund er nok til "Fortsaet". */
const PROGRESS_INTERVAL_MS = 10_000;

type Picker = 'subtitles' | 'audio' | null;

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
  const insets = useSafeAreaInsets();
  const landscape = useLandscape();
  const [picker, setPicker] = useState<Picker>(null);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [subtitle, setSubtitle] = useState<SubtitleTrack | null>(null);
  const [audio, setAudio] = useState<AudioTrack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const resumed = useRef(false);

  const player = useVideoPlayer(playback.url, (p) => {
    p.loop = false;
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
    position: playback.resumeAtSeconds ?? 0,
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

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status }: { status: string }) => {
      if (status === 'readyToPlay') {
        setError(null);
        readTracks();
        autoSelect(player.availableSubtitleTracks);
        // Foerst her: et hop foer filen er aabnet, bliver ignoreret.
        if (!resumed.current && playback.resumeAtSeconds !== null && playback.resumeAtSeconds > 0) {
          resumed.current = true;
          player.currentTime = playback.resumeAtSeconds;
        }
      }
      if (status === 'error') {
        // Aldrig den raa besked: adressen baerer panelets kodeord, og ExoPlayer
        // skriver rutinemaessigt adressen ind i teksten.
        setError('Filmen kunne ikke afspilles. Prøv igen, eller prøv et andet afsnit.');
      }
    });
    return () => subscription.remove();
  }, [player, playback.resumeAtSeconds, readTracks, autoSelect]);

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

  // Fremdriften. Skrives hvert tiende sekund og ved afgang — fra `lastKnown`,
  // aldrig fra afspilleren, som kan vaere frigivet naar oprydningen koerer.
  const persist = useCallback((): void => {
    const { position, duration } = lastKnown.current;
    if (position <= 0) return;
    void saveProgress(session.db, playback.progressKey, position, duration).catch(() => undefined);
  }, [session.db, playback.progressKey]);

  useEffect(() => {
    const timer = setInterval(persist, PROGRESS_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      persist();
    };
  }, [persist]);

  function chooseSubtitle(track: SubtitleTrack | null): void {
    player.subtitleTrack = track;
    setSubtitle(track);
    setPicker(null);
  }

  function chooseAudio(track: AudioTrack): void {
    player.audioTrack = track;
    setAudio(track);
    setPicker(null);
  }

  const actions = (
    <>
      <Pressable style={styles.button} onPress={onBack}>
        <Text style={styles.buttonText}>Tilbage</Text>
      </Pressable>
      <Pressable
        style={styles.button}
        onPress={() => {
          readTracks();
          setPicker(picker === 'subtitles' ? null : 'subtitles');
        }}
      >
        <Text style={styles.buttonText}>
          Undertekster{subtitle !== null ? `: ${trackName(subtitle)}` : ''}
        </Text>
      </Pressable>
      <Pressable
        style={styles.button}
        onPress={() => {
          readTracks();
          setPicker(picker === 'audio' ? null : 'audio');
        }}
      >
        <Text style={styles.buttonText}>Lyd{audio !== null ? `: ${trackName(audio)}` : ''}</Text>
      </Pressable>
    </>
  );

  const pickers = (
    <>
      {picker === 'subtitles' && (
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
        video={<VideoView style={StyleSheet.absoluteFill} player={player} nativeControls />}
        bar={actions}
        overlays={pickers}
      />
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <VideoView style={styles.video} player={player} nativeControls />

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={1}>
          {playback.title}
        </Text>
        {playback.subtitle !== null && (
          <Text style={styles.subtitleLine} numberOfLines={1}>
            {playback.subtitle}
          </Text>
        )}
        {error !== null && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={[styles.actions, { paddingBottom: theme.spacing.md + insets.bottom }]}>{actions}</View>

      {pickers}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  info: { padding: theme.spacing.md, backgroundColor: theme.colors.background, flex: 1 },
  title: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  subtitleLine: { color: theme.colors.textMuted, fontSize: 14, marginTop: 4 },
  error: { color: theme.colors.danger, marginTop: theme.spacing.sm },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    backgroundColor: theme.colors.background,
  },
  button: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm + 2,
    paddingHorizontal: theme.spacing.md,
  },
  buttonText: { color: theme.colors.text, fontSize: 14, fontWeight: '600' },
});
