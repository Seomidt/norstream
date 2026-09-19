import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, TVFocusGuideView, View, useTVEventHandler } from 'react-native';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { listProgrammes } from '../../storage/programmes.js';
import { ensureEpg, ensureFullEpg } from '../../sync/epgCache.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { DRAG_MAX_MINUTES, DRAG_MIN_MINUTES, guideAction, layoutRow } from './layout.js';
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
 * gitteret glider med. Fordi programdata hentes ÉN gang og vinduet blot
 * forskydes lokalt (ren layout-regning), foeles det ikke laengere som
 * slowmotion, og der er ingen ny hentning per tryk.
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
const HEADER_HEIGHT = 26;
/**
 * Hvor langt tilbage/frem der hentes programdata til striben. Skal daekke hele
 * det spaend man kan bladre i (samme som traekkets graenser: 7 dage hver vej —
 * arkivet bagud, oversigten fremad). Var foer kun 6 timer tilbage, saa man
 * ramte en mur efter en aften; nu naar man lige saa langt tilbage som arkivet.
 */
const SPAN_BACK_MIN = -DRAG_MIN_MINUTES;
const SPAN_FWD_MIN = DRAG_MAX_MINUTES;
const HALF_HOUR_MS = COL_MIN * 60_000;

interface Props {
  session: AppSession;
  channels: StoredChannel[];
  now: Date;
  hasDialectFor: (channel: StoredChannel) => boolean;
  /** Kaldes naar fjernbetjeningen staar paa en kanal — previewet foelger. */
  onFocusChannel: (channel: StoredChannel) => void;
  /** Aabner programbladet (eller kanalen paa et hul). */
  onOpen: (channel: StoredChannel, programme: Programme | null, state: CellState) => void;
  /** Delt tidsforskydning i minutter (0 = nu). Deles med telefon-guiden. */
  offsetMinutes: number;
  /** Skru paa tiden (pil venstre/hoejre). Klemmes i GuideScreen. */
  onStepTime: (deltaMin: number) => void;
  /** Pil hoejre fra menuen: den foerste raekke faar fokus. */
  focusFirstSignal: number;
}

export function TimelineGrid({
  session,
  channels,
  now,
  hasDialectFor,
  onFocusChannel,
  onOpen,
  offsetMinutes,
  onStepTime,
  focusFirstSignal,
}: Props) {
  const styles = useStyles(makeStyles);

  // Vinduet: forankret til den halve time, saa kolonnerne staar paa 18:00/18:30
  // og ikke paa et skaevt minuttal. Forskydningen laegges oven paa.
  const nowMs = now.getTime();
  const anchorMs = Math.floor(nowMs / HALF_HOUR_MS) * HALF_HOUR_MS;
  const windowStartMs = anchorMs + offsetMinutes * 60_000;
  const windowEndMs = windowStartMs + WINDOW_MIN * 60_000;

  // Pil venstre/hoejre skruer paa tiden — ét tastetryk, ikke en fokusflytning.
  useTVEventHandler((event) => {
    if (event.eventType !== 'right' && event.eventType !== 'left') return;
    // Reager paa tast-SLIP (action 1), ikke paa tryk-ned (0). Denne boks sender
    // KUN slip-haendelsen for pil venstre/hoejre — proevede vi at reagere paa
    // tryk-ned i stedet, skete der ingenting, og man kunne ikke skifte tid.
    // (Springer vi slip over paa en boks der sender begge, ville hvert tryk
    // ellers taelle to gange.)
    if (event.eventKeyAction !== undefined && Number(event.eventKeyAction) === 0) return;
    onStepTime(event.eventType === 'right' ? COL_MIN : -COL_MIN);
  });

  // Programdata for HELE spanet, hentet én gang. Vinduet forskydes derefter kun
  // lokalt (layoutRow), saa der ikke hentes ved hvert tidsskridt.
  const spanStartMs = anchorMs - SPAN_BACK_MIN * 60_000;
  const spanEndMs = anchorMs + SPAN_FWD_MIN * 60_000;
  const [progMap, setProgMap] = useState<Record<string, Programme[]>>({});
  const draw = useCallback(async () => {
    if (channels.length === 0) return;
    const from = new Date(spanStartMs);
    const to = new Date(spanEndMs);
    const found = await Promise.all(channels.map((c) => listProgrammes(session.db, c.id, from, to)));
    const map: Record<string, Programme[]> = {};
    channels.forEach((c, i) => {
      map[c.id] = found[i] ?? [];
    });
    setProgMap(map);
  }, [channels, session.db, spanStartMs, spanEndMs]);

  // Cachen foerst (hurtigt), saa nu/naeste fra panelet, saa den fulde tabel i
  // baggrunden. Guiden staar aldrig tom mens der hentes.
  useEffect(() => {
    void draw();
  }, [draw]);
  useEffect(() => {
    if (channels.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureEpg(session.db, session.credsBySource, session.fetchImpl, channels.map((c) => c.id));
        if (!cancelled) void draw();
        await ensureFullEpg(session.db, session.credsBySource, session.fetchImpl, channels);
      } catch {
        // Auth-/netfejl: det cachen har, staar.
      }
      if (!cancelled) void draw();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, session]);

  // Rul listen saa den fokuserede raekke er synlig (som favoritterne).
  const listRef = useRef<FlatList<StoredChannel>>(null);
  const onRowFocus = useCallback(
    (channel: StoredChannel, index: number) => {
      onFocusChannel(channel);
      // Uden animation: op/ned foeles hurtigere ("saet klik-farten lidt op").
      try {
        listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
      } catch {
        // Maalet er ikke tegnet endnu; onScrollToIndexFailed haandterer det.
      }
    },
    [onFocusChannel],
  );

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
        windowStartMs={windowStartMs}
        windowEndMs={windowEndMs}
        nowMs={nowMs}
        hasDialect={hasDialectFor(item)}
        index={index}
        focusPulse={index === 0 && focusPulse}
        onFocusRow={onRowFocus}
        onOpen={onOpen}
      />
    ),
    [progMap, windowStartMs, windowEndMs, nowMs, hasDialectFor, focusPulse, onRowFocus, onOpen],
  );

  return (
    <View style={styles.root}>
      {/* Tidshovedet: kolonnernes klokkeslaet, saa man altid kan se hvor i tiden
          man er (ogsaa naar man koerer tilbage). Dagen staar med, naar vinduet
          ikke er i dag. */}
      <View style={styles.header}>
        <View style={styles.headerChannel}>
          <Text style={styles.headerDay} numberOfLines={1}>
            {sameDay(new Date(windowStartMs), now) ? (offsetMinutes === 0 ? '● NU' : 'I dag') : dayName(new Date(windowStartMs))}
          </Text>
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
      <TVFocusGuideView style={styles.list} trapFocusLeft trapFocusRight>
        <FlatList
          ref={listRef}
          data={channels}
          keyExtractor={(c) => c.id}
          renderItem={renderItem}
          removeClippedSubviews={false}
          initialNumToRender={Math.max(12, channels.length)}
          windowSize={Math.max(11, channels.length + 2)}
          maxToRenderPerBatch={Math.max(12, channels.length)}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          onScrollToIndexFailed={() => undefined}
          contentContainerStyle={{ paddingBottom: ROW_HEIGHT * 4 }}
        />
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
  onFocusRow,
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
  onFocusRow: (channel: StoredChannel, index: number) => void;
  onOpen: (channel: StoredChannel, programme: Programme | null, state: CellState) => void;
}) {
  const styles = useStyles(makeStyles);
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
      style={styles.row}
      flat
      hasTVPreferredFocus={focusPulse}
      onFocus={() => onFocusRow(channel, index)}
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
  headerChannel: { width: CHANNEL_COL, justifyContent: 'center' },
  headerDay: { color: colors.danger, fontSize: 12, fontWeight: '700', paddingLeft: 6 },
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
