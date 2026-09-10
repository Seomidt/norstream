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
import { sourcesWithDialect } from '../../storage/settings.js';
import { restartFilterEnabled, setRestartFilterEnabled, subscribeRestartFilter } from './restartFilter.js';
import { ensureEpg } from '../../sync/epgCache.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import { isTV, useCanvasSize } from '../../ui/tv.js';
import { guideTopLayout, sidePreviewFraction } from '../guide/nowNext.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { MiniPreview } from '../preview/MiniPreview.js';
import type { PreviewHandle } from '../preview/MiniPreview.js';

interface Props {
  session: AppSession;
  channels: StoredChannel[];
  loading: boolean;
  emptyText: string;
  /** Kanalen, og listen den stod i — saa afspilleren kan zappe til naboerne. */
  onSelect: (channel: StoredChannel, neighbours: StoredChannel[]) => void;
  onToggleFavorite: (channel: StoredChannel) => void;
  onAuthError: () => void;
  previewEnabled: boolean;
  previewHandle: { current: PreviewHandle | null };
  refreshing?: boolean;
  onRefresh?: () => void;
  header?: ReactNode;
  /** Hold fingeren paa en kanal: vaelg dens logo selv. */
  onLongPress?: (channel: StoredChannel) => void;
  /**
   * Om filteret "kun kanaler med start forfra" gaelder her. Radio har intet
   * arkiv, saa filteret ville tage hele listen — det er slaaet fra dér.
   */
  allowRestartFilter?: boolean;
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
  onLongPress,
  allowRestartFilter = true,
}: Props) {
  const [nowTitles, setNowTitles] = useState<Record<string, string>>({});
  const [previewChannel, setPreviewChannel] = useState<StoredChannel | null>(null);
  const sideBySide = guideTopLayout(useCanvasSize().width) === 'side';

  /**
   * Uret: kanalen kan startes forfra. Kraever baade at udbyderen siger den
   * har arkiv, og at appen har fundet vejen til det (dialekten) for kilden.
   * Samme regel som i guiden, saa uret betyder det samme begge steder.
   */
  const [dialects, setDialects] = useState<Set<string>>(new Set());
  const [restartOnly, setRestartOnly] = useState(restartFilterEnabled());
  useEffect(() => subscribeRestartFilter(() => setRestartOnly(restartFilterEnabled())), []);
  useEffect(() => {
    let cancelled = false;
    void sourcesWithDialect(session.db).then((found) => {
      if (!cancelled) setDialects(found);
    });
    return () => {
      cancelled = true;
    };
  }, [session.db]);
  const canRestart = (channel: StoredChannel): boolean =>
    channel.hasArchive && dialects.has(channel.sourceId);
  const shown = restartOnly && allowRestartFilter ? channels.filter(canRestart) : channels;
  const restartable = channels.filter(canRestart).length;

  function toggleRestartOnly(): void {
    setRestartFilterEnabled(!restartOnly);
  }

  // Annulleringspolet: kun det nyeste opslag maa skrive til state. Uden det
  // kan to overlappende koersler skrive resultater i den forkerte raekkefoelge.
  const runId = useRef(0);

  const loadVisible = useCallback(
    async (streamIds: string[]): Promise<void> => {
      if (streamIds.length === 0) return;
      const id = runId.current + 1;
      runId.current = id;

      /** Tegner det cachen har. Kaldes foer og efter hentningen. */
      const draw = async (): Promise<boolean> => {
        const now = new Date();
        const titles: Record<string, string> = {};
        for (const streamId of streamIds) {
          // Opslaget sker paa kanalens eget id — Xtreams stream_id. I v1 gik
          // det gennem epg_channel_id, som 87 % af kanalerne ikke har.
          const result = await getNowNext(session.db, streamId, now);
          if (result.now) titles[streamId] = result.now.title;
        }
        if (runId.current !== id) return false;
        setNowTitles((previous) => ({ ...previous, ...titles }));
        return true;
      };

      // **Cachen foerst**, som i guiden. Foer stod titlerne tomme mens panelet
      // svarede, hver gang programdata var mere end en halv time gamle — og
      // det saa ud som om listen laeste alt ind forfra ved hvert besoeg.
      if (!(await draw())) return;

      try {
        await ensureEpg(session.db, session.credsBySource, session.fetchImpl, streamIds);
      } catch (cause) {
        if (cause instanceof XtreamAuthError) {
          onAuthError();
          return;
        }
        // Panelet kunne ikke naas. Det tegnede staar.
      }
      await draw();
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
    const first = shown.slice(0, 15);
    if (first.length === 0) return;
    setPreviewChannel(first[0] ?? null);
    void loadVisibleRef.current(first.map((channel) => channel.id));
    // `shown` afhaenger kun af kanalerne og filteret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, restartOnly, dialects]);

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
    onSelect(channel, shown);
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  const preview = (
    <MiniPreview
      session={session}
      channel={previewChannel}
      enabled={previewEnabled}
      handle={previewHandle}
      onOpen={(channel) => {
        void open(channel);
      }}
    />
  );

  return (
    <View style={sideBySide ? styles.containerSide : styles.container}>
      {/* Smal skaerm: previewet som en stribe over listen. Bred skaerm
          (tablet, tv): previewet til hoejre, listen til venstre med hele
          hoejden. Foer fyldte 16:9 af laerredets bredde hele laerredets
          hoejde paa tv, og listen laa under menulinjen: "ingen kanaler". */}
      {!sideBySide && preview}
      <View style={styles.container}>
      {/* Filteret staar over listen, ikke i hver foraelders header: det er
          det samme valg alle steder, og det huskes. */}
      {/* Er filteret slaaet til, staar raekken altid — ogsaa i en liste hvor
          ingen kanal kan startes forfra. Foer forsvandt raekken netop dér, og
          listen stod tom uden at sige hvorfor: "der mangler en masse kanaler". */}
      {isTV && <Text style={styles.tvHint}>Hold OK nede på en kanal for at tilføje eller fjerne den som favorit.</Text>}
      {allowRestartFilter && (restartable > 0 || restartOnly) && (
        <TvPressable style={[styles.filter, restartOnly && styles.filterOn]} onPress={toggleRestartOnly} hitSlop={6}>
          <Text style={[styles.filterText, restartOnly && styles.filterTextOn]}>
            {restartOnly
              ? `✓ ⏱ Filter slået til: viser ${shown.length} af ${channels.length} kanaler, kun dem med start forfra. Tryk for at slå fra.`
              : `⏱ Kun kanaler med start forfra (${restartable})`}
          </Text>
        </TvPressable>
      )}
      <FlatList
        data={shown}
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
          <TvPressable
            style={styles.row}
            onPress={() => {
              void open(item);
            }}
            // Paa tv er et langt tryk paa OK favorit til/fra: stjernen som
            // eget trykpunkt inde i raekken var ikke til at ramme med
            // fjernbetjeningen. Logovalget (langt tryk paa telefonen) er
            // ikke noget man goer fra sofaen.
            onLongPress={
              isTV ? () => onToggleFavorite(item) : onLongPress === undefined ? undefined : () => onLongPress(item)
            }
            delayLongPress={400}
            // Paa tv foelger previewet den raekke fjernbetjeningen staar paa,
            // ikke den oeverste synlige: det er dén man kigger paa.
            onFocus={isTV ? () => setPreviewChannel(item) : undefined}
          >
            <ChannelLogo uris={item.logoUrls} name={item.name} memoryKey={item.id} />
            <View style={styles.rowText}>
              <Text style={styles.channelName} numberOfLines={1}>
                {canRestart(item) ? <Text style={styles.restartMark}>⏱ </Text> : null}
                {item.name}
              </Text>
              <Text style={styles.nowTitle} numberOfLines={1}>
                {nowTitles[item.id] ?? 'Ingen programdata'}
              </Text>
            </View>
            <TvPressable hitSlop={12} focusable={!isTV} onPress={() => onToggleFavorite(item)}>
              <Text style={item.isFavorite ? styles.starOn : styles.starOff}>★</Text>
            </TvPressable>
          </TvPressable>
        )}
      />
      </View>
      {sideBySide && previewEnabled && (
        <View style={{ width: `${Math.round(sidePreviewFraction(isTV) * 100)}%` }}>{preview}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  containerSide: { flex: 1, flexDirection: 'row', alignItems: 'stretch', backgroundColor: theme.colors.background },
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
  restartMark: { color: theme.colors.accent, fontSize: 14 },
  filter: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.surface,
  },
  filterOn: { backgroundColor: '#4c8dff22', borderBottomColor: theme.colors.accent },
  filterText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: '600' },
  filterTextOn: { color: theme.colors.accent },
  nowTitle: { color: theme.colors.textMuted, fontSize: 13, marginTop: 2 },
  tvHint: { color: theme.colors.textMuted, fontSize: 12, paddingHorizontal: theme.spacing.md, paddingVertical: theme.spacing.xs },
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
