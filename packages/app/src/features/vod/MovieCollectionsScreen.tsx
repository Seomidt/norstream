import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import type { AppSession } from '../../session.js';
import type { StoredVodItem } from '../../storage/vod.js';
import { getTmdbApiKey } from '../../storage/settings.js';
import { listMovieCollectionItems, listMovieCollections } from '../../storage/movieCollections.js';
import type { MovieCollectionSummary } from '../../storage/movieCollections.js';
import { discoverMovieCollections } from '../../sync/movieCollections.js';
import { tmdbFetch } from '../../sync/tmdb.js';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { useVodListFocus } from './useVodListFocus.js';
import { posterImageUri } from './posterImage.js';

interface Props {
  session: AppSession;
  collectionId: number | null;
  onCollection: (id: number) => void;
  onOpen: (item: StoredVodItem) => void;
  active?: boolean;
  reloadToken?: number;
}
type Card = { key: string; name: string; poster: string | null; meta: string }
  & ({ collection: MovieCollectionSummary; movie?: never } | { movie: StoredVodItem; collection?: never });
const COLUMNS = isTV ? 6 : 3;

/** Lokal oversigt foerst; nye samlinger fyldes gradvist uden medieforbindelser. */
export function MovieCollectionsScreen({ session, collectionId, onCollection, onOpen, active = true, reloadToken = 0 }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const scroll = useVodListFocus<Card>();
  const [cards, setCards] = useState<Card[]>([]);
  const [heading, setHeading] = useState('Filmsamlinger');
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [missingKey, setMissingKey] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [remaining, setRemaining] = useState(false);
  const [loadedPage, setLoadedPage] = useState<string | null>(null);
  const [firstFocus, setFirstFocus] = useState<string | null>(null);
  const focusedPage = useRef<string | null>(null);
  useEffect(() => {
    const page = String(collectionId ?? 'list');
    if (!isTV || !active || loadedPage !== page || cards.length === 0 || focusedPage.current === page) return;
    focusedPage.current = page;
    setFirstFocus(page);
    const frame = requestAnimationFrame(() => setFirstFocus(null));
    return () => cancelAnimationFrame(frame);
  }, [active, collectionId, loadedPage, cards.length]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const load = async (): Promise<void> => {
      const all = await listMovieCollections(session.db);
      const items = collectionId === null ? [] : await listMovieCollectionItems(session.db, collectionId);
      if (cancelled) return;
      setHeading(collectionId === null ? 'Filmsamlinger' : all.find(row => row.id === collectionId)?.name ?? 'Filmsamling');
      setCards(collectionId === null ? all.map(collection => ({
        key: `collection:${collection.id}`, name: collection.name, poster: collection.posterUrl,
        meta: `${collection.available} film i pakken`, collection,
      })) : items.map(movie => ({
        key: movie.key, name: movie.name, poster: movie.posterUrl ?? movie.foundPosterUrl,
        meta: movie.year === null ? '' : String(movie.year), movie,
      })));
      setLoadedPage(String(collectionId ?? 'list'));
      setLoading(false);
    };
    setLoading(true); setFailed(false); setMissingKey(false); setRemaining(false);
    void (async () => {
      try {
        await load();
        // En aabnet samling viser allerede alle dens kendte dele. Navigation
        // mellem samlinger maa ikke starte nye katalog-batches.
        if (collectionId !== null) return;
        const key = await getTmdbApiKey(session.db);
        if (cancelled) return;
        if (key === null || key.trim().length === 0) { setMissingKey(true); return; }
        setUpdating(true);
        // Hoejst 24 katalogtitler per besoeg. En afgang stopper naeste kald.
        for (let batch = 0; batch < 3 && !cancelled; batch += 1) {
          const result = await discoverMovieCollections(session.db, tmdbFetch, key, { limit: 8, isCancelled: () => cancelled });
          if (cancelled) return;
          if (result.changed > 0) await load();
          setRemaining(result.remaining);
          if (result.failed) { setFailed(true); break; }
          if (!result.remaining || result.looked === 0) break;
        }
      } catch {
        if (!cancelled) { setFailed(true); setLoading(false); }
      } finally {
        if (!cancelled) setUpdating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [session.db, collectionId, active, reloadToken, retry]);

  return <View style={styles.container}>
    <Text style={styles.heading}>{heading}</Text>
    <Text style={styles.hint}>{collectionId === null ? 'Samlinger med film fra din pakke.' : 'Dine film i udgivelsesrækkefølge.'}</Text>
    {loading && <ActivityIndicator color={colors.accent} />}
    {updating && <Text style={styles.hint}>Finder flere samlinger …</Text>}
    {failed && <TvPressable style={styles.retry} hasTVPreferredFocus={isTV && cards.length === 0} onPress={() => setRetry(value => value + 1)}>
      <Text style={styles.name}>Kunne ikke opdatere samlinger. Prøv igen</Text>
    </TvPressable>}
    {remaining && !updating && !failed && !missingKey && <TvPressable style={styles.retry}
      hasTVPreferredFocus={isTV && cards.length === 0} onPress={() => setRetry(value => value + 1)}>
      <Text style={styles.name}>Find flere samlinger</Text>
    </TvPressable>}
    {!loading && cards.length === 0 && <Text style={styles.empty}>
      {missingKey ? 'Tilføj din TMDB-nøgle under Indstillinger for at finde filmsamlinger.'
        : collectionId === null ? updating ? 'Samlingerne vises her, efterhånden som de findes.' : 'Ingen filmsamlinger fundet i din pakke endnu.'
          : 'Ingen film fra denne samling er fundet i din pakke lige nu.'}
    </Text>}
    <FlatList
      ref={scroll.list} data={cards} numColumns={COLUMNS} keyExtractor={card => card.key}
      contentContainerStyle={scroll.tail} removeClippedSubviews={false} onScrollToIndexFailed={scroll.failed}
      initialNumToRender={12} windowSize={5}
      renderItem={({ item, index }) => <CollectionCard card={item} preferFocus={firstFocus === String(collectionId ?? 'list') && loadedPage === firstFocus && index === 0} onFocus={() => scroll.focus(Math.floor(index / COLUMNS))}
        onPress={() => item.collection !== undefined ? onCollection(item.collection.id) : onOpen(item.movie)} />}
    />
  </View>;
}

function CollectionCard({ card, onFocus, onPress, preferFocus }: { card: Card; onFocus: () => void; onPress: () => void; preferFocus: boolean }) {
  const styles = useStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [card.poster]);
  return <View style={styles.cell}>
    <TvPressable style={styles.card} onFocus={onFocus} onPress={onPress} hasTVPreferredFocus={preferFocus} accessibilityLabel={`${card.name}, ${card.meta}`}>
      <View style={styles.frame}>
        {card.poster !== null && !failed
          ? <Image source={{ uri: posterImageUri(card.poster) }} style={styles.image} resizeMode="cover" onError={() => setFailed(true)} />
          : <Text style={styles.fallback} numberOfLines={5}>{card.name}</Text>}
      </View>
      <Text style={styles.name} numberOfLines={2}>{card.name}</Text>
      <Text style={styles.meta} numberOfLines={1}>{card.meta}</Text>
    </TvPressable>
  </View>;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  heading: { color: colors.text, fontSize: 19, fontWeight: '700', paddingHorizontal: theme.spacing.md, paddingTop: theme.spacing.sm },
  hint: { color: colors.textMuted, fontSize: 12, paddingHorizontal: theme.spacing.md, marginVertical: theme.spacing.xs },
  empty: { color: colors.textMuted, fontSize: 14, padding: theme.spacing.md },
  retry: { backgroundColor: colors.surface, margin: theme.spacing.sm, padding: theme.spacing.sm, borderRadius: theme.radius },
  cell: { width: `${100 / COLUMNS}%`, padding: theme.spacing.xs },
  card: { width: '100%' },
  frame: { width: '100%', aspectRatio: 2 / 3, backgroundColor: colors.surface, borderRadius: theme.radius, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  fallback: { color: colors.textMuted, fontSize: 13, padding: theme.spacing.sm, textAlign: 'center' },
  name: { color: colors.text, fontSize: 12, fontWeight: '600', marginTop: 4 },
  meta: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
