import { keepInMiddle, useTvListTail } from '../../ui/tvScroll.js';
import { posterImageUri } from './posterImage.js';
import { memo, useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { VodKind } from '@norstream/core';
import type { AppSession } from '../../session.js';
import { OTHER_COUNTRY_FLAG } from '../../storage/countries.js';
import type { CountryGroup } from '../../storage/countries.js';
import {
  listVodCategoriesInCountry,
  listVodCountryGroups,
  listVodItems,
  vodCounts,
} from '../../storage/vod.js';
import type { StoredVodItem, VodCategorySummary } from '../../storage/vod.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { CinemaScreen } from './CinemaScreen.js';
import { VodFilterScreen } from './VodFilterScreen.js';
import type { TmdbTitle } from '../../sync/tmdbHome.js';
import { cameBySelect } from '../../ui/tvKeys.js';
import { ensurePoster, foundPoster, subscribePoster } from '../../ui/posterFill.js';
import { serviceBadgeFor, setKnownServices } from '../../ui/serviceBadges.js';
import { getHomeProviders } from '../../storage/settings.js';
import { parentVodLevel } from './vodNavigation.js';
import { useVodShelfRefresh } from './useVodShelfRefresh.js';
import { clearVodContinueList, dismissContinueItem } from '../../storage/continueList.js';
import { ContinueMenu } from '../home/ContinueMenu.js';
import { refocusLastPressed } from '../../ui/refocus.js';

/**
 * Hvor langt man er naaet: forsiden, land -> kategori -> titler.
 *
 * Styret udefra af samme grund som kanalernes: skaermen afmonteres naar en
 * titel aabnes, og "tilbage" skal lande hvor turen begyndte.
 */
export type VodLevel =
  | { name: 'home' }
  | { name: 'cinema' }
  | { name: 'countries'; kind: VodKind }
  /** Udvalg paa tvaers af lande: genre, aar, land(e), sortering (v367). */
  | { name: 'filter'; kind: VodKind }
  | { name: 'categories'; kind: VodKind; country: CountryGroup }
  | { name: 'items'; kind: VodKind; country: CountryGroup; category: VodCategorySummary };

interface Props {
  session: AppSession;
  active: boolean;
  reloadToken?: number;
  backRef: { current: () => boolean };
  level: VodLevel;
  onLevelChange: (level: VodLevel) => void;
  onOpen: (item: StoredVodItem) => void;
  /** Biografen: traileren til en film der (endnu) ikke er i panelet. */
  onTrailer: (title: TmdbTitle) => void;
  onOpenSettings: () => void;
}

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 120;
/** Hvor mange titler en hylde paa forsiden viser. */
const SHELF_LIMIT = 20;
/**
 * Plakater per raekke i gitteret. Tre paa en telefon; paa tv er laerredet
 * 780 punkter bredt, og tre plakater var 250 punkter hver, "alt for
 * store". Seks giver 120 punkter, som de andre tv-apps.
 */
const COLUMNS = isTV ? 6 : 3;

/**
 * Film og serier.
 *
 * Forsiden er hylder — det man er i gang med, det man har lagt til side, og
 * det nyeste — fordi det er dér man gaar hen naar man vil se *noget*. Landene
 * er vejen naar man vil se noget *bestemt*, og de er ordnet som kanalerne, saa
 * appen er den samme app paa begge faner.
 */
export function VodScreen({ session, active, reloadToken = 0, backRef, level, onLevelChange, onOpen, onTrailer, onOpenSettings }: Props) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StoredVodItem[]>([]);
  const [loading, setLoading] = useState(false);
  // En soegning tegnes foer katalog-niveauet. Tilbage skal rydde den,
  // ellers aendres niveauet bag en resultatside som stadig bliver staaende.
  backRef.current = (): boolean => {
    if (!active || (search.length === 0 && query.length === 0)) return false;
    setSearch('');
    setQuery('');
    return true;
  };
  const back = (): void => {
    const parent = parentVodLevel(level);
    if (parent !== null) onLevelChange(parent);
  };

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (query.length === 0) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      const items = await listVodItems(session.db, { search: query, limit: SEARCH_LIMIT });
      if (!cancelled) {
        setResults(items);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session.db, query]);

  const searchField = (
    <TextInput
      style={styles.search}
      placeholder="Søg blandt film og serier"
      placeholderTextColor={colors.textMuted}
      value={search}
      onChangeText={setSearch}
      autoCorrect={false}
      autoCapitalize="none"
    />
  );

  if (query.length > 0) {
    return (
      <View style={styles.container}>
        {searchField}
        {loading ? (
          <ActivityIndicator color={colors.accent} style={styles.spinner} />
        ) : (
          <PosterGrid items={results} onOpen={onOpen} emptyText="Intet matcher søgningen." />
        )}
      </View>
    );
  }

  if (level.name === 'home') {
    return (
      <View style={styles.container}>
        {searchField}
        <Home
          session={session}
          active={active}
          reloadToken={reloadToken}
          onOpen={onOpen}
          onBrowse={(kind) => onLevelChange({ name: 'countries', kind })}
          onCinema={() => onLevelChange({ name: 'cinema' })}
        />
      </View>
    );
  }

  if (level.name === 'cinema') {
    return (
      <View style={styles.container}>
        {/* Soegefeltet soeger i panelet, ikke i biografen; paa tv tog det
            fokus (og tastaturet kom frem) naar siden aabnede. */}
        {!isTV && searchField}
        <Crumb label="Biograf" onBack={back} />
        <CinemaScreen session={session} onOpen={onOpen} onTrailer={onTrailer} onOpenSettings={onOpenSettings} />
      </View>
    );
  }

  if (level.name === 'countries') {
    return (
      <View style={styles.container}>
        {searchField}
        <Crumb label={kindLabel(level.kind)} onBack={back} />
        <Countries
          session={session}
          kind={level.kind}
          onPick={(country) => onLevelChange({ name: 'categories', kind: level.kind, country })}
          onFilter={() => onLevelChange({ name: 'filter', kind: level.kind })}
        />
      </View>
    );
  }

  if (level.name === 'filter') {
    return (
      <View style={styles.container}>
        {!isTV && searchField}
        <Crumb label={`${kindLabel(level.kind)} · udvalg`} onBack={back} />
        <VodFilterScreen key={level.kind} session={session} active={active} kind={level.kind} onOpen={onOpen} />
      </View>
    );
  }

  if (level.name === 'categories') {
    return (
      <View style={styles.container}>
        {searchField}
        <Crumb
          label={`${level.country.flag} ${level.country.name} · ${kindLabel(level.kind)}`}
          onBack={back}
        />
        <Categories
          session={session}
          kind={level.kind}
          countryKey={level.country.key}
          onPick={(category) =>
            onLevelChange({ name: 'items', kind: level.kind, country: level.country, category })
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {searchField}
      <Crumb
        label={`${level.country.flag} ${level.category.name}`}
        onBack={back}
      />
      <Items session={session} categoryId={level.category.id} onOpen={onOpen} />
    </View>
  );
}

function kindLabel(kind: VodKind): string {
  return kind === 'movie' ? 'Film' : 'Serier';
}

function Home({
  session,
  active,
  reloadToken,
  onOpen,
  onBrowse,
  onCinema,
}: {
  session: AppSession;
  active: boolean;
  reloadToken: number;
  onOpen: (item: StoredVodItem) => void;
  onBrowse: (kind: VodKind) => void;
  onCinema: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [counts, setCounts] = useState<{ movies: number; series: number } | null>(null);
  const [inProgress, setInProgress] = useState<StoredVodItem[]>([]);
  const [watchlist, setWatchlist] = useState<StoredVodItem[]>([]);
  const [newMovies, setNewMovies] = useState<StoredVodItem[]>([]);
  const [newSeries, setNewSeries] = useState<StoredVodItem[]>([]);
  const [continueTarget, setContinueTarget] = useState<StoredVodItem | null>(null);
  const [continueBusy, setContinueBusy] = useState(false);
  const [continueError, setContinueError] = useState<string | null>(null);
  const continueOpen = useRef(false);
  const continueSaving = useRef(false);
  const continueRevision = useRef(0);
  const menuWasOpen = useRef(false);
  useEffect(() => {
    if (continueTarget !== null) { menuWasOpen.current = true; return; }
    if (!menuWasOpen.current || !isTV) return;
    menuWasOpen.current = false;
    const timer = setTimeout(() => refocusLastPressed(), 80);
    return () => clearTimeout(timer);
  }, [continueTarget]);

  const closeContinue = (): void => {
    if (continueSaving.current) return;
    continueOpen.current = false;
    setContinueTarget(null);
  };
  const removeContinue = async (all: boolean): Promise<void> => {
    if (continueTarget === null || continueSaving.current) return;
    continueSaving.current = true;
    continueRevision.current += 1;
    setContinueBusy(true);
    setContinueError(null);
    try {
      if (all) await clearVodContinueList(session.db);
      else await dismissContinueItem(session.db, `vod:${continueTarget.key}`);
      continueRevision.current += 1;
      setInProgress(items => all ? [] : items.filter(item => item.key !== continueTarget.key));
      continueOpen.current = false;
      setContinueTarget(null);
    } catch {
      setContinueError('Listen kunne ikke ryddes. Prøv igen.');
    } finally {
      continueSaving.current = false;
      setContinueBusy(false);
    }
  };

  const load = useCallback(async (): Promise<void> => {
    const revision = ++continueRevision.current;
    // Tjenesterne til plakatmaerkerne (v369), samme valg som forsiden.
    void getHomeProviders(session.db).then(setKnownServices).catch(() => undefined);
    // Tegn hver hylde saa snart dens eget opslag er klart.
    await Promise.allSettled([
      vodCounts(session.db).then(setCounts),
      listVodItems(session.db, { inProgressOnly: true, homeContinueOnly: true, limit: SHELF_LIMIT })
        .then(items => { if (revision === continueRevision.current) setInProgress(items); }),
      listVodItems(session.db, { watchlistOnly: true, limit: SHELF_LIMIT }).then(setWatchlist),
      listVodItems(session.db, { kind: 'movie', newestFirst: true, limit: SHELF_LIMIT }).then(setNewMovies),
      listVodItems(session.db, { kind: 'series', newestFirst: true, limit: SHELF_LIMIT }).then(setNewSeries),
    ]);
  }, [session.db]);

  useVodShelfRefresh(load, active, reloadToken);

  if (counts === null) {
    return <ActivityIndicator color={colors.accent} style={styles.spinner} />;
  }

  if (counts.movies === 0 && counts.series === 0) {
    return (
      <View style={styles.centered}>
        <Text style={styles.emptyTitle}>Ingen film eller serier endnu</Text>
        <Text style={styles.emptyText}>
          De hentes sammen med kanalerne. Træk ned under Kanaler for at opdatere — har
          panelet ingen film, står der ingenting her.
        </Text>
      </View>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.home}>
        <View style={styles.browseRow}>
          <TvPressable style={styles.browseButton} onPress={() => onBrowse('movie')}>
            <Text style={styles.browseTitle}>Film</Text>
            <Text style={styles.browseCount}>{counts.movies} · efter land</Text>
          </TvPressable>
          <TvPressable style={styles.browseButton} onPress={() => onBrowse('series')}>
            <Text style={styles.browseTitle}>Serier</Text>
            <Text style={styles.browseCount}>{counts.series} · efter land</Text>
          </TvPressable>
          <TvPressable style={styles.browseButton} onPress={onCinema}>
            <Text style={styles.browseTitle}>Biograf</Text>
            <Text style={styles.browseCount}>i biografen nu · kommer snart</Text>
          </TvPressable>
        </View>
        {inProgress.length > 0 && <Shelf title="Fortsæt" items={inProgress}
          onOpen={item => { if (!continueOpen.current) onOpen(item); }}
          onLongPress={item => {
            continueOpen.current = true;
            setContinueError(null);
            setContinueTarget(item);
          }} />}
        {watchlist.length > 0 && <Shelf title="Min liste" items={watchlist} onOpen={onOpen} />}
        {newMovies.length > 0 && <Shelf title="Nyeste film" items={newMovies} onOpen={onOpen} />}
        {newSeries.length > 0 && <Shelf title="Nyeste serier" items={newSeries} onOpen={onOpen} />}
      </ScrollView>
      {continueTarget !== null && <ContinueMenu listName="Fortsæt" title={continueTarget.name} busy={continueBusy} error={continueError}
        onRemove={() => { void removeContinue(false); }} onClear={() => { void removeContinue(true); }} onClose={closeContinue} />}
    </>
  );
}

function Shelf({
  title,
  items,
  onOpen,
  onLongPress,
}: {
  title: string;
  items: StoredVodItem[];
  onOpen: (item: StoredVodItem) => void;
  onLongPress?: (item: StoredVodItem) => void;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.shelf}>
      <Text style={styles.shelfTitle}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.shelfContent}
        renderItem={({ item }) => <Poster item={item} width={104} onOpen={onOpen}
          onLongPress={onLongPress === undefined ? undefined : () => onLongPress(item)} />}
      />
    </View>
  );
}

function Countries({
  session,
  kind,
  onPick,
  onFilter,
}: {
  session: AppSession;
  kind: VodKind;
  onPick: (country: CountryGroup) => void;
  onFilter: () => void;
}) {
  // Én gang naar listen kommer frem, ikke ved hver tegning: ellers sprang fokus til toppen efter ethvert OK-tryk.
  const focusFirstAtMount = useRef(isTV && cameBySelect()).current;
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const listRef = useRef<FlatList<CountryGroup>>(null);
  const tail = useTvListTail();
  const [groups, setGroups] = useState<CountryGroup[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listVodCountryGroups(session.db, kind).then((result) => {
      if (!cancelled) setGroups(result);
    });
    return () => {
      cancelled = true;
    };
  }, [session.db, kind]);

  if (groups === null) return <ActivityIndicator color={colors.accent} style={styles.spinner} />;
  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      contentContainerStyle={tail}
      onScrollToIndexFailed={({ index, averageItemLength }) => listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false })}
      data={groups}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={<Text style={styles.empty}>Ingen {kindLabel(kind).toLowerCase()} fundet.</Text>}
      ListHeaderComponent={
        groups.length > 0 ? (
          <TvPressable style={[styles.row, styles.filterRow]} hasTVPreferredFocus={focusFirstAtMount} onPress={onFilter}>
            <Text style={styles.flag}>⚲</Text>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle}>Udvalg: genre, år og land</Text>
              <Text style={styles.rowCount}>fx thriller · 2026 · DK + UK + US</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TvPressable>
        ) : null
      }
      renderItem={({ item, index }) => (
        <TvPressable style={styles.row} onFocus={() => keepInMiddle(listRef.current, index)} onPress={() => onPick(item)}>
          <Text style={styles.flag}>{item.flag}</Text>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>{item.key === 'GB' ? `UK · ${item.name}` : item.name}</Text>
            <Text style={styles.rowCount}>
              {item.categoryCount} kategorier · {item.channelCount} titler
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TvPressable>
      )}
    />
  );
}

function Categories({
  session,
  kind,
  countryKey,
  onPick,
}: {
  session: AppSession;
  kind: VodKind;
  countryKey: string;
  onPick: (category: VodCategorySummary) => void;
}) {
  // Én gang naar listen kommer frem, ikke ved hver tegning: ellers sprang fokus til toppen efter ethvert OK-tryk.
  const focusFirstAtMount = useRef(isTV && cameBySelect()).current;
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const listRef = useRef<FlatList<VodCategorySummary>>(null);
  const tail = useTvListTail();
  const [categories, setCategories] = useState<VodCategorySummary[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listVodCategoriesInCountry(session.db, kind, countryKey).then((result) => {
      if (!cancelled) setCategories(result);
    });
    return () => {
      cancelled = true;
    };
  }, [session.db, kind, countryKey]);

  if (categories === null) {
    return <ActivityIndicator color={colors.accent} style={styles.spinner} />;
  }
  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      contentContainerStyle={tail}
      onScrollToIndexFailed={({ index, averageItemLength }) => listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false })}
      data={categories}
      keyExtractor={(item) => item.id}
      renderItem={({ item, index }) => (
        <TvPressable style={styles.row} onFocus={() => keepInMiddle(listRef.current, index)} hasTVPreferredFocus={index === 0 && focusFirstAtMount} onPress={() => onPick(item)}>
          <Text style={styles.flag}>{item.country?.flag ?? OTHER_COUNTRY_FLAG}</Text>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.rowCount}>{item.itemCount} titler</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </TvPressable>
      )}
    />
  );
}

function Items({
  session,
  categoryId,
  onOpen,
}: {
  session: AppSession;
  categoryId: string;
  onOpen: (item: StoredVodItem) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [items, setItems] = useState<StoredVodItem[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void listVodItems(session.db, { categoryId }).then((result) => {
      if (!cancelled) setItems(result);
    });
    return () => {
      cancelled = true;
    };
  }, [session.db, categoryId]);

  if (items === null) return <ActivityIndicator color={colors.accent} style={styles.spinner} />;
  return <PosterGrid items={items} onOpen={onOpen} emptyText="Ingen titler i denne kategori." />;
}

export function PosterGrid({
  items,
  onOpen,
  emptyText,
  header,
  footer,
}: {
  items: StoredVodItem[];
  onOpen: (item: StoredVodItem) => void;
  emptyText: string;
  /** Over gitteret, ruller med (udvalgets knapper, v367). */
  header?: React.ReactElement | null;
  footer?: React.ReactElement | null;
}) {
  // Én gang naar listen kommer frem, ikke ved hver tegning: ellers sprang fokus til toppen efter ethvert OK-tryk.
  const focusFirstAtMount = useRef(isTV && cameBySelect()).current;
  const styles = useStyles(makeStyles);
  const listRef = useRef<FlatList<StoredVodItem>>(null);
  const tail = useTvListTail();
  return (
    <FlatList
      ref={listRef}
      style={styles.list}
      onScrollToIndexFailed={({ index, averageItemLength }) => listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false })}
      data={items}
      keyExtractor={(item) => item.key}
      numColumns={COLUMNS}
      windowSize={5}
      initialNumToRender={COLUMNS * 3}
      maxToRenderPerBatch={COLUMNS}
      updateCellsBatchingPeriod={16}
      removeClippedSubviews={!isTV}
      contentContainerStyle={[styles.grid, tail]}
      columnWrapperStyle={styles.gridRow}
      ListHeaderComponent={header ?? null}
      ListFooterComponent={footer ?? null}
      ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
      renderItem={({ item, index }) => <Poster item={item} onOpen={onOpen} onFocus={() => keepInMiddle(listRef.current, Math.floor(index / COLUMNS))} preferFocus={index === 0 && focusFirstAtMount && header === undefined} />}
    />
  );
}

/**
 * Én plakat med titel og bedoemmelse.
 *
 * Plakaten er 2:3 som en biografplakat. Mangler den, staar titlen i feltet i
 * stedet for en tom firkant — samme regel som kanallogoerne.
 */
export const Poster = memo(function Poster({
  item,
  width,
  onOpen,
  preferFocus = false,
  onLongPress,
  onFocus,
}: {
  item: StoredVodItem;
  width?: number;
  onOpen: (item: StoredVodItem) => void;
  /** Paa tv: faar fokus naar gitteret kommer frem, saa fjernbetjeningen ikke lander i menuen. */
  preferFocus?: boolean;
  onLongPress?: () => void;
  onFocus?: () => void;
}) {
  const styles = useStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const sizing = width === undefined ? styles.posterFlex : { width };
  // Uden plakat: bed om en fra TMDB, og tegn den naar den kommer.
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    // Manglende karakter maa ikke forsinke plakaterne til de tomme kort.
    if (item.posterUrl !== null && !failed) return;
    if (failed && item.foundPosterUrl != null && item.foundPosterUrl !== item.posterUrl) return;
    const unsubscribe = subscribePoster(item.key, redraw);
    ensurePoster(item, failed ? item.posterUrl : null);
    return unsubscribe;
  }, [item, failed]);
  const posterUrl = item.posterUrl !== null && !failed ? item.posterUrl : item.foundPosterUrl ?? foundPoster(item.key);
  // "Netflix" i hjoernet naar TMDB siger titlen ligger dér (v369).
  const serviceBadge = serviceBadgeFor(item.providers);
  const progress =
    item.positionSeconds !== null && item.durationSeconds !== null && item.durationSeconds > 0
      ? Math.min(1, item.positionSeconds / item.durationSeconds)
      : null;
  return (
    <TvPressable style={[styles.poster, sizing]} hasTVPreferredFocus={preferFocus} onPress={() => onOpen(item)} onLongPress={onLongPress} onFocus={onFocus}>
      <View style={styles.posterFrame}>
        {posterUrl !== null ? (
          <Image
            source={{ uri: posterImageUri(posterUrl) }}
            style={styles.posterImage}
            resizeMode="cover"
            onError={() => {
              if (posterUrl === item.posterUrl) setFailed(true);
            }}
          />
        ) : (
          <View style={styles.posterFallback}>
            <Text style={styles.posterFallbackText} numberOfLines={4}>
              {item.name}
            </Text>
          </View>
        )}
        {item.rating !== null && (
          <View style={styles.ratingBadge}>
            <Text style={styles.ratingText}>★ {item.rating.toFixed(1)}</Text>
          </View>
        )}
        {item.kind === 'series' && (
          <View style={styles.kindBadge}>
            <Text style={styles.kindText}>Serie</Text>
          </View>
        )}
        {serviceBadge !== null && (
          <View style={styles.serviceBadge}>
            <Text style={styles.serviceText}>{serviceBadge}</Text>
          </View>
        )}
        {progress !== null && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { flex: progress }]} />
            <View style={{ flex: 1 - progress }} />
          </View>
        )}
      </View>
      <Text style={styles.posterTitle} numberOfLines={2}>
        {item.name}
      </Text>
      {item.year !== null && <Text style={styles.posterYear}>{item.year}</Text>}
    </TvPressable>
  );
});

function Crumb({ label, onBack }: { label: string; onBack: () => void }) {
  const styles = useStyles(makeStyles);
  return (
    <TvPressable style={styles.crumb} focusable={!isTV} onPress={onBack} hitSlop={8}>
      <Text style={styles.crumbBack}>‹</Text>
      <Text style={styles.crumbLabel} numberOfLines={1}>
        {label}
      </Text>
    </TvPressable>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  list: { flex: 1, minHeight: 0 },
  container: { flex: 1, minHeight: 0, backgroundColor: colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  spinner: { marginTop: theme.spacing.xl },
  search: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: colors.text,
    padding: theme.spacing.sm + 2,
    margin: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    fontSize: 15,
  },
  home: { paddingBottom: theme.spacing.xl },
  browseRow: { flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md },
  browseButton: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: colors.border,
    padding: theme.spacing.md,
  },
  browseTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  browseCount: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  shelf: { marginTop: theme.spacing.lg },
  shelfTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  shelfContent: { paddingHorizontal: theme.spacing.md, gap: theme.spacing.sm },
  grid: { padding: theme.spacing.sm, paddingBottom: theme.spacing.xl },
  gridRow: { gap: theme.spacing.sm, paddingHorizontal: theme.spacing.sm, marginBottom: theme.spacing.md },
  poster: {},
  posterFlex: { flex: 1 / COLUMNS },
  posterFrame: {
    aspectRatio: 2 / 3,
    borderRadius: theme.radius,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  posterImage: { width: '100%', height: '100%' },
  posterFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.sm },
  posterFallbackText: { color: colors.textMuted, fontSize: 12, textAlign: 'center', fontWeight: '600' },
  ratingBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ratingText: { color: '#ffd166', fontSize: 11, fontWeight: '700' },
  kindBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(76,141,255,0.9)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kindText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  serviceBadge: {
    position: 'absolute',
    bottom: 8,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  serviceText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  progressFill: { backgroundColor: colors.accent },
  posterTitle: { color: colors.text, fontSize: 12, marginTop: 6, lineHeight: 16 },
  posterYear: { color: colors.textMuted, fontSize: 11, marginTop: 1 },
  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  crumbBack: { color: colors.accent, fontSize: 26, marginRight: theme.spacing.sm },
  crumbLabel: { color: colors.text, fontSize: 15, fontWeight: '600', flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 4,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flag: { fontSize: 22, marginRight: theme.spacing.md },
  filterRow: { backgroundColor: colors.surface },
  rowMain: { flex: 1 },
  rowTitle: { color: colors.text, fontSize: 16 },
  rowCount: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.textMuted, fontSize: 22 },
  empty: { color: colors.textMuted, textAlign: 'center', padding: theme.spacing.lg },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  emptyText: {
    color: colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    lineHeight: 21,
  },
});
