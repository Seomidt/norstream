import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { XtreamAuthError } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { getNowNext } from '../../storage/programmes.js';
import { ensureEpg } from '../../sync/epgCache.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import { MiniPreview } from '../preview/MiniPreview.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';

interface Props {
  session: AppSession;
  channels: StoredChannel[];
  loading: boolean;
  emptyText: string;
  onSelect: (channel: StoredChannel) => void;
  onToggleFavorite: (channel: StoredChannel) => void;
  onAuthError: () => void;
  previewEnabled: boolean;
  previewHandle: { current: PreviewHandle | null };
  refreshing?: boolean;
  onRefresh?: () => void;
  header?: ReactNode;
}

/**
 * Kanallisten med nu-titler og mini-preview.
 *
 * Foraelderen leverer kanalerne; listen ejer to ting den er det rette sted til:
 * at hente EPG for **de raekker der faktisk er synlige**, og at pege previewet
 * paa den kanal brugeren staar paa. Med 22.142 kanaler er "kun det synlige"
 * forskellen mellem et opslag og et udfald.
 */
export function ChannelList({
  session,
  channels,
  loading,
  emptyText,
  onSelect,
  onToggleFavorite,
  onAuthError,
  previewEnabled,
  previewHandle,
  refreshing = false,
  onRefresh,
  header,
}: Props) {
  const [nowTitles, setNowTitles] = useState<Record<string, string>>({});
  const [previewChannel, setPreviewChannel] = useState<StoredChannel | null>(null);

  // Annulleringspolet: kun det nyeste opslag maa skrive til state. Uden det
  // kan to overlappende koersler skrive resultater i den forkerte raekkefoelge.
  const runId = useRef(0);

  const loadVisible = useCallback(
    async (streamIds: string[]): Promise<void> => {
      if (streamIds.length === 0) return;
      const id = runId.current + 1;
      runId.current = id;

      try {
        await ensureEpg(session.db, session.credsBySource, session.fetchImpl, streamIds);
      } catch (cause) {
        if (cause instanceof XtreamAuthError) {
          onAuthError();
          return;
        }
        // Panelet kunne ikke naas. Vi viser hvad cachen har.
      }
      if (runId.current !== id) return;

      const now = new Date();
      const titles: Record<string, string> = {};
      for (const streamId of streamIds) {
        // Opslaget sker paa kanalens eget id — Xtreams stream_id. I v1 gik det
        // gennem epg_channel_id, som 87 % af kanalerne ikke har.
        const result = await getNowNext(session.db, streamId, now);
        if (result.now) titles[streamId] = result.now.title;
      }
      if (runId.current !== id) return;
      setNowTitles((previous) => ({ ...previous, ...titles }));
    },
    [session, onAuthError],
  );

  // FlatList kraever at onViewableItemsChanged er den samme funktion hele
  // komponentens levetid, saa den laeser den nyeste indlaeser gennem en ref.
  const loadVisibleRef = useRef(loadVisible);
  useEffect(() => {
    loadVisibleRef.current = loadVisible;
  }, [loadVisible]);

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  const onViewableItemsChanged = useRef(
    (info: { viewableItems: { item: StoredChannel }[] }): void => {
      const items = info.viewableItems.map((entry) => entry.item).filter(Boolean);
      setPreviewChannel(items[0] ?? null);
      void loadVisibleRef.current(items.map((item) => item.id));
    },
  ).current;

  // Foerste skaermfuld: onViewableItemsChanged fyrer ikke altid ved montering,
  // og uden dette ville listen staa med "Ingen programdata" til man rullede.
  useEffect(() => {
    const first = channels.slice(0, 15);
    if (first.length === 0) return;
    setPreviewChannel(first[0] ?? null);
    void loadVisibleRef.current(first.map((channel) => channel.id));
  }, [channels]);

  async function open(channel: StoredChannel): Promise<void> {
    // Panelet har én forbindelse: previewet skal have sluppet den, foer
    // afspilleren beder om sin. Ellers afvises den stream brugeren bad om.
    //
    // Fejler frigivelsen, aabner vi alligevel: et tryk der ikke goer noget er
    // vaerre end en stream der maaske skal proeve igen.
    try {
      await previewHandle.current?.release();
    } catch {
      // Med vilje.
    }
    onSelect(channel);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <MiniPreview
        session={session}
        channel={previewChannel}
        enabled={previewEnabled}
        handle={previewHandle}
        onOpen={(channel) => {
          void open(channel);
        }}
      />

      <FlatList
        data={channels}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header === undefined ? undefined : <>{header}</>}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
        refreshControl={
          onRefresh === undefined ? undefined : (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.accent}
            />
          )
        }
        ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => {
              void open(item);
            }}
          >
            <ChannelLogo uri={item.logoUrl} name={item.name} />
            <View style={styles.rowText}>
              <Text style={styles.channelName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.nowTitle} numberOfLines={1}>
                {nowTitles[item.id] ?? 'Ingen programdata'}
              </Text>
            </View>
            <Pressable hitSlop={12} onPress={() => onToggleFavorite(item)}>
              <Text style={item.isFavorite ? styles.starOn : styles.starOff}>★</Text>
            </Pressable>
          </Pressable>
        )}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  logo: { width: 44, height: 44, borderRadius: 6, backgroundColor: theme.colors.surface },
  rowText: { flex: 1, marginLeft: theme.spacing.md },
  channelName: { color: theme.colors.text, fontSize: 16 },
  nowTitle: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  starOn: { color: theme.colors.accent, fontSize: 22 },
  starOff: { color: theme.colors.border, fontSize: 22 },
  empty: {
    color: theme.colors.textMuted,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
    paddingHorizontal: theme.spacing.lg,
    lineHeight: 20,
  },
});
