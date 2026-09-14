import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { buildEpisodeUrl, buildMovieUrl } from '@norstream/core';
import type { VodDetails } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { getVodItem, listEpisodes, setInWatchlist, setWatched } from '../../storage/vod.js';
import { continueEpisodeFor } from './episodes.js';
import type { StoredEpisode, StoredVodItem } from '../../storage/vod.js';
import { ensureVodDetails } from '../../sync/vodDetails.js';
import { followSeries, isFollowed, markSeriesSeen, unfollowSeries } from '../../storage/followedSeries.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';

/** Det afspilleren skal bruge. Adressen baerer panelets kodeord; den vises aldrig. */
export interface Playback {
  url: string;
  title: string;
  subtitle: string | null;
  /** Noeglen fremdriften gemmes under: titlen for film, afsnittet for serier. */
  progressKey: string;
  resumeAtSeconds: number | null;
  /** Kilden, saa afspilleren selv kan bygge adressen paa naeste afsnit. */
  sourceId: string;
  /** Serien og afsnittet, naar det er et afsnit; ellers null. */
  seriesKey: string | null;
  episodeKey: string | null;
}

interface Props {
  session: AppSession;
  itemKey: string;
  onBack: () => void;
  onPlay: (playback: Playback) => void;
  /**
   * Traileren vises inde i appen, paa sin egen skaerm. Id'et er panelets
   * bud og kan mangle; skaermen soeger selv videre naar det er en teaser
   * eller slet ikke er der.
   */
  onTrailer: (
    trailerId: string | null,
    title: string,
    year: number | null,
    kind: 'movie' | 'series',
  ) => void;
}

/**
 * Én film eller serie.
 *
 * Det panelet ved om titlen — handling, rolleliste, trailer, afsnit — hentes
 * foerst her, og kun én gang om ugen. Traileren spilles inde i appen med
 * YouTubes egen indlejrede afspiller; se `TrailerScreen`.
 */
export function VodDetailScreen({ session, itemKey, onBack, onPlay, onTrailer }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [item, setItem] = useState<StoredVodItem | null | undefined>(undefined);
  /** Serien foelges: forsiden viser nye afsnit naar panelet faar dem. */
  const [followed, setFollowed] = useState(false);
  const [details, setDetails] = useState<VodDetails | null>(null);
  const [episodes, setEpisodes] = useState<StoredEpisode[]>([]);
  const [season, setSeason] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Tv: den foerste knap (Se, Fortsaet) beder om fokus lidt efter at siden
   * er tegnet — én gang. Som fast prop virkede det ikke altid: knappen bad
   * om fokus foer den sad i vinduet, og fjernbetjeningen blev staaende paa
   * plakaten bagved, hvor OK intet synligt gjorde.
   */
  const [focusPulse, setFocusPulse] = useState(false);
  const pulsed = useRef(false);
  useEffect(() => {
    if (!isTV || pulsed.current || item === null || item === undefined) return;
    pulsed.current = true;
    const timer = setTimeout(() => setFocusPulse(true), 120);
    return () => clearTimeout(timer);
  }, [item]);
  useEffect(() => {
    if (!focusPulse) return;
    const frame = requestAnimationFrame(() => setFocusPulse(false));
    return () => cancelAnimationFrame(frame);
  }, [focusPulse]);

  const load = useCallback(async (): Promise<void> => {
    const stored = await getVodItem(session.db, itemKey);
    setItem(stored);
    if (stored === null) return;
    try {
      const creds = session.access(stored.sourceId)?.creds ?? null;
      const fetched = await ensureVodDetails(session.db, stored, creds, session.fetchImpl);
      setDetails(fetched);
      setError(null);
    } catch {
      setError('Panelet svarede ikke med detaljer om denne titel. Den kan stadig afspilles.');
    }
    if (stored.kind === 'series') {
      const list = await listEpisodes(session.db, stored.key);
      setEpisodes(list);
      setSeason((current) => current ?? list[0]?.season ?? null);
      // Listen er set: forsidens "nye afsnit" nulstilles for serien.
      const following = await isFollowed(session.db, stored.key);
      setFollowed(following);
      if (following) await markSeriesSeen(session.db, stored.key);
    }
  }, [session, itemKey]);

  useEffect(() => {
    void load();
  }, [load]);

  if (item === undefined) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (item === null) {
    return (
      <View style={styles.centered}>
        <Text style={styles.plot}>Titlen findes ikke længere.</Text>
        {!isTV && (
          <TvPressable style={styles.button} onPress={onBack}>
            <Text style={styles.buttonText}>Tilbage</Text>
          </TvPressable>
        )}
      </View>
    );
  }

  const creds = session.access(item.sourceId)?.creds ?? null;
  const rating = details?.rating ?? item.rating;
  const year = details?.year ?? item.year;
  const meta = [
    year !== null ? String(year) : null,
    details?.durationMinutes !== null && details?.durationMinutes !== undefined
      ? `${details.durationMinutes} min`
      : null,
    details?.genre ?? null,
  ].filter((part): part is string => part !== null);

  function playMovie(): void {
    if (creds === null || item === null || item === undefined) return;
    onPlay({
      url: buildMovieUrl(creds, item.id, item.containerExtension),
      title: item.name,
      subtitle: null,
      progressKey: item.key,
      resumeAtSeconds: item.positionSeconds,
      sourceId: item.sourceId,
      seriesKey: null,
      episodeKey: null,
    });
  }

  function playEpisode(episode: StoredEpisode): void {
    if (creds === null || item === null || item === undefined) return;
    onPlay({
      url: buildEpisodeUrl(creds, episode.id, episode.containerExtension),
      title: item.name,
      subtitle: `S${episode.season} · E${episode.episode} · ${episode.title}`,
      progressKey: episode.key,
      resumeAtSeconds: episode.positionSeconds,
      sourceId: item.sourceId,
      seriesKey: item.key,
      episodeKey: episode.key,
    });
  }

  async function toggleWatched(): Promise<void> {
    if (item === null || item === undefined) return;
    await setWatched(session.db, item.key, !item.watched);
    setItem({ ...item, watched: !item.watched });
  }

  async function toggleEpisodeWatched(episode: StoredEpisode): Promise<void> {
    await setWatched(session.db, episode.key, !episode.watched);
    setEpisodes((current) =>
      current.map((entry) => (entry.key === episode.key ? { ...entry, watched: !entry.watched } : entry)),
    );
  }

  async function toggleWatchlist(): Promise<void> {
    if (item === null || item === undefined) return;
    await setInWatchlist(session.db, item.key, !item.inWatchlist);
    setItem({ ...item, inWatchlist: !item.inWatchlist });
  }

  function openTrailer(): void {
    if (item === null || item === undefined) return;
    onTrailer(details?.trailerId ?? null, item.name, details?.year ?? item.year, item.kind);
  }

  const seasons = [...new Set(episodes.map((episode) => episode.season))];
  const shownEpisodes = episodes.filter((episode) => episode.season === season);
  // "Fortsaet" for serier: det afsnit man var i gang med, ellers det naeste
  // usete efter det sidste sete.
  const continueEpisode = continueEpisodeFor(episodes) ?? undefined;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + theme.spacing.xl }}>
        <View style={styles.hero}>
          {(details?.backdropUrl ?? item.posterUrl) !== null && (
            <Image
              source={{ uri: details?.backdropUrl ?? item.posterUrl ?? '' }}
              style={styles.backdrop}
              resizeMode="cover"
              blurRadius={details?.backdropUrl === null || details?.backdropUrl === undefined ? 12 : 0}
            />
          )}
          <View style={styles.heroScrim} />
          {!isTV && (
            <TvPressable style={styles.back} onPress={onBack} hitSlop={12}>
              <Text style={styles.backText}>‹ Tilbage</Text>
            </TvPressable>
          )}
          <View style={styles.heroBottom}>
            {item.posterUrl !== null && (
              <Image source={{ uri: item.posterUrl }} style={styles.poster} resizeMode="cover" />
            )}
            <View style={styles.heroText}>
              <Text style={styles.title}>{item.name}</Text>
              {meta.length > 0 && <Text style={styles.meta}>{meta.join(' · ')}</Text>}
              {rating !== null && (
                <Text style={styles.rating}>
                  ★ {rating.toFixed(1)} <Text style={styles.ratingOf}>/ 10</Text>
                </Text>
              )}
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          {item.kind === 'movie' ? (
            <TvPressable
              style={[styles.button, styles.buttonAccent]}
              disabled={creds === null}
              hasTVPreferredFocus={focusPulse}
              onPress={playMovie}
            >
              <Text style={styles.buttonText}>
                {item.positionSeconds !== null && !item.watched ? '▶ Fortsæt' : item.watched ? '▶ Se igen' : '▶ Se'}
              </Text>
            </TvPressable>
          ) : continueEpisode !== undefined ? (
            <TvPressable
              style={[styles.button, styles.buttonAccent]}
              hasTVPreferredFocus={focusPulse}
              onPress={() => playEpisode(continueEpisode)}
            >
              <Text style={styles.buttonText}>
                ▶ Fortsæt S{continueEpisode.season} E{continueEpisode.episode}
              </Text>
            </TvPressable>
          ) : shownEpisodes[0] !== undefined ? (
            <TvPressable
              style={[styles.button, styles.buttonAccent]}
              hasTVPreferredFocus={focusPulse}
              onPress={() => {
                const first = shownEpisodes[0];
                if (first !== undefined) playEpisode(first);
              }}
            >
              <Text style={styles.buttonText}>▶ Se første afsnit</Text>
            </TvPressable>
          ) : null}
          <TvPressable style={styles.button} onPress={openTrailer}>
            <Text style={styles.buttonText}>Trailer</Text>
          </TvPressable>
          {item.kind === 'movie' && (
            <TvPressable
              style={[styles.button, item.watched && styles.buttonDone]}
              onPress={() => {
                void toggleWatched();
              }}
            >
              <Text style={styles.buttonText}>{item.watched ? '✓ Set' : 'Markér som set'}</Text>
            </TvPressable>
          )}
          <TvPressable
            style={[styles.button, item.inWatchlist && styles.buttonDone]}
            onPress={() => {
              void toggleWatchlist();
            }}
          >
            <Text style={styles.buttonText}>{item.inWatchlist ? '✓ Min liste' : '+ Min liste'}</Text>
          </TvPressable>
          {item.kind === 'series' && (
            <TvPressable
              style={[styles.button, followed && styles.buttonDone]}
              onPress={() => {
                void (followed ? unfollowSeries(session.db, item.key) : followSeries(session.db, item.key)).then(() => setFollowed(!followed));
              }}
            >
              <Text style={styles.buttonText}>{followed ? '✓ Følger serien' : '🔔 Følg serien'}</Text>
            </TvPressable>
          )}
        </View>

        {creds === null && (
          <Text style={styles.warn}>Adgangsoplysningerne til kilden mangler på enheden.</Text>
        )}
        {error !== null && <Text style={styles.warn}>{error}</Text>}

        {details === null && error === null && (
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
        )}
        {details?.plot !== null && details?.plot !== undefined && (
          <Text style={styles.plot}>{details.plot}</Text>
        )}
        {details?.cast !== null && details?.cast !== undefined && (
          <Text style={styles.credit}>
            <Text style={styles.creditLabel}>Medvirkende: </Text>
            {details.cast}
          </Text>
        )}
        {details?.director !== null && details?.director !== undefined && (
          <Text style={styles.credit}>
            <Text style={styles.creditLabel}>Instruktør: </Text>
            {details.director}
          </Text>
        )}
        <Text style={styles.credit}>
          <Text style={styles.creditLabel}>Kategori: </Text>
          {item.categoryName ?? '—'}
        </Text>

        {item.kind === 'series' && (
          <View style={styles.episodes}>
            {seasons.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasons}>
                {seasons.map((number) => (
                  <TvPressable
                    key={number}
                    style={[styles.seasonChip, season === number && styles.seasonChipActive]}
                    onPress={() => setSeason(number)}
                  >
                    <Text style={[styles.seasonText, season === number && styles.seasonTextActive]}>
                      Sæson {number}
                    </Text>
                  </TvPressable>
                ))}
              </ScrollView>
            )}
            {episodes.length === 0 && details !== null && (
              <Text style={styles.empty}>Panelet oplyste ingen afsnit.</Text>
            )}
            {shownEpisodes.map((episode) => (
              <TvPressable
                key={episode.key}
                style={[styles.episode, episode.watched && styles.episodeWatched]}
                onPress={() => playEpisode(episode)}
                onLongPress={() => {
                  void toggleEpisodeWatched(episode);
                }}
                delayLongPress={400}
              >
                {/* Fluebenet kan ogsaa trykkes: set eller ikke set, uden at spille. */}
                <TvPressable
                  style={styles.episodeNumber}
                  hitSlop={8}
                  onPress={() => {
                    void toggleEpisodeWatched(episode);
                  }}
                >
                  <Text style={styles.episodeNumberText}>{episode.watched ? '✓' : episode.episode}</Text>
                </TvPressable>
                <View style={styles.episodeText}>
                  <Text style={styles.episodeTitle} numberOfLines={1}>
                    {episode.title}
                  </Text>
                  {episode.plot !== null && (
                    <Text style={styles.episodePlot} numberOfLines={2}>
                      {episode.plot}
                    </Text>
                  )}
                  <Text style={styles.episodeMeta}>
                    {[
                      episode.durationMinutes !== null ? `${episode.durationMinutes} min` : null,
                      episode.airDate,
                      episode.watched ? 'set' : episode.positionSeconds !== null ? 'påbegyndt' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Text style={styles.play}>▶</Text>
              </TvPressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: colors.background,
  },
  spinner: { marginTop: theme.spacing.lg },
  hero: { height: 300, backgroundColor: colors.surface },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.55 },
  heroScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 180,
    backgroundColor: 'rgba(16,16,20,0.75)',
  },
  back: { position: 'absolute', top: theme.spacing.sm, left: theme.spacing.md, padding: theme.spacing.xs },
  backText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  heroBottom: {
    position: 'absolute',
    left: theme.spacing.md,
    right: theme.spacing.md,
    bottom: theme.spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  poster: {
    width: 96,
    height: 144,
    borderRadius: theme.radius,
    marginRight: theme.spacing.md,
    backgroundColor: colors.surfaceRaised,
  },
  heroText: { flex: 1 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', lineHeight: 27 },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  rating: { color: '#ffd166', fontSize: 15, fontWeight: '700', marginTop: 6 },
  ratingOf: { color: colors.textMuted, fontWeight: '400', fontSize: 12 },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
  },
  button: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm + 2,
    paddingHorizontal: theme.spacing.md,
  },
  buttonAccent: { backgroundColor: colors.accent },
  buttonDone: { borderColor: colors.accent, borderWidth: 1 },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  warn: { color: colors.danger, paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
  plot: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  credit: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.xs,
  },
  creditLabel: { color: colors.text, fontWeight: '600' },
  episodes: { marginTop: theme.spacing.lg },
  seasons: { paddingHorizontal: theme.spacing.md, gap: theme.spacing.sm, marginBottom: theme.spacing.sm },
  seasonChip: {
    paddingVertical: 6,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  seasonChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  seasonText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  seasonTextActive: { color: colors.text },
  episode: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 2,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  episodeNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  episodeNumberText: { color: colors.text, fontWeight: '700' },
  episodeWatched: { opacity: 0.55 },
  episodeText: { flex: 1 },
  episodeTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  episodePlot: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  episodeMeta: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
  play: { color: colors.accent, fontSize: 18, marginLeft: theme.spacing.sm },
  empty: { color: colors.textMuted, textAlign: 'center', padding: theme.spacing.lg },
});
