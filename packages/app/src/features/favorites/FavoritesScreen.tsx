import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { AppSession } from '../../session.js';
import { listChannels, setFavorite } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { addCategoryToFavorites, favoriteCategories, moveFavorite } from '../../storage/favorites.js';
import type { FavoriteCategory } from '../../storage/favorites.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { Notice } from '../../ui/Notice.js';
import type { NoticeState } from '../../ui/Notice.js';
import { theme } from '../../ui/theme.js';
import { ChannelList } from '../channels/ChannelList.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';

interface Props {
  session: AppSession;
  onSelect: (channel: StoredChannel) => void;
  onAuthError: () => void;
  onBrowse: () => void;
  previewEnabled: boolean;
  previewHandle: { current: PreviewHandle | null };
  onPickLogo: (channel: StoredChannel) => void;
  refreshing: boolean;
  onRefresh: () => void;
  /** Aendres af foraelderen naar favoritterne kan have aendret sig andetsteds. */
  reloadToken: number;
}

/**
 * Startskaermen: favoritterne, én liste, i brugerens egen raekkefoelge.
 *
 * Den var grupperet efter den kategori favoritterne kom fra, og saa snart
 * man lagde én kanal til ved siden af en hel kategori, skiftede skaermen til
 * en anden liste — uden logoer, uden nu-titler, uden preview — med en gruppe
 * der hed "Egne favoritter". Det saa ud som om alt var forsvundet.
 *
 * Nu er det altid den samme liste som under Kanaler. Nye favoritter laegger
 * sig nederst, en hel kategori laegges nederst i panelets orden, og
 * raekkefoelgen kan aendres under "Sortér". Kategorierne huskes stadig, saa
 * "Opdatér" kan hente de kanaler udbyderen har lagt i dem siden sidst.
 */
export function FavoritesScreen({
  session,
  onSelect,
  onAuthError,
  onBrowse,
  previewEnabled,
  previewHandle,
  onPickLogo,
  refreshing,
  onRefresh,
  reloadToken,
}: Props) {
  const [channels, setChannels] = useState<StoredChannel[]>([]);
  const [categories, setCategories] = useState<FavoriteCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [sorting, setSorting] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const [list, fromCategories] = await Promise.all([
        listChannels(session.db, { favouritesOnly: true }),
        favoriteCategories(session.db),
      ]);
      setChannels(list);
      setCategories(fromCategories);
    } finally {
      setLoading(false);
    }
  }, [session.db]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  async function toggleFavorite(channel: StoredChannel): Promise<void> {
    await setFavorite(session.db, channel.id, !channel.isFavorite);
    await load();
  }

  /** Henter det udbyderen har lagt i favoritternes kategorier siden sidst. */
  async function refreshCategories(): Promise<void> {
    let added = 0;
    for (const category of categories) {
      added += await addCategoryToFavorites(session.db, category.id);
    }
    await load();
    setNotice({
      text:
        added === 0
          ? 'Ingen nye kanaler i dine kategorier.'
          : `${added} nye kanaler er lagt nederst i favoritter.`,
    });
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (channels.length === 0) {
    // Spec sec.5: en kort besked der peger paa browse, ikke en tom liste.
    return (
      <ScrollView
        contentContainerStyle={styles.emptyBox}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.accent}
          />
        }
      >
        <Text style={styles.emptyTitle}>Ingen favoritter endnu</Text>
        <Text style={styles.emptyText}>
          Under Kanaler kan du finde dine lande og lægge hele kategorier i favoritter på én gang.
        </Text>
        <Pressable style={styles.button} onPress={onBrowse}>
          <Text style={styles.buttonText}>Gå til Kanaler</Text>
        </Pressable>
      </ScrollView>
    );
  }

  if (sorting) {
    return (
      <SortView
        channels={channels}
        onMove={async (channel, toIndex) => {
          await moveFavorite(session.db, channel.id, toIndex);
          await load();
        }}
        onDone={() => setSorting(false)}
      />
    );
  }

  const header = (
    <View style={styles.toolbar}>
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      <View style={styles.toolbarRow}>
        <Text style={styles.toolbarCount}>{channels.length} kanaler</Text>
        {categories.length > 0 && (
          <Pressable
            style={styles.action}
            hitSlop={8}
            onPress={() => {
              void refreshCategories();
            }}
          >
            <Text style={styles.actionText}>Opdatér</Text>
          </Pressable>
        )}
        <Pressable style={styles.action} hitSlop={8} onPress={() => setSorting(true)}>
          <Text style={styles.actionText}>Sortér</Text>
        </Pressable>
      </View>
    </View>
  );

  return (
    <ChannelList
      session={session}
      channels={channels}
      loading={false}
      emptyText="Ingen favoritter."
      onSelect={onSelect}
      onToggleFavorite={(channel) => {
        void toggleFavorite(channel);
      }}
      onAuthError={onAuthError}
      previewEnabled={previewEnabled}
      previewHandle={previewHandle}
      onLongPress={onPickLogo}
      refreshing={refreshing}
      onRefresh={onRefresh}
      header={header}
    />
  );
}

/**
 * Raekkefoelgen, aendret med to tryk: ét paa kanalen der skal flyttes, ét paa
 * pladsen den skal have. Traek-og-slip kraever et bibliotek appen ikke har,
 * og pile der flytter én plads ad gangen er ubrugelige med 61 kanaler.
 */
function SortView({
  channels,
  onMove,
  onDone,
}: {
  channels: StoredChannel[];
  onMove: (channel: StoredChannel, toIndex: number) => Promise<void>;
  onDone: () => void;
}) {
  const [picked, setPicked] = useState<StoredChannel | null>(null);
  const [busy, setBusy] = useState(false);

  async function move(toIndex: number): Promise<void> {
    if (picked === null || busy) return;
    setBusy(true);
    try {
      await onMove(picked, toIndex);
    } finally {
      setBusy(false);
      setPicked(null);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Text style={styles.sortHint}>
          {picked === null
            ? 'Tryk på den kanal der skal flyttes.'
            : `Tryk på den plads “${picked.name}” skal have.`}
        </Text>
        <View style={styles.toolbarRow}>
          {picked !== null && (
            <>
              <Pressable style={styles.action} hitSlop={8} onPress={() => void move(0)}>
                <Text style={styles.actionText}>Øverst</Text>
              </Pressable>
              <Pressable
                style={styles.action}
                hitSlop={8}
                onPress={() => void move(channels.length)}
              >
                <Text style={styles.actionText}>Nederst</Text>
              </Pressable>
              <Pressable style={styles.action} hitSlop={8} onPress={() => setPicked(null)}>
                <Text style={styles.actionText}>Fortryd</Text>
              </Pressable>
            </>
          )}
          <View style={styles.spacer} />
          <Pressable style={[styles.action, styles.actionAccent]} hitSlop={8} onPress={onDone}>
            <Text style={styles.actionText}>Færdig</Text>
          </Pressable>
        </View>
      </View>
      <FlatList
        data={channels}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => {
          const isPicked = picked?.id === item.id;
          return (
            <Pressable
              style={[styles.row, isPicked && styles.rowPicked]}
              onPress={() => {
                if (picked === null || isPicked) {
                  setPicked(isPicked ? null : item);
                  return;
                }
                void move(index);
              }}
            >
              <Text style={styles.position}>{index + 1}</Text>
              <ChannelLogo uris={item.logoUrls} name={item.name} memoryKey={item.id} size={36} />
              <Text style={styles.channelName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.handle}>{isPicked ? '✓' : '☰'}</Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.background,
  },
  emptyBox: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.background,
  },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: '600' },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 15,
    textAlign: 'center',
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
    lineHeight: 21,
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
  },
  buttonText: { color: theme.colors.text, fontSize: 16, fontWeight: '600' },
  toolbar: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm },
  toolbarCount: { flex: 1, color: theme.colors.textMuted, fontSize: 13 },
  spacer: { flex: 1 },
  sortHint: { color: theme.colors.text, fontSize: 14, marginBottom: theme.spacing.sm },
  action: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.sm + 2,
    paddingVertical: theme.spacing.xs + 2,
  },
  actionAccent: { backgroundColor: theme.colors.accent },
  actionText: { color: theme.colors.text, fontSize: 13, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowPicked: { backgroundColor: theme.colors.surfaceRaised },
  position: { width: 28, color: theme.colors.textMuted, fontSize: 13, textAlign: 'right' },
  channelName: { flex: 1, color: theme.colors.text, fontSize: 16 },
  handle: { color: theme.colors.textMuted, fontSize: 18 },
});
