import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import type { AppSession } from '../../session.js';
import { getTmdbApiKey } from '../../storage/settings.js';
import { movieCollectionForItem } from '../../storage/movieCollections.js';
import type { MovieCollectionSummary } from '../../storage/movieCollections.js';
import { discoverMovieCollections } from '../../sync/movieCollections.js';
import { tmdbFetch } from '../../sync/tmdb.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { theme } from '../../ui/theme.js';

/** Den lokale samling vises foerst; kun den viste films metadata prioriteres. */
export function MovieCollectionLink({ session, itemKey, onOpen }: {
  session: AppSession; itemKey: string; onOpen: (collectionId: number) => void;
}) {
  const styles = useStyles(makeStyles);
  const [collection, setCollection] = useState<MovieCollectionSummary | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCollection(null);
    void (async () => {
      try {
        const cached = await movieCollectionForItem(session.db, itemKey);
        if (cancelled) return;
        setCollection(cached);
        const key = await getTmdbApiKey(session.db);
        if (cancelled || key === null) return;
        await discoverMovieCollections(session.db, tmdbFetch, key, { itemKey, limit: 1, isCancelled: () => cancelled });
        if (cancelled) return;
        const refreshed = await movieCollectionForItem(session.db, itemKey);
        if (!cancelled) setCollection(refreshed);
      } catch { /* En manglende metadataforbindelse maa ikke blokere filmen. */ }
    })();
    return () => { cancelled = true; };
  }, [session.db, itemKey]);
  if (collection === null) return null;
  return <TvPressable style={styles.button} onPress={() => onOpen(collection.id)}>
    <Text style={styles.text}>Se samlingen: {collection.name}</Text>
  </TvPressable>;
}
const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  button: { backgroundColor: colors.surface, borderRadius: theme.radius, padding: theme.spacing.sm + 2 },
  text: { color: colors.text, fontSize: 14, fontWeight: '600' },
});
