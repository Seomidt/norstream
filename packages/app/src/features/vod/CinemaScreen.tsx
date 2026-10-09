import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import type { AppSession } from '../../session.js';
import { getTmdbApiKey } from '../../storage/settings.js';
import type { StoredVodItem } from '../../storage/vod.js';
import { tmdbFetch } from '../../sync/tmdb.js';
import { cinemaTitles } from '../../sync/tmdbHome.js';
import type { TmdbTitle } from '../../sync/tmdbHome.js';
import { cachedShelf } from '../../sync/shelfCache.js';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import { TitleCard, TITLE_WIDTH } from '../../ui/TitleCard.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { refocusLastPressed } from '../../ui/refocus.js';
import { findInPanel } from '../home/panelMatch.js';
import { premiereLabel } from './premiere.js';

interface Props {
  session: AppSession;
  /** Filmen findes i panelet: aabn dens side. */
  onOpen: (item: StoredVodItem) => void;
  /** Traileren, slaaet op paa titel og aar. */
  onTrailer: (title: TmdbTitle) => void;
  onOpenSettings: () => void;
}

interface Sheet {
  title: TmdbTitle;
  /** undefined mens der soeges i panelet. */
  inPanel: StoredVodItem | null | undefined;
}

/**
 * Biografen: det der spiller lige nu, og det der har premiere snart.
 *
 * Listerne kommer fra TMDB for Danmark og huskes som forsidens hylder.
 * OK paa en plakat: dansk titel, aar, karakter, et par linjer, traileren —
 * og "Se i din pakke" naar panelet har filmen. De nyeste er sjaeldent i
 * pakken endnu; det kommer hen ad vejen, og saa staar knappen der.
 */
export function CinemaScreen({ session, onOpen, onTrailer, onOpenSettings }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [tmdbKey, setTmdbKey] = useState<string | null | undefined>(undefined);
  const [nowPlaying, setNowPlaying] = useState<TmdbTitle[] | null>(null);
  const [upcoming, setUpcoming] = useState<TmdbTitle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  /**
   * Tv: den foerste plakat faar fokus naar listerne er der. Uden det gav
   * Android fokus til det foerste trykpunkt paa skaermen, og saa stod
   * fjernbetjeningen et sted man ikke kunne se — og intet kunne vaelges.
   */
  const [firstFocus, setFirstFocus] = useState(false);
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!isTV || focusedOnce.current) return;
    if ((nowPlaying === null || nowPlaying.length === 0) && (upcoming === null || upcoming.length === 0)) return;
    focusedOnce.current = true;
    setFirstFocus(true);
    const frame = requestAnimationFrame(() => setFirstFocus(false));
    return () => cancelAnimationFrame(frame);
  }, [nowPlaying, upcoming]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const key = await getTmdbApiKey(session.db);
      if (cancelled) return;
      setTmdbKey(key);
      if (key === null) return;
      try {
        const [now, soon] = await Promise.all([
          cachedShelf(session.db, 'cinema-now', () => cinemaTitles(tmdbFetch, key, 'now_playing')),
          cachedShelf(session.db, 'cinema-soon', () => cinemaTitles(tmdbFetch, key, 'upcoming')),
        ]);
        if (cancelled) return;
        setNowPlaying(now);
        setUpcoming(soon);
      } catch (cause) {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : 'ukendt fejl';
        if (/\b401\b/.test(message)) {
          // 401 = TMDB afviste noeglen. Samme noegle som plakaterne bruger,
          // saa den skal rettes i Indstillinger; her hjaelper intet forsoeg.
          setError('auth');
        } else {
          setError(`Biografens lister kunne ikke hentes: ${message}. Prøv igen om lidt.`);
        }
        setNowPlaying([]);
        setUpcoming([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.db]);

  // Tilbage lukker arket; og fokus tilbage paa plakaten bagefter.
  useEffect(() => {
    if (sheet === null) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setSheet(null);
      return true;
    });
    return () => subscription.remove();
  }, [sheet]);
  const sheetWasOpen = useRef(false);
  useEffect(() => {
    if (sheet !== null) {
      sheetWasOpen.current = true;
      return;
    }
    if (!sheetWasOpen.current || !isTV) return;
    sheetWasOpen.current = false;
    const timer = setTimeout(() => refocusLastPressed(), 80);
    return () => clearTimeout(timer);
  }, [sheet]);

  function open(title: TmdbTitle): void {
    setSheet({ title, inPanel: undefined });
    void findInPanel(session.db, title).then((found) => {
      setSheet((current) => (current !== null && current.title.id === title.id ? { ...current, inPanel: found } : current));
    });
  }

  if (tmdbKey === null || error === 'auth') {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>
          {tmdbKey === null ? 'Biografen kræver en TMDB-nøgle' : 'TMDB-nøglen blev afvist'}
        </Text>
        <Text style={styles.emptyText}>
          {tmdbKey === null
            ? 'Listerne over det der spiller i biografen kommer fra The Movie Database. Nøglen er gratis og skrives ind under Indstillinger; den giver også plakater til film og serier.'
            : 'The Movie Database svarede 401: nøglen er forkert eller udløbet. Åbn Indstillinger, slet feltet TMDB-nøgle, og skriv nøglen ind igen — den står på themoviedb.org under Indstillinger → API → "API Key (v3 auth)".'}
        </Text>
        <TvPressable style={styles.button} onPress={onOpenSettings} hasTVPreferredFocus={isTV}>
          <Text style={styles.buttonText}>Gå til Indstillinger</Text>
        </TvPressable>
      </View>
    );
  }

  const firstShelf = nowPlaying !== null && nowPlaying.length > 0 ? 'now' : 'soon';
  const shelf = (id: 'now' | 'soon', heading: string, titles: TmdbTitle[] | null, meta: (title: TmdbTitle) => string | undefined) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{heading}</Text>
      {titles === null ? (
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      ) : titles.length === 0 ? (
        <Text style={styles.emptyRow}>{error === null ? 'TMDB gav ingen film for Danmark lige nu.' : 'Kunne ikke hentes.'}</Text>
      ) : (
        <FlatList
          removeClippedSubviews={false}
          horizontal
          data={titles}
          keyExtractor={(title) => String(title.id)}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.shelf}
          renderItem={({ item, index }) => (
            <TitleCard title={item} onPress={() => open(item)} meta={meta(item)} preferFocus={firstFocus && id === firstShelf && index === 0} />
          )}
        />
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        removeClippedSubviews={false}
        data={['now', 'soon'] as const}
        keyExtractor={(row) => row}
        contentContainerStyle={styles.content}
        ListHeaderComponent={error !== null ? <Text style={styles.error}>{error}</Text> : null}
        renderItem={({ item }) =>
          item === 'now'
            ? shelf('now', 'I biografen nu', nowPlaying, () => undefined)
            : shelf('soon', 'Kommer snart', upcoming, (title) => {
                const label = premiereLabel(title.releaseDate);
                return label.length > 0 ? `Premiere ${label}` : undefined;
              })
        }
      />

      {sheet !== null && (
        <View style={styles.sheetBackdrop}>
          <TvPressable style={StyleSheet.absoluteFill} focusable={!isTV} onPress={() => setSheet(null)} />
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              {sheet.title.posterUrl !== null && (
                <Image source={{ uri: sheet.title.posterUrl }} style={styles.sheetPoster} resizeMode="cover" />
              )}
              <View style={styles.sheetText}>
                <Text style={styles.sheetTitle} numberOfLines={2}>
                  {sheet.title.title}
                </Text>
                <Text style={styles.sheetMeta}>
                  Film
                  {sheet.title.year !== null ? ` · ${sheet.title.year}` : ''}
                  {sheet.title.rating !== null ? ` · ★ ${sheet.title.rating.toFixed(1)}` : ''}
                  {premiereLabel(sheet.title.releaseDate).length > 0 ? ` · Premiere ${premiereLabel(sheet.title.releaseDate)}` : ''}
                </Text>
                {sheet.title.overview.length > 0 && (
                  <Text style={styles.sheetOverview} numberOfLines={4}>
                    {sheet.title.overview}
                  </Text>
                )}
              </View>
            </View>
            {sheet.inPanel === undefined ? (
              <Text style={styles.sheetHint}>Søger i din pakke …</Text>
            ) : sheet.inPanel === null ? (
              <Text style={styles.sheetHint}>Ikke i din pakke endnu. Biograffilm kommer typisk til panelet nogle uger efter premieren.</Text>
            ) : (
              <TvPressable
                style={styles.button}
                hasTVPreferredFocus={isTV}
                onPress={() => {
                  const item = sheet.inPanel;
                  setSheet(null);
                  if (item !== null && item !== undefined) onOpen(item);
                }}
              >
                <Text style={styles.buttonText}>Se i din pakke</Text>
              </TvPressable>
            )}
            <TvPressable
              style={[styles.button, styles.buttonSecondary]}
              hasTVPreferredFocus={isTV && sheet.inPanel === null}
              onPress={() => {
                const title = sheet.title;
                setSheet(null);
                onTrailer(title);
              }}
            >
              <Text style={styles.buttonText}>Se trailer</Text>
            </TvPressable>
            {!isTV && (
              <TvPressable style={styles.close} onPress={() => setSheet(null)} hitSlop={8}>
                <Text style={styles.closeText}>Luk</Text>
              </TvPressable>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: theme.spacing.xl },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg, gap: theme.spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '600', textAlign: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20, maxWidth: 480 },
  error: { color: colors.textMuted, fontSize: 13, paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm },
  section: { marginTop: theme.spacing.md },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '700', paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
  shelf: { paddingHorizontal: theme.spacing.md, gap: theme.spacing.sm },
  spinner: { height: TITLE_WIDTH * 1.5 },
  emptyRow: { color: colors.textMuted, fontSize: 13, paddingHorizontal: theme.spacing.md },
  sheetBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'flex-end',
    backgroundColor: '#00000099',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: theme.radius * 2,
    borderTopRightRadius: theme.radius * 2,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  sheetHead: { flexDirection: 'row', gap: theme.spacing.md },
  sheetPoster: { width: 72, height: 108, borderRadius: theme.radius },
  sheetText: { flex: 1 },
  sheetTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  sheetMeta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  sheetOverview: { color: colors.textMuted, fontSize: 13, lineHeight: 18, marginTop: theme.spacing.xs },
  sheetHint: { color: colors.textMuted, fontSize: 13 },
  button: {
    backgroundColor: colors.accent,
    borderRadius: theme.radius,
    padding: theme.spacing.sm + 2,
    alignItems: 'center',
  },
  buttonSecondary: { backgroundColor: colors.background },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  close: { alignItems: 'center', padding: theme.spacing.sm },
  closeText: { color: colors.textMuted, fontSize: 15 },
});
