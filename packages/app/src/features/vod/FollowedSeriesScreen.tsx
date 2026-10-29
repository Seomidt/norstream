import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import type { AppSession } from '../../session.js';
import type { StoredVodItem } from '../../storage/vod.js';
import { listFollowedSeries, markSeriesSeen, newEpisodesLabel, unfollowSeries } from '../../storage/followedSeries.js';
import type { FollowedSeries } from '../../storage/followedSeries.js';
import { theme } from '../../ui/theme.js';
import { useStyles, useTheme } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { useVodListFocus } from './useVodListFocus.js';
import { useVodShelfRefresh } from './useVodShelfRefresh.js';
import { posterImageUri } from './posterImage.js';

interface Props {
  session: AppSession;
  active: boolean;
  reloadToken?: number;
  onOpen: (series: StoredVodItem) => void;
}

/** En enkel oversigt. Kortet aabner serien; ny-markering ryddes kun ved
 * eksplicit valg eller naar afsnittet faktisk er set faerdig. */
export function FollowedSeriesScreen({ session, active, reloadToken = 0, onOpen }: Props) {
  const styles = useStyles(makeStyles);
  const { colors } = useTheme();
  const [entries, setEntries] = useState<FollowedSeries[] | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [firstFocus, setFirstFocus] = useState(false);
  const focused = useRef(false);
  const scroll = useVodListFocus<FollowedSeries>();
  useEffect(() => {
    if (!isTV || focused.current || entries === null || entries.length === 0) return;
    focused.current = true;
    setFirstFocus(true);
    const frame = requestAnimationFrame(() => setFirstFocus(false));
    return () => cancelAnimationFrame(frame);
  }, [entries]);
  const load = useCallback(async () => {
    try { setEntries(await listFollowedSeries(session.db)); setError(false); }
    catch { setError(true); }
  }, [session.db]);
  useVodShelfRefresh(load, active, reloadToken);
  const change = async (entry: FollowedSeries, action: 'seen' | 'unfollow'): Promise<void> => {
    if (busy !== null) return;
    setBusy(entry.series.key);
    try {
      if (action === 'seen') await markSeriesSeen(session.db, entry.series.key);
      else await unfollowSeries(session.db, entry.series.key);
      await load();
    } catch { setError(true); }
    finally { setBusy(null); }
  };
  return <View style={styles.container}>
    <Text style={styles.title}>Serier jeg følger</Text>
    <Text style={styles.hint}>Nye afsnit i din pakke. Vælg en serie for at se afsnittene.</Text>
    {error && <Text style={styles.hint}>Listen kunne ikke opdateres. Prøv igen om lidt.</Text>}
    {entries === null ? <ActivityIndicator color={colors.accent} /> : <FlatList
      ref={scroll.list} data={entries} keyExtractor={entry => entry.series.key}
      removeClippedSubviews={false} onScrollToIndexFailed={scroll.failed}
      contentContainerStyle={[styles.list, scroll.tail]}
      ListEmptyComponent={<Text style={styles.hint}>Du følger ingen serier endnu. Åbn en serie, og vælg “Følg serien”.</Text>}
      renderItem={({ item: entry, index }) => {
        const poster = entry.series.posterUrl ?? entry.series.foundPosterUrl;
        return <View style={styles.entry}>
          <TvPressable style={styles.open} hasTVPreferredFocus={firstFocus && index === 0} onFocus={() => scroll.focus(index)} onPress={() => onOpen(entry.series)}>
            {poster !== null && <Image source={{ uri: posterImageUri(poster) }} style={styles.poster} resizeMode="cover" />}
            <View style={styles.description}>
              <Text style={styles.name} numberOfLines={2}>{entry.series.name}</Text>
              <Text style={[styles.hint, entry.newCount > 0 && styles.new]}>{newEpisodesLabel(entry.newEpisodes)}</Text>
            </View>
          </TvPressable>
          <View style={styles.actions}>
            {entry.newCount > 0 && <TvPressable style={styles.action} disabled={busy !== null} onFocus={() => scroll.focus(index)} onPress={() => { void change(entry, 'seen'); }}>
              <Text style={styles.actionText}>Markér nye som læst</Text>
            </TvPressable>}
            <TvPressable style={styles.action} disabled={busy !== null} onFocus={() => scroll.focus(index)} onPress={() => { void change(entry, 'unfollow'); }}>
              <Text style={styles.actionText}>Stop med at følge</Text>
            </TvPressable>
          </View>
        </View>;
      }}
    />}
  </View>;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: theme.spacing.md },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: theme.spacing.sm },
  hint: { color: colors.textMuted, fontSize: 13, marginBottom: theme.spacing.sm },
  list: { gap: theme.spacing.md },
  entry: { backgroundColor: colors.surface, borderRadius: theme.radius, padding: theme.spacing.sm },
  open: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.md, padding: theme.spacing.xs },
  poster: { width: 48, height: 72, borderRadius: theme.radius },
  description: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: theme.spacing.xs },
  new: { color: colors.accent, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  action: { backgroundColor: colors.background, borderRadius: theme.radius, padding: theme.spacing.sm },
  actionText: { color: colors.text, fontSize: 13 },
});
