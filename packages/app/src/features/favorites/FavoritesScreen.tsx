import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { AppSession } from '../../session.js';
import { setFavorite } from '../../storage/channels.js';
import type { StoredChannel } from '../../storage/channels.js';
import { addCategoryToFavorites, listFavoriteGroups } from '../../storage/favorites.js';
import type { FavoriteGroup } from '../../storage/favorites.js';
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
  refreshing: boolean;
  onRefresh: () => void;
  /** Aendres af foraelderen naar favoritterne kan have aendret sig andetsteds. */
  reloadToken: number;
}

/**
 * Startskaermen: favoritterne, grupperet efter den kategori de kom fra.
 *
 * Uden grupperingen ville ét tryk paa "Tilfoej alle" for Danmark give 979
 * kanaler i én flad liste — det samme problem som spec'en loeser for browse.
 */
export function FavoritesScreen({
  session,
  onSelect,
  onAuthError,
  onBrowse,
  previewEnabled,
  previewHandle,
  refreshing,
  onRefresh,
  reloadToken,
}: Props) {
  const [groups, setGroups] = useState<FavoriteGroup[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setGroups(await listFavoriteGroups(session.db));
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

  async function refreshGroup(group: FavoriteGroup): Promise<void> {
    if (group.categoryId === null) return;
    const added = await addCategoryToFavorites(session.db, group.categoryId);
    await load();
    setNotice({
      text:
        added === 0
          ? 'Ingen nye kanaler i kategorien.'
          : `${added} nye kanaler er lagt i favoritter.`,
    });
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  if (groups.length === 0) {
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

  // Er der kun én gruppe, er sektionsoverskriften stoej: vis listen direkte.
  const single = groups.length === 1 ? groups[0] : undefined;
  if (single !== undefined) {
    return (
      <ChannelList
        session={session}
        channels={single.channels}
        loading={false}
        emptyText="Ingen favoritter."
        onSelect={onSelect}
        onToggleFavorite={(channel) => {
          void toggleFavorite(channel);
        }}
        onAuthError={onAuthError}
        previewEnabled={previewEnabled}
        previewHandle={previewHandle}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={theme.colors.accent}
        />
      }
    >
      <Notice notice={notice} onDismiss={() => setNotice(null)} />
      {groups.map((group) => {
        const key = group.categoryId ?? '__loose__';
        const isCollapsed = collapsed[key] === true;
        return (
          <View key={key}>
            <View style={styles.sectionHeader}>
              <Pressable
                style={styles.sectionMain}
                onPress={() =>
                  setCollapsed((previous) => ({ ...previous, [key]: !isCollapsed }))
                }
              >
                <Text style={styles.sectionTitle} numberOfLines={1}>
                  {isCollapsed ? '▸' : '▾'} {group.categoryName}
                </Text>
                <Text style={styles.sectionCount}>{group.channels.length}</Text>
              </Pressable>
              {group.categoryId !== null && (
                <Pressable
                  style={styles.action}
                  hitSlop={8}
                  onPress={() => {
                    void refreshGroup(group);
                  }}
                >
                  <Text style={styles.actionText}>Opdatér</Text>
                </Pressable>
              )}
            </View>

            {!isCollapsed &&
              group.channels.map((channel) => (
                <Pressable
                  key={channel.id}
                  style={styles.row}
                  onPress={() => {
                    void (async () => {
                      // Panelets ene forbindelse skal vaere sluppet foerst.
                      // Fejler det, aabner vi alligevel.
                      try {
                        await previewHandle.current?.release();
                      } catch {
                        // Med vilje.
                      }
                      onSelect(channel);
                    })();
                  }}
                >
                  <Text style={styles.channelName} numberOfLines={1}>
                    {channel.name}
                  </Text>
                  <Pressable
                    hitSlop={12}
                    onPress={() => {
                      void toggleFavorite(channel);
                    }}
                  >
                    <Text style={styles.starOn}>★</Text>
                  </Pressable>
                </Pressable>
              ))}
          </View>
        );
      })}
    </ScrollView>
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  sectionMain: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: '600' },
  sectionCount: { color: theme.colors.textMuted, fontSize: 13, marginRight: theme.spacing.sm },
  action: {
    backgroundColor: theme.colors.surfaceRaised,
    borderRadius: theme.radius,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
  },
  actionText: { color: theme.colors.text, fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  channelName: { flex: 1, color: theme.colors.text, fontSize: 16 },
  starOn: { color: theme.colors.accent, fontSize: 22 },
});
