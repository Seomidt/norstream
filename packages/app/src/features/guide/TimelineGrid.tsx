import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
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
 * Guiden som ens blokke, ligesom favoritlisten — den model der "virker super
 * godt ogsaa med at koere op og ned".
 *
 * Kanaler lodret, udsendelser vandret. Hver blok er lige BRED (uanset hvor
 * lang udsendelsen er), og den der sender NU staar i samme lodrette kolonne i
 * ALLE raekker (forankringen). Derfor: gaar man op/ned fra en live-blok, lander
 * man paa nabokanalens live-blok — rent, hver gang, fordi blokken lige nedenunder
 * ligger paa NOEJAGTIG samme sted. Det var det gamle tidslinjegitter ikke: der
 * sad cellerne paa deres klokkeslaet med hver sin bredde, saa "cellen nedenunder"
 * tit var naboen og ikke det der sender nu.
 *
 * Vandret deler alle raekker én forskydning (`scrollX` = kolonner gange
 * blokbredde). Gaar man til siden, glider HELE fladen bloedt med i tid (som
 * Googles/Xumos guide), og live-blokkene bliver ved med at flugte i deres
 * kolonne. Den blok der har fokus vokser lidt (samme fokus som favoritraekkerne).
 */

/** Fast blokbredde. Alle udsendelser er lige brede — det er det der faar kolonnerne til at flugte. */
const BLOCK_W = 150;
/** Luft mellem blokke. Stor nok til at en fokuseret (skaleret) blok ikke rammer naboen. */
const GAP = 10;
const SLOT = BLOCK_W + GAP;
const ROW_HEIGHT = 66;
const CHANNEL_COL = 112;
const HEADER_HEIGHT = 26;
/** Hvor live-/fokus-kolonnen lander, maalt fra stribens venstre kant. */
const ANCHOR_X = 10;
/** Hvor langt tilbage/frem der hentes programdata. Bagud lidt, frem en lang dag. */
const SPAN_BACK_MIN = 6 * 60;
const SPAN_FWD_MIN = 24 * 60;

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

  const nowMs = now.getTime();
  const hourBucket = Math.floor(nowMs / 3_600_000);
  const spanStartMs = useMemo(() => hourBucket * 3_600_000 - SPAN_BACK_MIN * 60_000, [hourBucket]);
  const spanEndMs = spanStartMs + (SPAN_BACK_MIN + SPAN_FWD_MIN) * 60_000;

  const [progMap, setProgMap] = useState<Record<string, Programme[]>>({});
  // Fyld programdata for hele spanet paa én gang, saa intet forsvinder naar man
  // glider frem og tilbage. Foerst det lokale, saa en baggrundshentning ovenpaa.
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

  // Delt vandret forskydning i pixels (kolonner * SLOT). Native driver: glat.
  const scrollX = useRef(new Animated.Value(0)).current;
  // Hvilken kolonne (talt fra live=0) fladen staar paa nu. Undgaar at glide igen
  // naar op/ned lander paa samme kolonne — saa staar den helt stille lodret.
  const colRef = useRef(0);
  const glideToCol = useCallback(
    (col: number) => {
      if (col === colRef.current) return;
      colRef.current = col;
      Animated.timing(scrollX, { toValue: col * SLOT, duration: 150, useNativeDriver: true }).start();
    },
    [scrollX],
  );

  const listRef = useRef<FlatList<StoredChannel>>(null);
  // Lodret: rul listen saa den raekke fokus staar paa altid er synlig — ellers
  // blev den nederste raekke skaaret af ("kan ikke se hvad der sker i bunden").
  const scrollToChannel = useCallback(
    (channel: StoredChannel) => {
      const idx = channels.findIndex((c) => c.id === channel.id);
      if (idx < 0) return;
      try {
        listRef.current?.scrollToIndex({ index: idx, viewPosition: 0.5, animated: true });
      } catch {
        // Maalet er ikke tegnet endnu; onScrollToIndexFailed haandterer det.
      }
    },
    [channels],
  );
  const onBlockFocus = useCallback(
    (channel: StoredChannel, col: number) => {
      onFocusChannel(channel);
      scrollToChannel(channel);
      glideToCol(col);
    },
    [onFocusChannel, scrollToChannel, glideToCol],
  );
  // Tom kanal (ingen EPG): fokus paa kanalen, men roer ikke tiden.
  const onChannelFocus = useCallback(
    (channel: StoredChannel) => {
      onFocusChannel(channel);
      scrollToChannel(channel);
    },
    [onFocusChannel, scrollToChannel],
  );

  // Fokuser live-blokken paa foerste raekke naar guiden aabnes, og igen naar
  // menuen sender fokus ind. Ét-skuds puls, ellers river den fokus tilbage ved
  // hver tegning.
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
    ({ item }: { item: StoredChannel }) => (
      <ChannelStrip
        channel={item}
        programmes={progMap[item.id] ?? EMPTY}
        nowMs={nowMs}
        scrollX={scrollX}
        hasDialect={hasDialectFor(item)}
        onBlockFocus={onBlockFocus}
        onChannelFocus={onChannelFocus}
        onOpen={onOpen}
        focusLive={focusPulse}
        isFirst={channels[0]?.id === item.id}
      />
    ),
    [progMap, nowMs, scrollX, hasDialectFor, onBlockFocus, onChannelFocus, onOpen, focusPulse, channels],
  );

  return (
    <View style={styles.root}>
      {/* Slank hoved: en paamindelse om at man kan gaa i tid til begge sider. */}
      <View style={styles.header}>
        <View style={styles.headerSpacer} />
        <Text style={styles.headerHint} numberOfLines={1}>
          ‹ tidligere   ·   NU sender i den markerede kolonne   ·   senere ›
        </Text>
      </View>
      {/* Fang fokus til side: pil venstre/hoejre glider i tiden og maa ikke
          slippe ud i menuen ("koerer pludselig ud til menuen"). Menuen naas ved
          at gaa op til gruppe-chipsene. */}
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

interface Block {
  key: string;
  /** Kolonne talt fra live (0 = sender nu, negativ = tidligere, positiv = senere). */
  col: number;
  programme: Programme;
  state: CellState;
}

interface StripProps {
  channel: StoredChannel;
  programmes: readonly Programme[];
  nowMs: number;
  scrollX: Animated.Value;
  hasDialect: boolean;
  onBlockFocus: (channel: StoredChannel, col: number) => void;
  onChannelFocus: (channel: StoredChannel) => void;
  onOpen: (channel: StoredChannel, programme: Programme | null, state: CellState) => void;
  focusLive: boolean;
  isFirst: boolean;
}

const ChannelStrip = memo(function ChannelStrip({
  channel,
  programmes,
  nowMs,
  scrollX,
  hasDialect,
  onBlockFocus,
  onChannelFocus,
  onOpen,
  focusLive,
  isFirst,
}: StripProps) {
  const styles = useStyles(makeStyles);
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  // Ordnede, ikke-overlappende udsendelser + hvilken der sender nu.
  const { blocks, liveCol } = useMemo(() => {
    const sorted = [...programmes].sort((a, b) => a.start.getTime() - b.start.getTime());
    // Klip dubletter/overlap vaek: to der overlapper maa ikke staa som "samme
    // udsendelse 2 gange". Behold den foerste, spring dem der starter foer den
    // forrige sluttede.
    const kept: Programme[] = [];
    let lastStop = -Infinity;
    for (const p of sorted) {
      if (p.start.getTime() < lastStop) continue;
      kept.push(p);
      lastStop = p.stop.getTime();
    }
    // Forankringen: den der sender nu. Er der hul netop nu, tag den foerste der
    // ikke er slut endnu (den kommende), saa der altid staar noget i live-kolonnen.
    let anchor = kept.findIndex((p) => stateOf(p, now) === 'live');
    if (anchor < 0) anchor = kept.findIndex((p) => p.stop.getTime() > nowMs);
    if (anchor < 0) anchor = kept.length - 1;
    const out: Block[] = kept.map((p, i) => ({
      key: `p-${p.start.getTime()}`,
      col: i - anchor,
      programme: p,
      state: stateOf(p, now),
    }));
    return { blocks: out, liveCol: 0 };
  }, [programmes, now, nowMs]);

  // Raekkens faste forskydning: stil dens live-blok (col 0) ved ANCHOR_X. Alle
  // raekker deler `scrollX`, saa live-kolonnen flugter lodret paa tvaers af dem.
  // (Selve blokkene sidder paa positive left; forankringen ligger i transformen,
  // saa negative kolonner ikke klippes af Android.)
  const anchorIndex = blocks.length > 0 ? -blocks[0]!.col : 0; // = anchor fra oven
  const base = useMemo(() => new Animated.Value(ANCHOR_X - anchorIndex * SLOT), [anchorIndex]);
  const translateX = useMemo(() => Animated.subtract(base, scrollX), [base, scrollX]);

  const liveKey = blocks.find((b) => b.col === liveCol)?.key ?? null;

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
        {blocks.length === 0 ? (
          // En kanal helt uden EPG maa ikke springes over. Feltet ligger UDEN
          // for den glidende flade og fylder det synlige, saa fjernbetjeningen
          // altid kan lande paa kanalen (og starte den).
          <TvPressable
            style={styles.emptyBlock}
            flat
            onFocus={() => onChannelFocus(channel)}
            onPress={() => onOpen(channel, null, 'gap')}
          >
            <Text style={styles.blockMuted} numberOfLines={1}>
              Ingen programoversigt — tryk for at se kanalen
            </Text>
          </TvPressable>
        ) : (
          <Animated.View style={[styles.track, { transform: [{ translateX }] }]}>
            {blocks.map((b, i) => (
              <TvPressable
                key={b.key}
                hasTVPreferredFocus={isFirst && focusLive && b.key === liveKey}
                style={[
                  styles.block,
                  { left: i * SLOT },
                  b.state === 'live' && styles.blockLive,
                  b.state === 'past' && styles.blockPast,
                ]}
                onFocus={() => onBlockFocus(channel, b.col)}
                onPress={() => onOpen(channel, b.programme, b.state)}
              >
                <Text style={styles.blockTime} numberOfLines={1}>
                  {b.state === 'live' ? '● NU' : clock(b.programme.start)}
                </Text>
                <Text style={styles.blockText} numberOfLines={2}>
                  {b.programme.title}
                </Text>
              </TvPressable>
            ))}
          </Animated.View>
        )}
      </View>
    </View>
  );
});

const EMPTY: Programme[] = [];

/** Klokkeslaet som HH:MM. */
function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  list: { flex: 1 },
  header: { flexDirection: 'row', height: HEADER_HEIGHT, alignItems: 'center' },
  headerSpacer: { width: CHANNEL_COL },
  headerHint: { flex: 1, color: colors.textMuted, fontSize: 12, fontWeight: '600' },
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
  strip: { flex: 1, overflow: 'hidden', justifyContent: 'center' },
  track: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  block: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    width: BLOCK_W,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: theme.radius,
    backgroundColor: colors.surface,
  },
  // Den kanal der sender nu: lysere med accent-ramme, saa live-kolonnen er tydelig.
  blockLive: { backgroundColor: colors.surfaceRaised ?? colors.surface, borderWidth: 1, borderColor: colors.accent },
  blockPast: { opacity: 0.5 },
  blockTime: { color: colors.textMuted, fontSize: 11, fontWeight: '600', marginBottom: 2 },
  blockText: { color: colors.text, fontSize: 13 },
  blockMuted: { color: colors.textMuted, fontSize: 12 },
  emptyBlock: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: ANCHOR_X,
    right: 8,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderRadius: theme.radius,
    backgroundColor: colors.surface,
    opacity: 0.6,
  },
});
