import { useCallback, useEffect, useState } from 'react';
import { BackHandler, FlatList, Linking, StyleSheet, Text, View } from 'react-native';
import { listSavedSongs, removeSavedSong, spotifyAppUrl, spotifyWebUrl } from '../../storage/savedSongs.js';
import type { SavedSong } from '../../storage/savedSongs.js';
import type { SqlDatabase } from '../../storage/types.js';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';
import { useTvListTail } from '../../ui/tvScroll.js';

interface Props {
  db: SqlDatabase;
  /** Tilbage-tasten lukker listen naar den er givet. */
  onBack?: () => void;
  /** Taelles op udefra naar der er gemt sange andre steder (bilen), saa listen laeses igen. */
  refreshSignal?: number;
}

/**
 * Sangene man har gemt fra radioen, nyeste oeverst. Et tryk aabner sangen i
 * Spotify — appen naar den er der, ellers Spotify paa nettet. Hold nede
 * (OK paa tv) for at fjerne den.
 */
export function SavedSongsScreen({ db, onBack, refreshSignal = 0 }: Props) {
  const styles = useStyles(makeStyles);
  const tail = useTvListTail();
  const [songs, setSongs] = useState<SavedSong[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setSongs(await listSavedSongs(db));
  }, [db]);

  useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  useEffect(() => {
    if (onBack === undefined) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => subscription.remove();
  }, [onBack]);

  async function openInSpotify(song: SavedSong): Promise<void> {
    setMessage(null);
    try {
      await Linking.openURL(spotifyAppUrl(song));
    } catch {
      try {
        await Linking.openURL(spotifyWebUrl(song));
      } catch {
        setMessage('Spotify kunne ikke åbnes på denne enhed.');
      }
    }
  }

  async function remove(song: SavedSong): Promise<void> {
    await removeSavedSong(db, song.artist, song.track);
    setSongs((current) => current?.filter((entry) => entry.artist !== song.artist || entry.track !== song.track) ?? null);
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={songs ?? []}
        keyExtractor={(song) => `${song.artist}|${song.track}`}
        contentContainerStyle={tail}
        ListHeaderComponent={
          <Text style={styles.hint}>
            {isTV
              ? 'OK åbner sangen i Spotify. Hold OK nede for at fjerne den.'
              : 'Tryk for at åbne sangen i Spotify. Hold fingeren nede for at fjerne den.'}
            {message !== null ? ` ${message}` : ''}
          </Text>
        }
        ListEmptyComponent={
          songs === null ? null : (
            <Text style={styles.empty}>
              Ingen gemte sange endnu. Tryk “Gem sang” i afspilleren, når radioen spiller noget du vil finde igen.
            </Text>
          )
        }
        renderItem={({ item }) => (
          <TvPressable style={styles.row} onPress={() => void openInSpotify(item)} onLongPress={() => void remove(item)}>
            <View style={styles.rowText}>
              <Text style={styles.track} numberOfLines={1}>
                {item.track}
              </Text>
              <Text style={styles.artist} numberOfLines={1}>
                {item.artist}
              </Text>
              <Text style={styles.where} numberOfLines={1}>
                {item.station.length > 0 ? `${item.station} · ` : ''}
                {new Date(item.savedMs).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })}
              </Text>
            </View>
            <Text style={styles.open}>Spotify ›</Text>
          </TvPressable>
        )}
      />
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  empty: { color: colors.textMuted, textAlign: 'center', padding: theme.spacing.lg, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  track: { color: colors.text, fontSize: 16, fontWeight: '700' },
  artist: { color: colors.text, fontSize: 14, opacity: 0.85 },
  where: { color: colors.textMuted, fontSize: 12 },
  open: { color: colors.accent, fontSize: 14, fontWeight: '700' },
});
