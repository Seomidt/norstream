import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TVFocusGuideView, View, useTVEventHandler } from 'react-native';
import type { ViewToken } from 'react-native';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { listProgrammesFor } from '../../storage/programmes.js';
import type { SqlDatabase } from '../../storage/types.js';
import { ensureEpg, ensureFullEpg } from '../../sync/epgCache.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { guideAction, layoutRow } from './layout.js';
import type { CellState, GuideCell } from './layout.js';

/**
 * Guiden paa tv: en tv-guide som Tablos/Googles — kanaler som raekker, tiden i
 * kolonner af en halv time.
 *
 * Navigationen er den fra favoritlisten, som endelig virker: en LODRET liste,
 * hvor HELE raekken er ét trykpunkt. Op/ned er derfor almindelig
 * listenavigation (kan fjernbetjeningen finde ud af), og OK aabner programmet.
 * Oven paa den paalidelige navigation ligger Tablo-UDSEENDET: hver raekke viser
 * ~3 halvtimes-kolonner, hvor udsendelserne fylder deres rigtige tid.
 *
 * Tiden vaelges med pil venstre/hoejre — som et TASTETRYK (useTVEventHandler),
 * ikke en fokusflytning: der er intet fokuserbart til siderne, saa listen kan
 * ikke "fise ud i menuen". Hvert tryk skubber vinduet en halv time, og HELE
 * gitteret glider med. Det synlige tidsvindue laeses fra den lokale cache;
 * panelets opdatering foregaar separat og holder aldrig visningen tilbage.
 *
 * Forskydningen deles med telefonen (`offsetMinutes` fra GuideScreen), saa
 * hardware-Tilbage stiller vinduet tilbage paa nu.
 */

/** Vinduets bredde og kolonner. 3 kolonner a 30 min = 90 min synligt. */
const COL_MIN = 30;
const COLS = 3;
const WINDOW_MIN = COL_MIN * COLS;
const ROW_HEIGHT = 62;
const CHANNEL_COL = 128;
const HEADER_HEIGHT = 32;
/**
 * Hvor mange kommende udsendelser guiden beder panelet om (`get_short_epg`).
 * Standard var 12 — praecis "nu + naeste" = ca. 8-9 timer frem, hvorefter guiden
 * saa ud til at "stoppe". Med et hoejt tal henter den flere dage frem, saa langt
 * panelet har oversigt. `get_short_epg` giver kun fremad; fortiden kommer fra den
 * fulde tabel (`ensureFullEpg`).
 */
const GUIDE_EPG_LIMIT = 200;
const HALF_HOUR_MS = COL_MIN * 60_000;
/** Et lille vindue omkring skaermen, uanset hvor mange kanaler listen har. */
const LIST_WINDOW_SIZE = 5;
const EPG_BATCH_SIZE = 4;
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 1 };

interface Props {
  session: AppSession;
  channels: StoredChannel[];
  now: Date;
  hasDialectFor: (channel: StoredChannel) => boolean;
  /** Kaldes naar fjernbetjeningen staar paa en kanal — previewet foelger. */
  onFocusChannel: (channel: StoredChannel) => void;
  /**
   * Kaldes med den udsendelse den fokuserede kanal viser i det aktuelle vindue
   * (live hvis nu er i vinduet, ellers den foerste udsendelse i vinduet).
   * Boksen til hoejre beskriver den, saa den skifter naar man bladrer tilbage
   * i tiden — ikke kun staar paa "nu".
   */
  onFocusProgramme?: (programme: Programme | null) => void;
  /** Aabner programbladet (eller kanalen paa et hul). */
  onOpen: (channel: StoredChannel, programme: Programme | null, state: CellState) => void;
  /** Delt tidsforskydning i minutter (0 = nu). Deles med telefon-guiden. */
  offsetMinutes: number;
  /** Skru paa tiden (pil venstre/hoejre). Klemmes i GuideScreen. */
  onStepTime: (deltaMin: number) => void;
  /** Pil hoejre fra menuen: den foerste raekke faar fokus. */
  focusFirstSignal: number;
  /** Skjult af dagsside, programark eller afspiller: ingen fjernbetjening. */
  active: boolean;
  /** Kanalen man kom fra; slippes foerst ved dens native fokus-haendelse. */
  returnFocusChannelId: string | null;
  onReturnFocus: (restored: boolean) => void;
  /** Tilbage kan stoppe native fokusfoersoeg foer React tegner menuen. */
  cancelFocusRef?: { current: (() => void) | null };
}

type ProgrammeMap = Record<string, Programme[]>;
interface HotWindow { from: number; to: number; map: ProgrammeMap }
interface HotCache { first: HotWindow | null; recent: Map<string, HotWindow> }
/** Foerste live-side plus tolv nylige udsnit, aldrig et helt kanal-/ugekatalog. */
const HOT_RECENT_WINDOWS = 12;
const hotCaches = new WeakMap<SqlDatabase, HotCache>();

function hotProgrammes(db: SqlDatabase, ids: readonly string[], from: number, to: number): ProgrammeMap {
  const cache = hotCaches.get(db);
  const map: ProgrammeMap = {};
  if (cache === undefined) return map;
  const windows = [...cache.recent.values()].reverse();
  if (cache.first !== null) windows.push(cache.first);
  for (const window of windows) {
    if (window.from !== from || window.to !== to) continue;
    for (const id of ids) if (map[id] === undefined && window.map[id] !== undefined) map[id] = window.map[id];
  }
  return map;
}

function rememberProgrammes(db: SqlDatabase, map: ProgrammeMap, from: number, to: number, first: boolean): void {
  let cache = hotCaches.get(db);
  if (cache === undefined) {
    cache = { first: null, recent: new Map() };
    hotCaches.set(db, cache);
  }
  const window = { from, to, map };
  const key = `${from}:${to}:${Object.keys(map).join('\u0000')}`;
  cache.recent.delete(key);
  cache.recent.set(key, window);
  if (first) cache.first = window;
  while (cache.recent.size > HOT_RECENT_WINDOWS) cache.recent.delete(cache.recent.keys().next().value!);
}

export function TimelineGrid({
  session,
  channels,
  now,
  hasDialectFor,
  onFocusChannel,
  onFocusProgramme,
  onOpen,
  offsetMinutes,
  onStepTime,
  focusFirstSignal,
  active,
  returnFocusChannelId,
  onReturnFocus,
  cancelFocusRef,
}: Props) {
  const styles = useStyles(makeStyles);
  const rowNodes = useRef(new Map<string, View>());
  const focusedRow = useRef<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const focusedIdRef = useRef(focusedId);
  focusedIdRef.current = focusedId;
  const suspended = useRef(false);
  const entrySignal = useRef(focusFirstSignal);
  if (entrySignal.current !== focusFirstSignal) {
    entrySignal.current = focusFirstSignal;
    suspended.current = false;
  }
  const requestedChannel = useRef(returnFocusChannelId);
  const previousReturnChannel = useRef(returnFocusChannelId);
  if (previousReturnChannel.current !== returnFocusChannelId) {
    previousReturnChannel.current = returnFocusChannelId;
    requestedChannel.current = returnFocusChannelId;
    if (returnFocusChannelId !== null) suspended.current = false;
  }
  const activeRef = useRef(active);
  activeRef.current = active;
  const focusCleanup = useRef<(() => void) | null>(null);
  const cacheCancel = useRef<(() => void) | null>(null);
  const cacheWork = useRef<Promise<void> | null>(null);
  const metadataCancel = useRef<(() => void) | null>(null);
  const metadataWork = useRef<Promise<void> | null>(null);
  const cancelFocus = useCallback(() => {
    suspended.current = true;
    requestedChannel.current = null;
    focusedRow.current = null;
    focusCleanup.current?.();
    focusCleanup.current = null;
    cacheCancel.current?.();
    metadataCancel.current?.();
  }, []);
  if (cancelFocusRef !== undefined) cancelFocusRef.current = cancelFocus;
  useEffect(() => () => {
    cancelFocus();
    if (cancelFocusRef?.current === cancelFocus) cancelFocusRef.current = null;
  }, [cancelFocus, cancelFocusRef]);
  const [listHeight, setListHeight] = useState(0);
  const [firstVisibleIndex, setFirstVisibleIndex] = useState(0);
  const visibleRows = Math.max(1, Math.ceil(listHeight / ROW_HEIGHT));
  const visibleIndex = Math.min(firstVisibleIndex, Math.max(0, channels.length - 1));
  const pageStart = Math.floor(visibleIndex / visibleRows) * visibleRows;
  const metadataStart = Math.max(0, pageStart - visibleRows);
  const metadataEnd = Math.min(channels.length, pageStart + visibleRows * 2);
  const metadataChannels = useMemo(
    () => channels.slice(metadataStart, metadataEnd),
    [channels, metadataStart, metadataEnd],
  );
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken<StoredChannel>[] }) => {
    const first = viewableItems.find((item) => item.isViewable && item.index !== null)?.index;
    if (first !== undefined && first !== null) setFirstVisibleIndex(first);
  }).current;
  const registerRow = useCallback((id: string, node: View | null) => {
    if (node === null) rowNodes.current.delete(id);
    else rowNodes.current.set(id, node);
  }, []);

  // Vinduet: forankret til den halve time, saa kolonnerne staar paa 18:00/18:30
  // og ikke paa et skaevt minuttal. Forskydningen laegges oven paa.
  const nowMs = now.getTime();
  const anchorMs = Math.floor(nowMs / HALF_HOUR_MS) * HALF_HOUR_MS;
  const windowStartMs = anchorMs + offsetMinutes * 60_000;
  const windowEndMs = windowStartMs + WINDOW_MIN * 60_000;

  // Pil venstre/hoejre skruer paa tiden — ét tastetryk, ikke en fokusflytning.
  useTVEventHandler((event) => {
    if (!active || focusedRow.current === null) return;
    if (event.eventType !== 'right' && event.eventType !== 'left') return;
    // Reager paa tast-SLIP (action 1), ikke paa tryk-ned (0). Denne boks sender
    // KUN slip-haendelsen for pil venstre/hoejre — proevede vi at reagere paa
    // tryk-ned i stedet, skete der ingenting, og man kunne ikke skifte tid.
    // (Springer vi slip over paa en boks der sender begge, ville hvert tryk
    // ellers taelle to gange.)
    if (event.eventKeyAction !== undefined && Number(event.eventKeyAction) === 0) return;
    onStepTime(event.eventType === 'right' ? COL_MIN : -COL_MIN);
  });

  const channelIds = useMemo(() => metadataChannels.map((channel) => channel.id), [metadataChannels]);
  const viewKey = `${windowStartMs}:${windowEndMs}:${channelIds.join('\u0000')}`;
  const [cacheRevision, setCacheRevision] = useState(0);
  const [programmeState, setProgrammeState] = useState(() => ({
    db: session.db,
    key: viewKey,
    map: hotProgrammes(session.db, channelIds, windowStartMs, windowEndMs),
  }));
  const remembered = useMemo(() => hotProgrammes(
    session.db,
    [...channelIds, ...(focusedId === null ? [] : [focusedId]), ...(returnFocusChannelId === null ? [] : [returnFocusChannelId])],
    windowStartMs,
    windowEndMs,
  ), [session.db, channelIds, focusedId, returnFocusChannelId, windowStartMs, windowEndMs, programmeState]);
  const progMap = programmeState.db === session.db && programmeState.key === viewKey
    ? programmeState.map
    : remembered;

  // Vis hukommelsescachen i selve tegningen, og laes derefter kun de 90
  // synlige minutter i ét SQLite-opslag. Ingen venten paa panelets ko.
  useEffect(() => {
    if (!active || suspended.current || listHeight <= 0 || metadataChannels.length === 0) return;
    let cancelled = false;
    const stopped = () => cancelled || suspended.current || !activeRef.current;
    const cancel = () => {
      cancelled = true;
      if (cacheCancel.current === cancel) cacheCancel.current = null;
    };
    cacheCancel.current = cancel;
    const work = (async () => {
      try {
        const rows = await listProgrammesFor(session.db, channelIds, new Date(windowStartMs), new Date(windowEndMs));
        if (stopped()) return;
        const map: ProgrammeMap = {};
        for (const id of channelIds) map[id] = [];
        for (const programme of rows) map[programme.channelId]?.push(programme);
        const previous = hotProgrammes(session.db, channelIds, windowStartMs, windowEndMs);
        // Et midlertidigt tomt svar maa ikke fjerne en varm oversigt, fx mens
        // en anden EPG-opdatering udskifter rækkerne i SQLite.
        for (const id of channelIds) if (map[id]!.length === 0 && (previous[id]?.length ?? 0) > 0) map[id] = previous[id]!;
        rememberProgrammes(session.db, map, windowStartMs, windowEndMs, metadataStart === 0 && offsetMinutes === 0);
        const keep = [focusedIdRef.current, requestedChannel.current].filter((id): id is string => id !== null);
        const display = { ...hotProgrammes(session.db, keep, windowStartMs, windowEndMs), ...map };
        setProgrammeState({ db: session.db, key: viewKey, map: display });
      } catch {
        // Den varme visning bliver staaende ved en laesefejl.
      }
    })();
    cacheWork.current = work;
    void work.finally(() => {
      if (cacheWork.current === work) cacheWork.current = null;
    });
    return cancel;
  }, [active, listHeight, metadataChannels, channelIds, metadataStart, offsetMinutes, session.db, windowStartMs, windowEndMs, viewKey, focusFirstSignal, cacheRevision]);

  // Panelet opdaterer kun SQLite. Lokal visning koerer i sin egen effekt og
  // kommer ogsaa frem mens et gammelt netvaerkskald stadig er i gang.
  useEffect(() => {
    if (!active || suspended.current || listHeight <= 0 || metadataChannels.length === 0) return;
    let cancelled = false;
    const stopped = () => cancelled || suspended.current || !activeRef.current;
    const cancel = () => {
      cancelled = true;
      if (metadataCancel.current === cancel) metadataCancel.current = null;
    };
    metadataCancel.current = cancel;
    const previous = metadataWork.current;
    const localCache = cacheWork.current;
    const work = (async () => {
      try {
        // Menuen kan sende fokus tilbage foer det gamle native svar er kommet.
        // Vent paa det ene igangvaerende batch foer samme udsnit genoptages.
        if (previous !== null) await previous;
        if (localCache !== null) await localCache;
        if (stopped()) return;
        for (let start = 0; start < metadataChannels.length; start += EPG_BATCH_SIZE) {
          if (stopped()) return;
          const batch = metadataChannels.slice(start, start + EPG_BATCH_SIZE);
          await ensureEpg(session.db, session.credsBySource, session.fetchImpl, batch.map((channel) => channel.id), new Date(), GUIDE_EPG_LIMIT, { shouldContinue: () => !stopped() });
        }
        if (stopped()) return;
        setCacheRevision((revision) => revision + 1);
        for (let start = 0; start < metadataChannels.length; start += EPG_BATCH_SIZE) {
          if (stopped()) return;
          await ensureFullEpg(session.db, session.credsBySource, session.fetchImpl, metadataChannels.slice(start, start + EPG_BATCH_SIZE), new Date(), { shouldContinue: () => !stopped() });
        }
        if (stopped()) return;
        setCacheRevision((revision) => revision + 1);
      } catch {
        // Auth-/netfejl: det cachen har, staar.
      }
    })();
    metadataWork.current = work;
    void work.finally(() => {
      if (metadataWork.current === work) metadataWork.current = null;
    });
    return cancel;
  }, [active, listHeight, metadataChannels, session, anchorMs, focusFirstSignal]);

  // Rul listen saa den fokuserede raekke er synlig (som favoritterne).
  const listRef = useRef<FlatList<StoredChannel>>(null);
  // Den kanal fjernbetjeningen staar paa. Bruges til at fortaelle boksen til
  // hoejre hvilken udsendelse der beskrives — ogsaa naar man bladrer tilbage.
  const onRowFocus = useCallback(
    (channel: StoredChannel, index: number) => {
      if (!activeRef.current || suspended.current) return;
      focusedRow.current = channel.id;
      onFocusChannel(channel);
      setFocusedId(channel.id);
      if (channel.id === requestedChannel.current) {
        requestedChannel.current = null;
        onReturnFocus(true);
      }
      // Uden animation: op/ned foeles hurtigere ("saet klik-farten lidt op").
      try {
        listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
      } catch {
        // Maalet er ikke tegnet endnu; onScrollToIndexFailed haandterer det.
      }
    },
    [onFocusChannel, onReturnFocus],
  );
  const onRowBlur = useCallback((id: string) => {
    if (focusedRow.current === id) focusedRow.current = null;
  }, []);

  // Send kommandoen til den rigtige native TV-raekke. Foerste forsoeg sker
  // efter commit; gentag kort indtil onFocus bekraefter, aldrig et puls der
  // forsvinder foer Android har lagt baggrunden frem.
  useEffect(() => {
    if (!active || returnFocusChannelId === null || listHeight <= 0) return;
    if (requestedChannel.current !== returnFocusChannelId) return;
    const index = channels.findIndex((channel) => channel.id === returnFocusChannelId);
    if (index < 0) return;
    setFirstVisibleIndex(index);
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
    const request = () => {
      if (activeRef.current && requestedChannel.current === returnFocusChannelId) rowNodes.current.get(returnFocusChannelId)?.requestTVFocus();
    };
    const frame = requestAnimationFrame(request);
    const retry = setInterval(request, 150);
    const timeout = setTimeout(() => {
      clearInterval(retry);
      if (activeRef.current && requestedChannel.current === returnFocusChannelId) onReturnFocus(false);
    }, 1500);
    const stop = () => {
      cancelAnimationFrame(frame);
      clearInterval(retry);
      clearTimeout(timeout);
      if (focusCleanup.current === stop) focusCleanup.current = null;
    };
    focusCleanup.current = stop;
    return stop;
  }, [active, returnFocusChannelId, channels, listHeight, onReturnFocus]);

  // Fortael boksen til hoejre hvilken udsendelse den fokuserede kanal viser i
  // det aktuelle vindue: live naar nu er i vinduet, ellers den foerste rigtige
  // udsendelse i vinduet — praecis som raekkens "primary". Naar man bladrer
  // tilbage i tiden (offsetMinutes) skifter vinduet, saa den ogsaa skifter.
  useEffect(() => {
    if (!active || onFocusProgramme === undefined) return;
    if (focusedId === null) {
      onFocusProgramme(null);
      return;
    }
    const cells = layoutRow(progMap[focusedId] ?? EMPTY, new Date(windowStartMs), new Date(windowEndMs), new Date(nowMs));
    const primary =
      cells.find((c) => c.state === 'live')?.programme ?? cells.find((c) => c.programme !== null)?.programme ?? null;
    onFocusProgramme(primary);
  }, [active, onFocusProgramme, focusedId, progMap, windowStartMs, windowEndMs, nowMs]);

  // Fokuser foerste raekke naar guiden aabnes / menuen sender fokus ind.
  const [focusPulse, setFocusPulse] = useState(true);
  const seenSignal = useRef(focusFirstSignal);
  useEffect(() => {
    if (focusFirstSignal === seenSignal.current) return;
    seenSignal.current = focusFirstSignal;
    listRef.current?.scrollToIndex({ index: 0, viewPosition: 0, animated: false });
    setFocusPulse(true);
  }, [focusFirstSignal]);
  useEffect(() => {
    if (!focusPulse || !active || listHeight <= 0 || channels.length === 0) return;
    const f = requestAnimationFrame(() => setFocusPulse(false));
    return () => cancelAnimationFrame(f);
  }, [focusPulse, active, listHeight, channels.length]);

  const renderItem = useCallback(
    ({ item, index }: { item: StoredChannel; index: number }) => (
      <ChannelRow
        channel={item}
        programmes={progMap[item.id] ?? EMPTY}
        windowStartMs={windowStartMs}
        windowEndMs={windowEndMs}
        nowMs={nowMs}
        hasDialect={hasDialectFor(item)}
        index={index}
        focusPulse={active && !suspended.current && (item.id === returnFocusChannelId || (returnFocusChannelId === null && index === 0 && focusPulse))}
        registerRow={registerRow}
        onFocusRow={onRowFocus}
        onBlurRow={onRowBlur}
        onOpen={onOpen}
      />
    ),
    [progMap, windowStartMs, windowEndMs, nowMs, hasDialectFor, focusPulse, active, returnFocusChannelId, registerRow, onRowFocus, onRowBlur, onOpen],
  );

  return (
    <View style={styles.root}>
      {/* Tidshovedet: kolonnernes klokkeslaet, saa man altid kan se hvor i tiden
          man er (ogsaa naar man koerer tilbage). Dagen staar med, naar vinduet
          ikke er i dag. */}
      <View style={styles.header}>
        <View style={styles.headerChannel}>
          {/* Uret er fjernet her: det store ur staar nu ved preview. Kun dagen
              vises, naar man har bladret vaek fra nu. */}
          {!sameDay(new Date(windowStartMs), now) && (
            <Text style={styles.headerWindowDay} numberOfLines={1}>
              {dayName(new Date(windowStartMs))}
            </Text>
          )}
        </View>
        {Array.from({ length: COLS }, (_, i) => (
          <Text key={i} style={styles.headerCol} numberOfLines={1}>
            {clock(new Date(windowStartMs + i * HALF_HOUR_MS))}
          </Text>
        ))}
      </View>
      {/* Fang fokus til siderne: pil venstre/hoejre skruer paa tiden (ovenfor) og
          maa ikke slippe ud i menuen. Op fra oeverste raekke naar gruppe-chipsene;
          ned er almindelig listenavigation. */}
      <TVFocusGuideView
        style={styles.list}
        trapFocusLeft
        trapFocusRight
        onLayout={({ nativeEvent: { layout } }) => setListHeight(layout.height)}
      >
        {listHeight > 0 && (
        <FlatList
          style={{ height: listHeight }}
          ref={listRef}
          data={channels}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          removeClippedSubviews={false}
          initialNumToRender={visibleRows + 2}
          windowSize={LIST_WINDOW_SIZE}
          maxToRenderPerBatch={visibleRows + 2}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY_CONFIG}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          onScrollToIndexFailed={() => undefined}
          contentContainerStyle={{ paddingBottom: ROW_HEIGHT * 4 }}
        />
        )}
      </TVFocusGuideView>
    </View>
  );
}

const EMPTY: Programme[] = [];

const ChannelRow = memo(function ChannelRow({
  channel,
  programmes,
  windowStartMs,
  windowEndMs,
  nowMs,
  hasDialect,
  index,
  focusPulse,
  registerRow,
  onFocusRow,
  onBlurRow,
  onOpen,
}: {
  channel: StoredChannel;
  programmes: readonly Programme[];
  windowStartMs: number;
  windowEndMs: number;
  nowMs: number;
  hasDialect: boolean;
  index: number;
  focusPulse: boolean;
  registerRow: (id: string, node: View | null) => void;
  onFocusRow: (channel: StoredChannel, index: number) => void;
  onBlurRow: (id: string) => void;
  onOpen: (channel: StoredChannel, programme: Programme | null, state: CellState) => void;
}) {
  const styles = useStyles(makeStyles);
  const rowRef = useCallback((node: View | null) => registerRow(channel.id, node), [channel.id, registerRow]);
  const cells = useMemo(
    () => layoutRow(programmes, new Date(windowStartMs), new Date(windowEndMs), new Date(nowMs)),
    [programmes, windowStartMs, windowEndMs, nowMs],
  );
  // OK / previewet knytter sig til én udsendelse: den der sender nu hvis nu er i
  // vinduet, ellers den foerste rigtige udsendelse i vinduet.
  const primary = useMemo(
    () => cells.find((c) => c.state === 'live') ?? cells.find((c) => c.programme !== null) ?? null,
    [cells],
  );
  // Roed nu-linje: kun naar nu er inde i vinduet.
  const nowRatio = nowMs >= windowStartMs && nowMs < windowEndMs ? (nowMs - windowStartMs) / (windowEndMs - windowStartMs) : null;

  return (
    <TvPressable
      ref={rowRef}
      style={styles.row}
      flat
      hasTVPreferredFocus={focusPulse}
      onFocus={() => onFocusRow(channel, index)}
      onBlur={() => onBlurRow(channel.id)}
      onPress={() => onOpen(channel, primary?.programme ?? null, primary?.state ?? 'gap')}
    >
      <View style={styles.channelCell}>
        <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={28} />
        <View style={styles.channelText}>
          <Text style={styles.channelName} numberOfLines={2}>
            {channel.name}
          </Text>
          {hasDialect && channel.hasArchive && <Text style={styles.badge}>⏱</Text>}
        </View>
      </View>
      <View style={styles.strip}>
        {cells.map((cell, i) => {
          // Live-forloeb: hvor langt udsendelsen er naaet (Tablos blaa streg).
          const livePct =
            cell.state === 'live' && cell.programme
              ? Math.max(
                  4,
                  Math.min(
                    100,
                    ((nowMs - cell.programme.start.getTime()) /
                      (cell.programme.stop.getTime() - cell.programme.start.getTime())) *
                      100,
                  ),
                )
              : 0;
          return (
            <View
              key={`${cell.key}-${i}`}
              style={[
                styles.cell,
                { flexGrow: cell.weight, flexShrink: cell.weight, flexBasis: 0 },
                cell.state === 'past' && styles.cellPast,
              ]}
            >
              {cell.programme !== null && cell.weight >= 8 && (
                <>
                  <Text style={styles.cellTime} numberOfLines={1}>
                    {cell.clippedStart ? '‹ ' : ''}
                    {clock(cell.programme.start)}
                    {guideAction(cell, channel, hasDialect) === 'restart' ? ' ▶' : ''}
                  </Text>
                  <Text style={styles.cellTitle} numberOfLines={2}>
                    {cell.programme.title}
                  </Text>
                </>
              )}
              {cell.programme === null && cell.weight >= 20 && (
                <Text style={styles.cellMuted} numberOfLines={1}>
                  Ingen oversigt
                </Text>
              )}
              {/* Live: tynd blaa streg under, fyldt saa langt udsendelsen er naaet. */}
              {cell.state === 'live' && (
                <View style={styles.progWrap} pointerEvents="none">
                  <View style={styles.progTrack} />
                  <View style={[styles.progFill, { width: `${livePct}%` }]} />
                </View>
              )}
              {/* Ikke-live, men det OK aabner (naar man bladrer frem uden noget live
                  i vinduet): en enkel blaa streg under, saa man kan se hvad OK rammer. */}
              {cell.state !== 'live' && cell === primary && cell.programme !== null && (
                <View style={styles.okUnderline} pointerEvents="none" />
              )}
            </View>
          );
        })}
        {nowRatio !== null && <View pointerEvents="none" style={[styles.nowLine, { left: `${nowRatio * 100}%` }]} />}
      </View>
    </TvPressable>
  );
});

/** Klokkeslaet som HH:MM. */
function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const WEEKDAYS = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
function dayName(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  header: { flexDirection: 'row', height: HEADER_HEIGHT, alignItems: 'center', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  headerChannel: { width: CHANNEL_COL, justifyContent: 'center', paddingLeft: 6 },
  headerWindowDay: { color: colors.accent, fontSize: 10, fontWeight: '600', marginTop: 1 },
  headerCol: { flex: 1, color: colors.textMuted, fontSize: 12, fontWeight: '600', paddingLeft: 4 },
  row: { flexDirection: 'row', height: ROW_HEIGHT, alignItems: 'stretch' },
  channelCell: { width: CHANNEL_COL, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6, borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  channelText: { flex: 1 },
  channelName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  badge: { color: colors.accent, fontSize: 12 },
  strip: { flex: 1, flexDirection: 'row', borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
  cell: {
    justifyContent: 'center',
    paddingHorizontal: 8,
    marginVertical: 3,
    marginRight: 2,
    borderRadius: theme.radius,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cellPast: { opacity: 0.5 },
  // Live-forloeb: en tynd blaa streg under, fyldt saa langt udsendelsen er
  // naaet (som Tablos). Svag blaa baggrund + massiv blaa fyld ovenpaa.
  progWrap: { position: 'absolute', left: 8, right: 8, bottom: 4, height: 3 },
  progTrack: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: colors.accent, opacity: 0.22 },
  progFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 2, backgroundColor: colors.accent },
  // Det OK aabner naar man bladrer frem uden noget live i vinduet: enkel blaa streg.
  okUnderline: { position: 'absolute', left: 8, right: 8, bottom: 4, height: 3, borderRadius: 2, backgroundColor: colors.accent, opacity: 0.7 },
  cellTime: { color: colors.textMuted, fontSize: 11, fontWeight: '700', marginBottom: 1 },
  cellTitle: { color: colors.text, fontSize: 12 },
  cellMuted: { color: colors.textMuted, fontSize: 11, fontStyle: 'italic' },
  nowLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.danger },
});
