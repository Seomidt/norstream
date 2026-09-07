import { useCallback, useEffect, useState } from 'react';
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

/**
 * Hvor langt man er naaet: forsiden, land -> kategori -> titler.
 *
 * Styret udefra af samme grund som kanalernes: skaermen afmonteres naar en
 * titel aabnes, og "tilbage" skal lande hvor turen begyndte.
 */
export type VodLevel =
  | { name: 'home' }
  | { name: 'countries'; kind: VodKind }
  | { name: 'categories'; kind: VodKind; country: CountryGroup }
  | { name: 'items'; kind: VodKind; country: CountryGroup; category: VodCategorySummary };

interface Props {
  session: AppSession;
  level: VodLevel;
  onLevelChange: (level: VodLevel) => void;
  onOpen: (item: StoredVodItem) => void;
}

const SEARCH_DEBOUNCE_MS = 250;
const SEARCH_LIMIT = 120;
/** Hvor mange titler en hylde paa forsiden viser. */
const SHELF_LIMIT = 20;
const COLUMNS = 3;

/**
 * Film og serier.
 *
 * Forsiden er hylder — det man er i gang med, det man har lagt til side, og
 * det nyeste — fordi det er dér man gaar hen naar man vil se *noget*. Landene
 * er vejen naar man vil se noget *bestemt*, og de er ordnet som kanalerne, saa
 * appen er den samme app paa begge faner.
 */
export function VodScreen({ session, level, onLevelChange, onOpen }: Props) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StoredVodItem[]>([]);
  const [loading, setLoading] = useState(false);

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
      placeholderTextColor={theme.colors.textMuted}
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
          <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />
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
        <Home session={session} onOpen={onOpen} onBrowse={(kind) => onLevelChange({ name: 'countries', kind })} />
      </View>
    );
  }

  if (level.name === 'countries') {
    return (
      <View style={styles.container}>
        {searchField}
        <Crumb label={kindLabel(level.kind)} onBack={() => onLevelChange({ name: 'home' })} />
        <Countries
          session={session}
          kind={level.kind}
          onPick={(country) => onLevelChange({ name: 'categories', kind: level.kind, country })}
        />
      </View>
    );
  }

  if (level.name === 'categories') {
    return (
      <View style={styles.container}>
        {searchField}
        <Crumb
          label={`${level.country.flag} ${level.country.name} · ${kindLabel(level.kind)}`}
          onBack={() => onLevelChange({ name: 'countries', kind: level.kind })}
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
        onBack={() => onLevelChange({ name: 'categories', kind: level.kind, country: level.country })}
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
  onOpen,
  onBrowse,
}: {
  session: AppSession;
  onOpen: (item: StoredVodItem) => void;
  onBrowse: (kind: VodKind) => void;
}) {
  const [counts, setCounts] = useState<{ movies: number; series: number } | null>(null);
  const [inProgress, setInProgress] = useState<StoredVodItem[]>([]);
  const [watchlist, setWatchlist] = useState<StoredVodItem[]>([]);
  const [newMovies, setNewMovies] = useState<StoredVodItem[]>([]);
  const [newSeries, setNewSeries] = useState<StoredVodItem[]>([]);

  const load = useCallback(async (): Promise<void> => {
    const [c, p, w, m, s] = await Promise.all([
      vodCounts(session.db),
      listVodItems(session.db, { inProgressOnly: true, limit: SHELF_LIMIT }),
      listVodItems(session.db, { watchlistOnly: true, limit: SHELF_LIMIT }),
      listVodItems(session.db, { kind: 'movie', newestFirst: true, limit: SHELF_LIMIT }),
      listVodItems(session.db, { kind: 'series', newestFirst: true, limit: SHELF_LIMIT }),
    ]);
    setCounts(c);
    setInProgress(p);
    setWatchlist(w);
    setNewMovies(m);
    setNewSeries(s);
  }, [session.db]);

  useEffect(() => {
    void load();
  }, [load]);

  if (counts === null) {
    return <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />;
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
    <ScrollView contentContainerStyle={styles.home}>
      <View style={styles.browseRow}>
        <Pressable style={styles.browseButton} onPress={() => onBrowse('movie')}>
          <Text style={styles.browseTitle}>Film</Text>
          <Text style={styles.browseCount}>{counts.movies} · efter land</Text>
        </Pressable>
        <Pressable style={styles.browseButton} onPress={() => onBrowse('series')}>
          <Text style={styles.browseTitle}>Serier</Text>
          <Text style={styles.browseCount}>{counts.series} · efter land</Text>
        </Pressable>
      </View>
      {inProgress.length > 0 && <Shelf title="Fortsæt" items={inProgress} onOpen={onOpen} />}
      {watchlist.length > 0 && <Shelf title="Min liste" items={watchlist} onOpen={onOpen} />}
      {newMovies.length > 0 && <Shelf title="Nyeste film" items={newMovies} onOpen={onOpen} />}
      {newSeries.length > 0 && <Shelf title="Nyeste serier" items={newSeries} onOpen={onOpen} />}
    </ScrollView>
  );
}

function Shelf({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: StoredVodItem[];
  onOpen: (item: StoredVodItem) => void;
}) {
  return (
    <View style={styles.shelf}>
      <Text style={styles.shelfTitle}>{title}</Text>
      <FlatList
        horizontal
        data={items}
        keyExtractor={(item) => item.key}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.shelfContent}
        renderItem={({ item }) => <Poster item={item} width={104} onOpen={onOpen} />}
      />
    </View>
  );
}

function Countries({
  session,
  kind,
  onPick,
}: {
  session: AppSession;
  kind: VodKind;
  onPick: (country: CountryGroup) => void;
}) {
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

  if (groups === null) return <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />;
  return (
    <FlatList
      data={groups}
      keyExtractor={(item) => item.key}
      ListEmptyComponent={<Text style={styles.empty}>Ingen {kindLabel(kind).toLowerCase()} fundet.</Text>}
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => onPick(item)}>
          <Text style={styles.flag}>{item.flag}</Text>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle}>{item.name}</Text>
            <Text style={styles.rowCount}>
              {item.categoryCount} kategorier · {item.channelCount} titler
            </Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
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
    return <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />;
  }
  return (
    <FlatList
      data={categories}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Pressable style={styles.row} onPress={() => onPick(item)}>
          <Text style={styles.flag}>{item.country?.flag ?? OTHER_COUNTRY_FLAG}</Text>
          <View style={styles.rowMain}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.rowCount}>{item.itemCount} titler</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
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

  if (items === null) return <ActivityIndicator color={theme.colors.accent} style={styles.spinner} />;
  return <PosterGrid items={items} onOpen={onOpen} emptyText="Ingen titler i denne kategori." />;
}

function PosterGrid({
  items,
  onOpen,
  emptyText,
}: {
  items: StoredVodItem[];
  onOpen: (item: StoredVodItem) => void;
  emptyText: string;
}) {
  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.key}
      numColumns={COLUMNS}
      contentContainerStyle={styles.grid}
      columnWrapperStyle={styles.gridRow}
      ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
      renderItem={({ item }) => <Poster item={item} onOpen={onOpen} />}
    />
  );
}

/**
 * Én plakat med titel og bedoemmelse.
 *
 * Plakaten er 2:3 som en biografplakat. Mangler den, staar titlen i feltet i
 * stedet for en tom firkant — samme regel som kanallogoerne.
 */
export function Poster({
  item,
  width,
  onOpen,
}: {
  item: StoredVodItem;
  width?: number;
  onOpen: (item: StoredVodItem) => void;
}) {
  const [failed, setFailed] = useState(false);
  const sizing = width === undefined ? styles.posterFlex : { width };
  const progress =
    item.positionSeconds !== null && item.durationSeconds !== null && item.durationSeconds > 0
      ? Math.min(1, item.positionSeconds / item.durationSeconds)
      : null;
  return (
    <Pressable style={[styles.poster, sizing]} onPress={() => onOpen(item)}>
      <View style={styles.posterFrame}>
        {item.posterUrl !== null && !failed ? (
          <Image
            source={{ uri: item.posterUrl }}
            style={styles.posterImage}
            resizeMode="cover"
            onError={() => setFailed(true)}
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
    </Pressable>
  );
}

function Crumb({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <Pressable style={styles.crumb} onPress={onBack} hitSlop={8}>
      <Text style={styles.crumbBack}>‹</Text>
      <Text style={styles.crumbLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.lg },
  spinner: { marginTop: theme.spacing.xl },
  search: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.colors.text,
    padding: theme.spacing.sm + 2,
    margin: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    fontSize: 15,
  },
  home: { paddingBottom: theme.spacing.xl },
  browseRow: { flexDirection: 'row', gap: theme.spacing.sm, paddingHorizontal: theme.spacing.md },
  browseButton: {
    flex: 1,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing.md,
  },
  browseTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  browseCount: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  shelf: { marginTop: theme.spacing.lg },
  shelfTitle: {
    color: theme.colors.text,
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
    backgroundColor: theme.colors.surface,
  },
  posterImage: { width: '100%', height: '100%' },
  posterFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: theme.spacing.sm },
  posterFallbackText: { color: theme.colors.textMuted, fontSize: 12, textAlign: 'center', fontWeight: '600' },
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
  kindText: { color: theme.colors.text, fontSize: 10, fontWeight: '700' },
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  progressFill: { backgroundColor: theme.colors.accent },
  posterTitle: { color: theme.colors.text, fontSize: 12, marginTop: 6, lineHeight: 16 },
  posterYear: { color: theme.colors.textMuted, fontSize: 11, marginTop: 1 },
  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  crumbBack: { color: theme.colors.accent, fontSize: 26, marginRight: theme.spacing.sm },
  crumbLabel: { color: theme.colors.text, fontSize: 15, fontWeight: '600', flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 4,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  flag: { fontSize: 22, marginRight: theme.spacing.md },
  rowMain: { flex: 1 },
  rowTitle: { color: theme.colors.text, fontSize: 16 },
  rowCount: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2 },
  chevron: { color: theme.colors.textMuted, fontSize: 22 },
  empty: { color: theme.colors.textMuted, textAlign: 'center', padding: theme.spacing.lg },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '600' },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    lineHeight: 21,
  },
});
