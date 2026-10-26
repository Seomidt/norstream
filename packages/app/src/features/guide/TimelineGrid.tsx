import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, StyleSheet, Text, TVFocusGuideView, View, useTVEventHandler } from 'react-native';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { SqlDatabase } from '../../storage/types.js';
import type { StoredChannel } from '../../storage/channels.js';
import { listProgrammes } from '../../storage/programmes.js';
import { ensureEpg, ensureFullEpg } from '../../sync/epgCache.js';
import { syncPanelEpg } from '../../sync/panelEpg.js';
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
 * gitteret glider med. Det gemte tegnes med det samme (v423); synlige kanaler
 * fornys i baggrunden, kun naar hentereglerne siger at de er gamle.
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
const HALF_HOUR_MS = COL_MIN * 60_000;
const VISIBLE_BATCH = 12;
const VIEWABILITY = { itemVisiblePercentThreshold: 1 };

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
}

type ProgrammeMap = Record<string, Programme[]>;

/**
 * Det sidst viste programkort pr. database (v423). Guiden aabner med det med
 * det samme, og SQL tegner straks det gemte ovenpaa uden at vente paa panelet.
 * I v421-v422 blev intet genbrugt: hver aabning ventede paa ét HTTP-kald pr.
 * synlig kanal gennem panelets ene forbindelse ("staar og henter hver gang").
 */
const lastDrawn = new WeakMap<SqlDatabase, ProgrammeMap>();
/** Hvor meget ud over vinduet der laeses fra SQL, saa et piltryk har data klar. */
const DRAW_MARGIN_MS = 3 * 60 * 60_000;
/** Nu/naeste: faa programmer, hurtigt svar. Den fulde tabel daekker resten. */
const SHORT_EPG_LIMIT = 12;

/**
 * Ét guidebesoegs fornyelse. Hvad der skal hentes, afgoer hentereglerne i
 * `storage/epgFetch.ts` (alder, slut-program og skift mellem sommer- og
 * vintertid); guiden spoerger kun én gang pr. kanal og halve time.
 */
interface RefreshRun {
  cancelled: boolean;
  short: Set<string>;
  full: Set<string>;
  xmlSources: Set<string>;
  /** Kanaler hvor fornyelsen er faerdig, med eller uden nye data. */
  done: Set<string>;
  /** Kanaler hvor panelet ikke svarede. Vises kun hvis der heller intet er gemt. */
  failed: Set<string>;
  /** Kanaler hvor panelets API svarede tomt: kandidater til XMLTV-filen. */
  emptyApi: Set<string>;
}
function newRun(): RefreshRun {
  return {cancelled:false, short:new Set(), full:new Set(), xmlSources:new Set(), done:new Set(), failed:new Set(), emptyApi:new Set()};
}
// Kun igangvaerende arbejde serialiseres, saa to guidebesoeg aldrig spoerger
// panelet samtidig. Selve programmerne ligger i SQL og i lastDrawn.
const activeWork = new WeakMap<SqlDatabase, Promise<void>>();
function enqueueGuideWork(db: SqlDatabase, work: () => Promise<void>): void {
  const operation = (activeWork.get(db) ?? Promise.resolve()).then(work);
  const settled = operation.catch(() => undefined);
  activeWork.set(db, settled);
  void settled.then(() => { if (activeWork.get(db) === settled) activeWork.delete(db); });
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
}: Props) {
  const styles = useStyles(makeStyles);
  const rowNodes = useRef(new Map<string, View>());
  const focusedRow = useRef<string | null>(null);
  const requestedChannel = useRef(returnFocusChannelId);
  requestedChannel.current = returnFocusChannelId;
  const [listHeight, setListHeight] = useState(0);
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

  const channelsKey = useMemo(() => channels.map(channel => channel.id).join('\u0000'), [channels]);
  const [foreground, setForeground] = useState(() => AppState.currentState === null || AppState.currentState === 'active');
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active' && runRef.current !== null) runRef.current.cancelled = true;
      setForeground(state === 'active');
    });
    return () => listener.remove();
  }, []);
  const [visibleStart, setVisibleStart] = useState(() => Math.max(0, channels.findIndex(channel => channel.id === returnFocusChannelId)));
  const metadataStart = Math.min(visibleStart, Math.max(0, channels.length - 1));
  const visibleChannels = useMemo(() => channels.slice(metadataStart, metadataStart + VISIBLE_BATCH), [channels, metadataStart]);
  const visibleKey = visibleChannels.map(channel => channel.id).join('\u0000');
  const visibleIds = useRef(new Set<string>());
  visibleIds.current = new Set(visibleChannels.map(channel => channel.id));

  // Det gemte vises straks: foerst det sidst viste kort, saa SQL for vinduet.
  const [progMap, setProgMap] = useState<ProgrammeMap>(() => lastDrawn.get(session.db) ?? {});
  const [revision, setRevision] = useState(0);
  const bump = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (visibleChannels.length === 0) return;
    let cancelled = false;
    const from = new Date(windowStartMs - DRAW_MARGIN_MS);
    const to = new Date(windowEndMs + DRAW_MARGIN_MS);
    const shown = visibleChannels;
    void Promise.all(shown.map(channel => listProgrammes(session.db, channel.id, from, to))).then(found => {
      if (cancelled) return;
      setProgMap(previous => {
        const next: ProgrammeMap = {...previous};
        shown.forEach((channel, index) => { next[channel.id] = found[index] ?? []; });
        lastDrawn.set(session.db, next);
        return next;
      });
    }).catch(() => { /* En lokal laesefejl: det der allerede staar, bliver staaende. */ });
    return () => { cancelled = true; };
  }, [session.db, visibleKey, windowStartMs, windowEndMs, revision]);

  // Fornyelse i baggrunden: synlige kanaler, kun det der er gammelt. En ny
  // runde hver halve time (anchorMs), naar appen kommer frem igen, og ved
  // nyt kanalsaet. Hentereglerne afgoer om der overhovedet spoerges.
  const runRef = useRef<RefreshRun | null>(null);
  const [run, setRun] = useState<RefreshRun | null>(null);
  useEffect(() => {
    if (!active || !foreground) return;
    const next = newRun();
    runRef.current = next;
    setRun(next);
    return () => { next.cancelled = true; if (runRef.current === next) runRef.current = null; };
  }, [active, foreground, session, channelsKey, anchorMs]);

  useEffect(() => {
    if (run === null || run.cancelled || runRef.current !== run) return;
    const isCurrent = (): boolean => !run.cancelled && runRef.current === run;
    const wanted = (id: string): boolean => isCurrent() && visibleIds.current.has(id);
    const db = session.db;
    const api: StoredChannel[] = [];
    for (const channel of visibleChannels) {
      const access = session.access?.(channel.sourceId);
      const isM3u = access?.source.kind === 'm3u' || channel.streamUrl != null;
      // M3U har ingen EPG-API; dens oversigt er importeret og ligger i SQL.
      if (isM3u || !session.credsBySource.has(channel.sourceId)) run.done.add(channel.id);
      else api.push(channel);
    }
    enqueueGuideWork(db, async () => {
      // 1. Nu/naeste for de synlige. Springes over naar den fulde tabel er frisk.
      for (const channel of api) {
        if (!wanted(channel.id) || run.short.has(channel.id)) continue;
        run.short.add(channel.id);
        try {
          const result = await ensureEpg(db, session.credsBySource, session.fetchImpl, [channel.id], new Date(), SHORT_EPG_LIMIT, {
            shouldContinue: () => wanted(channel.id),
          });
          if (!isCurrent()) return;
          if (result.failed > 0) run.failed.add(channel.id);
          if (result.fetched > 0) bump();
        } catch {
          if (!isCurrent()) return;
          run.failed.add(channel.id);
        }
      }
      // 2. Hele tabellen (fortid og resten af ugen) for de samme kanaler.
      for (const channel of api) {
        if (!wanted(channel.id) || run.full.has(channel.id)) continue;
        run.full.add(channel.id);
        try {
          const result = await ensureFullEpg(db, session.credsBySource, session.fetchImpl, [channel], new Date(), {
            shouldContinue: () => wanted(channel.id),
          });
          if (!isCurrent()) return;
          if (result.failed > 0) run.failed.add(channel.id);
          else if (result.fetched > 0) run.failed.delete(channel.id);
          if (result.fetched > 0 && result.programmes === 0) run.emptyApi.add(channel.id);
        } catch {
          if (!isCurrent()) return;
          run.failed.add(channel.id);
        }
        run.done.add(channel.id);
        bump();
      }
      // 3. Kanaler uden API-oversigt: panelets XMLTV-fil, én gang pr. kilde.
      // Den store fil venter til alle API-svar er tegnet. syncPanelEpg har
      // selv sin doegnregel og henter kun hvis der er noget nyt at matche.
      const bySource = new Map<string, string[]>();
      for (const channel of api) {
        if (!run.emptyApi.has(channel.id) || run.xmlSources.has(channel.sourceId)) continue;
        const ids = bySource.get(channel.sourceId) ?? [];
        ids.push(channel.id);
        bySource.set(channel.sourceId, ids);
      }
      for (const [sourceId, ids] of bySource) {
        if (!isCurrent()) return;
        run.xmlSources.add(sourceId);
        const creds = session.credsBySource.get(sourceId);
        if (creds === undefined) continue;
        try {
          const file = await syncPanelEpg(db, sourceId, creds, {channelIds: ids, shouldContinue: isCurrent});
          if (!isCurrent()) return;
          if (file !== null && file.programmes > 0) bump();
        } catch {
          // Filen er en reserve; API-svaret (eller det gemte) staar.
        }
      }
    });
    // visibleKey daekker visibleChannels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, visibleKey, session, bump]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: Array<{index: number | null}> }) => {
    const indexes = viewableItems.map(item => item.index).filter((index): index is number => index !== null);
    if (indexes.length > 0) setVisibleStart(Math.max(0, Math.min(...indexes)));
  }, []);

  // Rul listen saa den fokuserede raekke er synlig (som favoritterne).
  const listRef = useRef<FlatList<StoredChannel>>(null);
  // Den kanal fjernbetjeningen staar paa. Bruges til at fortaelle boksen til
  // hoejre hvilken udsendelse der beskrives — ogsaa naar man bladrer tilbage.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const onRowFocus = useCallback(
    (channel: StoredChannel, index: number) => {
      focusedRow.current = channel.id;
      onFocusChannel(channel);
      setFocusedId(channel.id);
      if (!visibleIds.current.has(channel.id)) setVisibleStart(index);
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
    const index = channels.findIndex((channel) => channel.id === returnFocusChannelId);
    if (index < 0) return;
    setVisibleStart(index);
    listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
    const request = () => {
      if (requestedChannel.current === returnFocusChannelId) rowNodes.current.get(returnFocusChannelId)?.requestTVFocus();
    };
    const frame = requestAnimationFrame(request);
    const retry = setInterval(request, 150);
    const timeout = setTimeout(() => {
      clearInterval(retry);
      if (requestedChannel.current === returnFocusChannelId) onReturnFocus(false);
    }, 1500);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(retry);
      clearTimeout(timeout);
    };
  }, [active, returnFocusChannelId, channels, listHeight, onReturnFocus]);

  // Fortael boksen til hoejre hvilken udsendelse den fokuserede kanal viser i
  // det aktuelle vindue: live naar nu er i vinduet, ellers den foerste rigtige
  // udsendelse i vinduet — praecis som raekkens "primary". Naar man bladrer
  // tilbage i tiden (offsetMinutes) skifter vinduet, saa den ogsaa skifter.
  useEffect(() => {
    if (onFocusProgramme === undefined) return;
    if (focusedId === null) {
      onFocusProgramme(null);
      return;
    }
    const cells = layoutRow(progMap[focusedId] ?? EMPTY, new Date(windowStartMs), new Date(windowEndMs), new Date(nowMs));
    const primary =
      cells.find((c) => c.state === 'live')?.programme ?? cells.find((c) => c.programme !== null)?.programme ?? null;
    onFocusProgramme(primary);
  }, [onFocusProgramme, focusedId, progMap, windowStartMs, windowEndMs, nowMs]);

  // Fokuser foerste raekke naar guiden aabnes / menuen sender fokus ind.
  const [focusPulse, setFocusPulse] = useState(true);
  const seenSignal = useRef(focusFirstSignal);
  useEffect(() => {
    if (focusFirstSignal === seenSignal.current) return;
    seenSignal.current = focusFirstSignal;
    setFocusPulse(true);
  }, [focusFirstSignal]);
  useEffect(() => {
    if (!focusPulse) return;
    const f = requestAnimationFrame(() => setFocusPulse(false));
    return () => cancelAnimationFrame(f);
  }, [focusPulse]);

  const renderItem = useCallback(
    ({ item, index }: { item: StoredChannel; index: number }) => (
      <ChannelRow
        channel={item}
        programmes={progMap[item.id] ?? EMPTY}
        loading={rowEmpty(progMap[item.id], windowStartMs, windowEndMs) && run?.done.has(item.id) !== true && run?.failed.has(item.id) !== true}
        failed={rowEmpty(progMap[item.id], windowStartMs, windowEndMs) && run?.failed.has(item.id) === true}
        windowStartMs={windowStartMs}
        windowEndMs={windowEndMs}
        nowMs={nowMs}
        hasDialect={hasDialectFor(item)}
        index={index}
        focusPulse={active && (item.id === returnFocusChannelId || (returnFocusChannelId === null && index === 0 && focusPulse))}
        registerRow={registerRow}
        onFocusRow={onRowFocus}
        onBlurRow={onRowBlur}
        onOpen={onOpen}
      />
    ),
    [progMap, run, revision, windowStartMs, windowEndMs, nowMs, hasDialectFor, focusPulse, active, returnFocusChannelId, registerRow, onRowFocus, onRowBlur, onOpen],
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
          initialNumToRender={VISIBLE_BATCH}
          windowSize={5}
          maxToRenderPerBatch={VISIBLE_BATCH}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={VIEWABILITY}
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

/** Ingen gemte programmer i vinduet. Kun da maa raekken sige "Henter" eller "kunne ikke". */
function rowEmpty(programmes: readonly Programme[] | undefined, fromMs: number, toMs: number): boolean {
  return programmes === undefined || !programmes.some(p => p.stop.getTime() > fromMs && p.start.getTime() < toMs);
}

const ChannelRow = memo(function ChannelRow({
  channel,
  programmes,
  loading,
  failed,
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
  loading: boolean;
  failed: boolean;
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
        {(loading || failed) && <Text style={styles.refreshMessage}>{failed ? 'Programoversigten kunne ikke hentes.' : 'Henter programoversigt …'}</Text>}
        {!loading && !failed && cells.map((cell, i) => {
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
              style={{ width: `${cell.weight * 60_000 / (windowEndMs - windowStartMs) * 100}%`, overflow: 'hidden' }}
            >
              <View style={[styles.cell, cell.state === 'past' && styles.cellPast]}>
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
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
    marginVertical: 3,
    marginRight: 2,
    borderRadius: theme.radius,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  refreshMessage: { color: colors.textMuted, fontSize: 12, alignSelf:'center', paddingHorizontal:8 },
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
