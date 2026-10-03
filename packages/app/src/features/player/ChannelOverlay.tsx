import { memo, useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, StyleSheet, Text, TVFocusGuideView, View } from 'react-native';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';
import { nowNextFor } from '../../storage/programmes.js';
import type { NowNextPair } from '../../storage/programmes.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { isTV } from '../../ui/tv.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { keepInMiddle } from '../../ui/tvScroll.js';

interface Props {
  session: AppSession;
  /** Kanalerne i listen man kom fra, ellers favoritterne. */
  channels: StoredChannel[];
  currentId: string;
  onPick: (channel: StoredChannel) => void;
  onClose: () => void;
}

/** Fast raekkehoejde, saa listen kan rulle til den kanal der spiller uden at maale. */
const ROW_HEIGHT = isTV ? 66 : 62;
/** Hvor tit "nu og naeste" laeses igen mens listen er fremme. */
const REFRESH_MS = 60_000;

/**
 * Kanallisten oven paa billedet (v340): favoritterne (eller listen man kom
 * fra) med det de sender nu og bagefter, uden at forlade det man ser.
 *
 * Paa tv: pil ned fra billedet aabner den, pil op/ned gaar mellem kanalerne,
 * OK skifter, Tilbage lukker. Fokus holdes inde i listen (fanges i alle
 * retninger), og den kanal der spiller har fokus fra start. Paa telefonen:
 * knappen "Kanaler" i bjaelken, og et tryk uden for listen lukker.
 */
export function ChannelOverlay({ session, channels, currentId, onPick, onClose }: Props) {
  const styles = useStyles(makeStyles);
  const listRef = useRef<FlatList<StoredChannel>>(null);
  const [pairs, setPairs] = useState<Map<string, NowNextPair>>(new Map());
  const [now, setNow] = useState(Date.now());
  // Den spillende kanal beder om fokus i ÉN tegning, lidt efter at listen er
  // kommet frem (som en films side): stod anmodningen fast, sprang fokus
  // tilbage til den hver gang listen tegnede sig om (nyt "nu og naeste"
  // hvert minut), og kom den for tidligt, sad raekken ikke i vinduet endnu.
  const initialId = useRef(currentId);
  const [initialFocus, setInitialFocus] = useState(false);
  useEffect(() => {
    if (!isTV) return undefined;
    const timer = setTimeout(() => setInitialFocus(true), 120);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (!initialFocus) return undefined;
    const frame = requestAnimationFrame(() => setInitialFocus(false));
    return () => cancelAnimationFrame(frame);
  }, [initialFocus]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const found = await nowNextFor(session.db, channels.map((channel) => channel.id), new Date());
        if (cancelled) return;
        setPairs(found);
        setNow(Date.now());
      } catch {
        // Uden programdata staar der bare kanalnavne.
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [session.db, channels]);

  // Tilbage lukker listen, foer appen faar lov at lukke afspilleren.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  const currentIndex = Math.max(0, channels.findIndex((channel) => channel.id === currentId));

  return (
    <View style={styles.host} pointerEvents="box-none">
      {/* Bagtaeppet lukker paa telefonen; paa tv maa det ikke kunne faa fokus. */}
      <TvPressable style={styles.backdrop} focusable={!isTV} onPress={onClose} />
      <TVFocusGuideView style={styles.panel} trapFocusUp trapFocusDown trapFocusLeft trapFocusRight>
        <View style={styles.head}>
          <Text style={styles.title}>Kanaler</Text>
          {isTV ? (
            <Text style={styles.hint}>OK skifter · Tilbage lukker</Text>
          ) : (
            <TvPressable hitSlop={12} onPress={onClose}>
              <Text style={styles.close}>✕</Text>
            </TvPressable>
          )}
        </View>
        <FlatList
          ref={listRef}
          data={channels}
          keyExtractor={(channel) => channel.id}
          initialScrollIndex={currentIndex}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          initialNumToRender={12}
          windowSize={5}
          removeClippedSubviews={false}
          onScrollToIndexFailed={() => undefined}
          ListEmptyComponent={<Text style={styles.empty}>Ingen favoritter endnu. Tryk på stjernen ved en kanal under Kanaler.</Text>}
          renderItem={({ item, index }) => (
            <Row
              channel={item}
              pair={pairs.get(item.id) ?? null}
              now={now}
              playing={item.id === currentId}
              preferFocus={initialFocus && item.id === initialId.current}
              onPress={() => onPick(item)}
              onFocus={() => keepInMiddle(listRef.current, index)}
            />
          )}
        />
      </TVFocusGuideView>
    </View>
  );
}

const Row = memo(function Row({
  channel,
  pair,
  now,
  playing,
  preferFocus,
  onPress,
  onFocus,
}: {
  channel: StoredChannel;
  pair: NowNextPair | null;
  now: number;
  playing: boolean;
  preferFocus: boolean;
  onPress: () => void;
  onFocus: () => void;
}) {
  const styles = useStyles(makeStyles);
  const current = pair?.now ?? null;
  const ratio =
    current === null
      ? 0
      : Math.min(1, Math.max(0, (now - current.start.getTime()) / Math.max(1, current.stop.getTime() - current.start.getTime())));
  return (
    <TvPressable style={[styles.row, playing && styles.rowPlaying]} hasTVPreferredFocus={preferFocus} onPress={onPress} onFocus={onFocus}>
      <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={36} />
      <View style={styles.text}>
        <Text style={[styles.name, playing && styles.namePlaying]} numberOfLines={1}>
          {channel.name}
        </Text>
        <Text style={styles.now} numberOfLines={1}>
          {current === null ? (pair?.next === null || pair === null ? 'Ingen programdata' : 'Sender ikke lige nu') : current.title}
        </Text>
        {current !== null && (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
          </View>
        )}
        {pair?.next != null && (
          <Text style={styles.next} numberOfLines={1}>
            Derefter: {pair.next.title}
          </Text>
        )}
      </View>
    </TvPressable>
  );
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    host: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
    backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#00000055' },
    panel: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      width: isTV ? '38%' : '55%',
      maxWidth: 420,
      backgroundColor: '#000000dd',
      borderRightColor: colors.border,
      borderRightWidth: StyleSheet.hairlineWidth,
    },
    head: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.md,
      paddingVertical: theme.spacing.sm,
    },
    title: { color: colors.text, fontSize: 16, fontWeight: '700' },
    hint: { color: colors.textMuted, fontSize: 12 },
    close: { color: colors.textMuted, fontSize: 18 },
    row: {
      height: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.md,
    },
    rowPlaying: { backgroundColor: '#ffffff14' },
    text: { flex: 1, gap: 2 },
    name: { color: colors.text, fontSize: 14, fontWeight: '600' },
    namePlaying: { color: colors.accent },
    now: { color: colors.textMuted, fontSize: 12 },
    track: { height: 2, borderRadius: 1, backgroundColor: '#ffffff33', overflow: 'hidden' },
    fill: { height: 2, backgroundColor: colors.accent },
    next: { color: colors.textMuted, fontSize: 11 },
    empty: { color: colors.textMuted, fontSize: 13, padding: theme.spacing.md, lineHeight: 18 },
  });
