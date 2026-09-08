import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppSession } from '../../session.js';
import { listChannels, setFavorite } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { theme } from '../../ui/theme.js';
import { ChannelList } from '../channels/ChannelList.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';

interface Props {
  session: AppSession;
  onSelect: (channel: StoredChannel, neighbours: StoredChannel[]) => void;
  onAuthError: () => void;
  previewHandle: { current: PreviewHandle | null };
  onPickLogo: (channel: StoredChannel) => void;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * Radiokanalerne, samlet ét sted.
 *
 * Panelet skiller ikke radio ud; det er navnet der siger det, typisk med
 * "(RADIO)" i parentes, eller kategorien. Listen er den samme som for
 * kanaler — logo, favoritstjerne, zap i afspilleren — men uden preview:
 * previewet er lydloest, og for radio er der intet at se.
 */
export function RadioScreen({ session, onSelect, onAuthError, previewHandle, onPickLogo }: Props) {
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void listChannels(session.db, { radioOnly: true, search: query }).then((list) => {
      if (cancelled) return;
      setChannels(list);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [session.db, query]);

  async function toggleFavorite(channel: StoredChannel): Promise<void> {
    await setFavorite(session.db, channel.id, !channel.isFavorite);
    setChannels((current) =>
      current.map((entry) => (entry.id === channel.id ? { ...entry, isFavorite: !entry.isFavorite } : entry)),
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Radio</Text>
        <Text style={styles.count}>{loading ? '' : `${channels.length}`}</Text>
      </View>
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Søg radiokanal"
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <ChannelList
        session={session}
        channels={channels}
        loading={loading}
        emptyText="Ingen radiokanaler fundet. Panelet mærker dem med “radio” i navnet eller kategorien."
        onSelect={onSelect}
        onToggleFavorite={(channel) => {
          void toggleFavorite(channel);
        }}
        onAuthError={onAuthError}
        previewEnabled={false}
        previewHandle={previewHandle}
        onLongPress={onPickLogo}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  title: { color: theme.colors.text, fontSize: 20, fontWeight: '700' },
  count: { color: theme.colors.textMuted, fontSize: 13 },
  input: {
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
});
