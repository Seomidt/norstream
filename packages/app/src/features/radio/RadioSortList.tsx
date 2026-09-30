import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RadioStation } from '../../sync/radioBrowser.js';
import { radioLogoUrls } from '../../sync/radioBrowser.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';

const ROW_HEIGHT = 64;
/** Saa taet paa kanten fingeren skal vaere foer listen ruller med. */
const EDGE = 72;
const EDGE_STEP = 12;

/** Flyt element fra `from` til `to` i en ny kopi. */
function moved<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/**
 * Markér en station, og træk den så hen hvor den skal ligge.
 *
 * Et tryk paa en raekke tager den op (den loeftes og lyser). Saa laegger et
 * lag sig over listen og fanger fingeren: raekkerne rykker sig live mens man
 * flytter, listen ruller med ved kanten, og et slip lægger stationen. Det er
 * mere robust end at traekke direkte i en rulleliste paa Android, hvor listen
 * og traekket sloges om fingeren.
 */
export function RadioSortList({
  stations,
  contentBottom,
  onReorder,
}: {
  stations: RadioStation[];
  contentBottom: number;
  onReorder: (orderedIds: string[]) => void;
}) {
  const styles = useStyles(makeStyles);
  const [order, setOrder] = useState(stations);
  useEffect(() => {
    setOrder(stations);
  }, [stations]);

  /** Den markerede stations id, eller null. */
  const [pickedId, setPickedId] = useState<string | null>(null);
  /** Pladsen den svaever over mens man flytter. */
  const [hover, setHover] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null);
  const pickedIndexRef = useRef<number>(-1);

  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  /** Listens hoejde paa skaermen (fra onLayout; til rul-ved-kanten). */
  const height = useRef(0);
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Fingerens seneste y, maalt fra listens overkant. */
  const lastFingerY = useRef(0);

  const stopEdge = (): void => {
    if (edgeTimer.current !== null) clearInterval(edgeTimer.current);
    edgeTimer.current = null;
  };
  useEffect(() => stopEdge, []);

  // Den raekkefoelge der vises: den markerede flyttet til den plads den svaever over.
  const shown = pickedId !== null && hover !== null && pickedIndexRef.current !== -1
    ? moved(order, pickedIndexRef.current, hover)
    : order;

  const pick = (id: string): void => {
    if (pickedId === id) {
      setPickedId(null);
      setHover(null);
      hoverRef.current = null;
      pickedIndexRef.current = -1;
      stopEdge();
      return;
    }
    const index = order.findIndex((entry) => entry.id === id);
    if (index === -1) return;
    pickedIndexRef.current = index;
    hoverRef.current = index;
    setPickedId(id);
    setHover(index);
  };

  const drop = (): void => {
    const from = pickedIndexRef.current;
    const to = hoverRef.current;
    stopEdge();
    if (from !== -1 && to !== null && from !== to) {
      const next = moved(order, from, to);
      setOrder(next);
      onReorder(next.map((entry) => entry.id));
    }
    setPickedId(null);
    setHover(null);
    hoverRef.current = null;
    pickedIndexRef.current = -1;
  };

  // Fingerens y maales fra listens egen overkant (`locationY` paa laget, der
  // daekker praecis listen) — ikke fra skaermens top. Foer blev listens
  // plads paa skaermen maalt med measureInWindow i onLayout, og paa Android
  // gav det 0 (eller status-bjaelkens hoejde ved siden af): saa laa den
  // beregnede plads to-tre raekker UNDER fingeren, og en station man trak
  // op, landede laengere nede igen ("smutter ned igen", v353).
  const updateHover = (fingerY: number): void => {
    lastFingerY.current = fingerY;
    const listY = fingerY + scrollY.current;
    const next = Math.max(0, Math.min(order.length - 1, Math.floor(listY / ROW_HEIGHT)));
    if (next !== hoverRef.current) {
      hoverRef.current = next;
      setHover(next);
    }
  };

  const edgeScroll = (fingerY: number): void => {
    const shown = height.current;
    const direction = fingerY < EDGE ? -1 : shown > 0 && fingerY > shown - EDGE ? 1 : 0;
    if (direction === 0) {
      stopEdge();
      return;
    }
    if (edgeTimer.current !== null) return;
    edgeTimer.current = setInterval(() => {
      const max = Math.max(0, order.length * ROW_HEIGHT - height.current);
      const next = Math.max(0, Math.min(max, scrollY.current + direction * EDGE_STEP));
      if (next === scrollY.current) {
        return;
      }
      scrollRef.current?.scrollTo({ y: next, animated: false });
      scrollY.current = next;
      updateHover(lastFingerY.current);
    }, 16);
  };

  const dragOverlay = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        updateHover(event.nativeEvent.locationY);
      },
      onPanResponderMove: (event) => {
        updateHover(event.nativeEvent.locationY);
        edgeScroll(event.nativeEvent.locationY);
      },
      onPanResponderRelease: () => drop(),
      onPanResponderTerminate: () => drop(),
    }),
  ).current;

  return (
    <View
      style={styles.container}
      onLayout={(event) => {
        height.current = event.nativeEvent.layout.height;
      }}
    >
      <ScrollView
        ref={scrollRef}
        scrollEnabled={pickedId === null}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: contentBottom }}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
      >
        {shown.map((item) => {
          const picked = item.id === pickedId;
          return (
            <Pressable key={item.id} style={[styles.row, picked && styles.rowPicked]} onPress={() => pick(item.id)}>
              <ChannelLogo uris={radioLogoUrls(item)} name={item.name} memoryKey={`rb:${item.id}`} size={40} />
              <Text style={[styles.name, picked && styles.namePicked]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.badge}>{picked ? 'Træk mig' : 'Flyt'}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {/* Laget der fanger fingeren mens en station er markeret. */}
      {pickedId !== null && <View style={StyleSheet.absoluteFill} {...dragOverlay.panHandlers} />}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    height: ROW_HEIGHT,
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowPicked: { backgroundColor: colors.accent, borderRadius: theme.radius },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  namePicked: { color: '#ffffff' },
  badge: { color: colors.textMuted, fontSize: 12, fontWeight: '700', paddingHorizontal: theme.spacing.sm },
});
