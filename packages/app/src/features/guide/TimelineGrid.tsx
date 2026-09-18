import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, StyleSheet, Text, View } from 'react-native';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { listProgrammes } from '../../storage/programmes.js';
import { ensureFullEpg } from '../../sync/epgCache.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { stateOf } from './layout.js';
import type { CellState } from './layout.js';

/**
 * Guiden som EN sammenhaengende, glidende tidslinje (som Googles/Xumos).
 *
 * Kanaler lodret, tid vandret. Cellerne sidder paa deres RIGTIGE klokkeslaet
 * (bredde = varighed i minutter gange faste pixels), saa cellen lige nedenunder
 * er den samme tid — op/ned rammer derfor rent, uden det gamle spring. Vandret
 * flyttes tiden ikke i faste vinduer; markoeren glider mellem udsendelser, og
 * hele fladen ruller BLOEDT med (Animated translateX), saa det ikke hopper.
 *
 * Én delt `scrollX` for alle raekker: naar en celle faar fokus, glider fladen,
 * saa cellen staar ved et fast punkt til venstre. Fordi alle raekker deler
 * samme scrollX og cellerne staar paa tid, flugter kolonnerne — og den roede
 * nu-linje glider med.
 */

/** Pixels per minut. Mindre = mindre celler, mere tid synligt. 1 time = 168 px. */
const PX_PER_MIN = 2.8;
/** Hvor langt tilbage/frem tidslinjen raekker fra den runde time. */
const SPAN_BACK_MIN = 120;
const SPAN_FWD_MIN = 20 * 60;
const ROW_HEIGHT = 52;
const CHANNEL_COL = 112;
const HEADER_HEIGHT = 30;
/** Hvor cellen der faar fokus lander (px fra tidslinjens venstre kant). */
const ANCHOR = 40;

interface Props {
  session: AppSession;
  channels: StoredChannel[];
  now: Date;
  hasDialectFor: (channel: StoredChannel) => boolean;
  /** Kaldes naar fjernbetjeningen staar paa en kanal — previewet foelger. */
  onFocusChannel: (channel: StoredChannel) => void;
  /** Aabner programbladet (eller kanalen paa et hul). */
  onOpen: (channel: StoredChannel, programme: Programme | null, state: CellState) => void;
  /** Pil hoejre fra menuen: den foerste raekkes nu-udsendelse faar fokus. */
  focusFirstSignal: number;
}

export function TimelineGrid({
  session,
  channels,
  now,
  hasDialectFor,
  onFocusChannel,
  onOpen,
  focusFirstSignal,
}: Props) {
  const styles = useStyles(makeStyles);

  // Tidslinjens start er den runde time minus lidt fortid, saa timerne staar
  // paent i hovedet. Bucket paa timen, saa den ikke regnes om hvert minut.
  const hourBucket = Math.floor(now.getTime() / 3_600_000);
  const spanStartMs = useMemo(() => hourBucket * 3_600_000 - SPAN_BACK_MIN * 60_000, [hourBucket]);
  const spanMinutes = SPAN_BACK_MIN + SPAN_FWD_MIN;
  const spanWidth = spanMinutes * PX_PER_MIN;
  const spanEndMs = spanStartMs + spanMinutes * 60_000;
  const nowX = ((now.getTime() - spanStartMs) / 60_000) * PX_PER_MIN;

  const [progMap, setProgMap] = useState<Record<string, Programme[]>>({});
  // Fyld programdata for HELE spanet (ikke pr. vindue): saa forsvinder intet
  // naar man glider frem og tilbage. Foerst det der ligger i den lokale
  // database, saa en baggrundshentning der fylder resten paa.
  const load = useCallback(async () => {
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

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await ensureFullEpg(session.db, session.credsBySource, session.fetchImpl, channels);
      } catch {
        // Auth-/netfejl: det der ligger i cachen staar.
      }
      if (!cancelled) void load();
    })();
    return () => {
      cancelled = true;
    };
  }, [channels, session, load]);

  // Delt vandret rul. Native driver: translateX koerer paa GPU, glat.
  const scrollX = useRef(new Animated.Value(0)).current;
  const [stripWidth, setStripWidth] = useState(0);
  const maxScroll = Math.max(0, spanWidth - stripWidth);
  const maxScrollRef = useRef(maxScroll);
  maxScrollRef.current = maxScroll;

  const glideTo = useCallback(
    (left: number) => {
      const target = Math.min(Math.max(0, left - ANCHOR), maxScrollRef.current);
      Animated.timing(scrollX, { toValue: target, duration: 240, useNativeDriver: true }).start();
    },
    [scrollX],
  );

  // Foerste gang (og naar bredden kendes): stil tidslinjen saa NU staar til
  // venstre, uden animation.
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current || stripWidth === 0) return;
    didInit.current = true;
    const target = Math.min(Math.max(0, nowX - ANCHOR), maxScroll);
    scrollX.setValue(target);
  }, [stripWidth, nowX, maxScroll, scrollX]);

  const onCellFocus = useCallback(
    (channel: StoredChannel, left: number) => {
      onFocusChannel(channel);
      glideTo(left);
    },
    [onFocusChannel, glideTo],
  );

  // Fokuser live-cellen paa foerste raekke naar guiden aabnes, og igen naar
  // menuen sender fokus ind (focusFirstSignal). Ét-skuds puls: hasTVPreferredFocus
  // maa ikke staa fast true, ellers river den fokus tilbage ved hver tegning.
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

  const listRef = useRef<FlatList<StoredChannel>>(null);

  const renderItem = useCallback(
    ({ item }: { item: StoredChannel }) => (
      <TimelineRow
        channel={item}
        programmes={progMap[item.id] ?? EMPTY}
        spanStartMs={spanStartMs}
        spanMinutes={spanMinutes}
        nowMs={now.getTime()}
        scrollX={scrollX}
        hasDialect={hasDialectFor(item)}
        onCellFocus={onCellFocus}
        onChannelFocus={onFocusChannel}
        onOpen={onOpen}
        focusLive={focusPulse}
        isFirst={channels[0]?.id === item.id}
      />
    ),
    [progMap, spanStartMs, spanMinutes, now, scrollX, hasDialectFor, onCellFocus, onFocusChannel, onOpen, focusPulse, channels],
  );

  return (
    <View style={styles.root}>
      {/* Tidshoved: timerne, glider med fladen. */}
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <View style={styles.headerStrip} onLayout={(e) => setStripWidth(e.nativeEvent.layout.width)}>
          <Animated.View style={{ width: spanWidth, height: HEADER_HEIGHT, transform: [{ translateX: Animated.multiply(scrollX, -1) }] }}>
            {hourMarks(spanStartMs, spanMinutes).map((mark) => (
              <Text key={mark.ms} style={[styles.hourLabel, { left: mark.x }]}>
                {mark.label}
              </Text>
            ))}
            <Animated.View style={[styles.nowLine, { left: nowX }]} pointerEvents="none" />
          </Animated.View>
        </View>
      </View>
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
      />
    </View>
  );
}

interface RowProps {
  channel: StoredChannel;
  programmes: readonly Programme[];
  spanStartMs: number;
  spanMinutes: number;
  nowMs: number;
  scrollX: Animated.Value;
  hasDialect: boolean;
  onCellFocus: (channel: StoredChannel, left: number) => void;
  /** Fokus paa en kanal uden at flytte tidslinjen (til tomme kanaler). */
  onChannelFocus: (channel: StoredChannel) => void;
  onOpen: (channel: StoredChannel, programme: Programme | null, state: CellState) => void;
  focusLive: boolean;
  isFirst: boolean;
}

const TimelineRow = memo(function TimelineRow({
  channel,
  programmes,
  spanStartMs,
  spanMinutes,
  nowMs,
  scrollX,
  hasDialect,
  onCellFocus,
  onChannelFocus,
  onOpen,
  focusLive,
  isFirst,
}: RowProps) {
  const styles = useStyles(makeStyles);
  const spanWidth = spanMinutes * PX_PER_MIN;
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  const cells = useMemo(() => {
    const out: { key: string; left: number; width: number; programme: Programme; state: CellState }[] = [];
    for (const p of programmes) {
      const start = p.start.getTime();
      const stop = p.stop.getTime();
      if (stop <= spanStartMs || start >= spanStartMs + spanMinutes * 60_000) continue;
      const leftMin = Math.max(0, (start - spanStartMs) / 60_000);
      const rightMin = Math.min(spanMinutes, (stop - spanStartMs) / 60_000);
      out.push({
        key: `p-${start}`,
        left: leftMin * PX_PER_MIN,
        width: Math.max(2, (rightMin - leftMin) * PX_PER_MIN),
        programme: p,
        state: stateOf(p, now),
      });
    }
    return out;
  }, [programmes, spanStartMs, spanMinutes, now]);

  // Den celle der sender nu — maal for pil-ind fra menuen.
  const liveKey = cells.find((c) => c.state === 'live')?.key ?? null;

  return (
    <View style={styles.row}>
      <View style={styles.channelCell}>
        <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={26} />
        <View style={styles.channelText}>
          <Text style={styles.channelName} numberOfLines={2}>
            {channel.name}
          </Text>
          {hasDialect && channel.hasArchive && <Text style={styles.badge}>⏱</Text>}
        </View>
      </View>
      <View style={styles.strip}>
        {cells.length === 0 ? (
          // En kanal helt uden EPG maa ikke springes over. Feltet ligger UDEN
          // for den glidende flade og fylder det synlige, saa fjernbetjeningen
          // altid kan lande paa kanalen (og starte den).
          <TvPressable
            style={styles.emptyCell}
            onFocus={() => onChannelFocus(channel)}
            onPress={() => onOpen(channel, null, 'gap')}
          >
            <Text style={styles.cellMuted} numberOfLines={1}>
              Ingen programoversigt — tryk for at se kanalen
            </Text>
          </TvPressable>
        ) : (
          <Animated.View style={{ width: spanWidth, height: ROW_HEIGHT, transform: [{ translateX: Animated.multiply(scrollX, -1) }] }}>
            {/* Svag baggrund hele vejen, saa huller mellem udsendelser ikke
                staar som sorte felter — cellerne ligger ovenpaa. */}
            <View style={[styles.stripFill, { width: spanWidth }]} pointerEvents="none" />
            {cells.map((cell) => (
              <TvPressable
                key={cell.key}
                hasTVPreferredFocus={isFirst && focusLive && cell.key === liveKey}
                style={[
                  styles.cell,
                  { left: cell.left, width: cell.width },
                  cell.state === 'live' && styles.cellLive,
                  cell.state === 'past' && styles.cellPast,
                ]}
                onFocus={() => onCellFocus(channel, cell.left)}
                onPress={() => onOpen(channel, cell.programme, cell.state)}
              >
                <Text style={styles.cellText} numberOfLines={2}>
                  {cell.programme.title}
                </Text>
              </TvPressable>
            ))}
            <View style={[styles.nowLineRow, { left: Math.max(0, ((nowMs - spanStartMs) / 60_000) * PX_PER_MIN) }]} pointerEvents="none" />
          </Animated.View>
        )}
      </View>
    </View>
  );
});

const EMPTY: Programme[] = [];

/** Timemaerker i spanet, til tidshovedet. */
function hourMarks(spanStartMs: number, spanMinutes: number): { ms: number; x: number; label: string }[] {
  const out: { ms: number; x: number; label: string }[] = [];
  const firstHour = Math.ceil(spanStartMs / 3_600_000) * 3_600_000;
  for (let ms = firstHour; ms < spanStartMs + spanMinutes * 60_000; ms += 3_600_000) {
    const x = ((ms - spanStartMs) / 60_000) * PX_PER_MIN;
    const d = new Date(ms);
    out.push({ ms, x, label: `${String(d.getHours()).padStart(2, '0')}:00` });
  }
  return out;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', height: HEADER_HEIGHT },
  headerSpacer: { width: CHANNEL_COL },
  headerStrip: { flex: 1, overflow: 'hidden' },
  hourLabel: { position: 'absolute', top: 6, color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  nowLine: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.danger },
  row: { flexDirection: 'row', height: ROW_HEIGHT },
  channelCell: {
    width: CHANNEL_COL,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    gap: 6,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: colors.background,
  },
  channelText: { flex: 1 },
  channelName: { color: colors.text, fontSize: 12, fontWeight: '600' },
  badge: { color: colors.accent, fontSize: 12 },
  strip: { flex: 1, overflow: 'hidden' },
  // Svag baggrund bag cellerne, saa huller ikke staar som sorte felter.
  stripFill: { position: 'absolute', top: 3, bottom: 3, left: 0, backgroundColor: colors.surface, opacity: 0.28, borderRadius: theme.radius },
  cell: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    marginRight: 2,
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderRadius: theme.radius,
    backgroundColor: colors.surface,
  },
  // Den kanal der sender nu: lysere, saa den skiller sig ud i kolonnen.
  cellLive: { backgroundColor: colors.surfaceRaised ?? colors.surface, borderWidth: 1, borderColor: colors.accent },
  cellPast: { opacity: 0.55 },
  cellText: { color: colors.text, fontSize: 12 },
  cellMuted: { color: colors.textMuted, fontSize: 12 },
  emptyCell: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 8,
    right: 8,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: theme.radius,
    backgroundColor: colors.surface,
    opacity: 0.6,
  },
  nowLineRow: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.danger },
});
