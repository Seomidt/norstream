import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { AppSession } from '../../session.js';
import { listChannelsWithoutArchiveLogo } from '../../storage/logoOverrides.js';
import type { ChannelWithoutLogo } from '../../storage/logoOverrides.js';
import { theme } from '../../ui/theme.js';

interface Props {
  session: AppSession;
  onBack: () => void;
  onPick: (channelKey: string) => void;
  /** Aendres naar et logo er valgt, saa listen tegnes igen. */
  reloadToken: number;
}

const SEARCH_DEBOUNCE_MS = 200;

/**
 * Kanalerne der staar uden logo fra nogen af arkiverne — favoritterne
 * foerst. Ét tryk aabner valget. Listen bliver kortere for hver kanal man
 * giver et logo.
 */
export function LogoGapsScreen({ session, onBack, onPick, reloadToken }: Props) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ChannelWithoutLogo[] | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (): Promise<void> => {
    setRows(await listChannelsWithoutArchiveLogo(session.db, { search: query, limit: 300 }));
  }, [session.db, query]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  return (
    <View style={styles.container}>
      <Pressable style={styles.crumb} onPress={onBack} hitSlop={8}>
        <Text style={styles.crumbBack}>‹</Text>
        <Text style={styles.crumbLabel}>Kanaler uden logo</Text>
      </Pressable>
      <Text style={styles.hint}>
        Dem ingen af arkiverne kender. Favoritterne står øverst. Tryk på en kanal for at
        vælge et logo selv.
      </Text>
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        placeholder="Søg"
        placeholderTextColor={theme.colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
      />
      <FlatList
        data={rows ?? []}
        keyExtractor={(row) => row.id}
        ListEmptyComponent={
          <Text style={styles.hint}>
            {rows === null ? 'Tæller …' : 'Ingen — alle kanaler har et logo fra et arkiv eller dit eget valg.'}
          </Text>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onPick(item.id)}>
            <Text style={styles.star}>{item.isFavorite ? '★' : ' '}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  crumb: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.sm },
  crumbBack: { color: theme.colors.accent, fontSize: 26, marginRight: theme.spacing.sm },
  crumbLabel: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
  hint: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18, paddingHorizontal: theme.spacing.md, marginBottom: theme.spacing.sm },
  input: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius,
    color: theme.colors.text,
    padding: theme.spacing.sm + 2,
    marginHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    fontSize: 15,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + 4,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  star: { color: theme.colors.accent, width: 20, fontSize: 14 },
  name: { flex: 1, color: theme.colors.text, fontSize: 15 },
  chevron: { color: theme.colors.textMuted, fontSize: 22 },
});
