import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RadioStation } from '../../sync/radioBrowser.js';
import { radioLogoUrls } from '../../sync/radioBrowser.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';
import type { ThemeColors } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';

const ROW_HEIGHT = 64;
/** Saa taet paa kanten fingeren skal vaere foer listen ruller med. */
const EDGE = 64;
const EDGE_STEP = 10;

/**
 * Traek stationerne i den raekkefoelge man vil have dem.
 *
 * Uden bibliotek: en PanResponder paa hele raekken, fast raekkehoejde, og
 * pladsen regnes ud af hvor langt fingeren er flyttet plus hvor meget
 * listen selv har rullet imens (den ruller med naar fingeren naar en kant).
 * Med mange favoritter er det hurtigere end pile, og bunden kan naas.
 */
export function RadioSortList({
  stations,
  contentBottom,
  onReorder,
}: {
  stations: RadioStation[];
  contentBottom: number;
  /** Den nye raekkefoelge, naar en station er sluppet et nyt sted. */
  onReorder: (orderedIds: string[]) => void;
}) {
  const styles = useStyles(makeStyles);
  const [order, setOrder] = useState(stations);
  useEffect(() => {
    setOrder(stations);
  }, [stations]);

  const [drag, setDrag] = useState<{ index: number; hover: number } | null>(null);
  const dragRef = useRef<{ index: number; hover: number; startScroll: number } | null>(null);
  const translate = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const lastDy = useRef(0);
  const frame = useRef({ top: 0, height: 0 });
  const listRef = useRef<View>(null);
  const edgeTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopEdge = (): void => {
    if (edgeTimer.current !== null) clearInterval(edgeTimer.current);
    edgeTimer.current = null;
  };
  useEffect(() => stopEdge, []);

  const updateHover = (dy: number): void => {
    const current = dragRef.current;
    if (current === null) return;
    const offset = dy + (scrollY.current - current.startScroll);
    translate.setValue(offset);
    const hover = Math.max(0, Math.min(order.length - 1, Math.round(current.index + offset / ROW_HEIGHT)));
    if (hover !== current.hover) {
      current.hover = hover;
      setDrag({ index: current.index, hover });
    }
  };

  const edgeScroll = (fingerY: number): void => {
    const { top, height } = frame.current;
    const direction = fingerY < top + EDGE ? -1 : fingerY > top + height - EDGE ? 1 : 0;
    if (direction === 0) {
      stopEdge();
      return;
    }
    if (edgeTimer.current !== null) return;
    edgeTimer.current = setInterval(() => {
      const max = Math.max(0, order.length * ROW_HEIGHT - height);
      const next = Math.max(0, Math.min(max, scrollY.current + direction * EDGE_STEP));
      if (next === scrollY.current) return;
      scrollRef.current?.scrollTo({ y: next, animated: false });
      scrollY.current = next;
      updateHover(lastDy.current);
    }, 16);
  };

  const finish = (): void => {
    stopEdge();
    const current = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    translate.setValue(0);
    if (current === null || current.hover === current.index) return;
    const moved = order[current.index];
    if (moved === undefined) return;
    const next = [...order];
    next.splice(current.index, 1);
    next.splice(current.hover, 0, moved);
    setOrder(next);
    onReorder(next.map((entry) => entry.id));
  };

  const responderFor = (index: number) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        dragRef.current = { index, hover: index, startScroll: scrollY.current };
        lastDy.current = 0;
        translate.setValue(0);
        setDrag({ index, hover: index });
      },
      onPanResponderMove: (_event, gesture) => {
        lastDy.current = gesture.dy;
        updateHover(gesture.dy);
        edgeScroll(gesture.moveY);
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });

  return (
    <View
      ref={listRef}
      style={styles.container}
      onLayout={() => {
        listRef.current?.measureInWindow((_x, y, _w, h) => {
          frame.current = { top: y, height: h };
        });
      }}
    >
      <ScrollView
        ref={scrollRef}
        scrollEnabled={drag === null}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: contentBottom }}
        onScroll={(event) => {
          scrollY.current = event.nativeEvent.contentOffset.y;
        }}
      >
        {order.map((item, index) => {
          const dragging = drag !== null && drag.index === index;
          let shift = 0;
          if (drag !== null && !dragging) {
            if (drag.index < index && index <= drag.hover) shift = -ROW_HEIGHT;
            else if (drag.hover <= index && index < drag.index) shift = ROW_HEIGHT;
          }
          return (
            <Animated.View
              key={item.id}
              style={[
                styles.row,
                dragging && styles.rowDragging,
                { transform: [{ translateY: dragging ? translate : shift }] },
              ]}
            >
              <Text style={styles.position}>{(dragging ? drag.hover : index) + 1}</Text>
              <ChannelLogo uris={radioLogoUrls(item)} name={item.name} memoryKey={`rb:${item.id}`} size={40} />
              <Text style={styles.name} numberOfLines={1}>
                {item.name}
              </Text>
              {/* Kun haandtaget starter et traek; resten af raekken lader
                  listen rulle, saa man kan naa bunden. */}
              <View style={styles.handle} {...responderFor(index).panHandlers}>
                <Text style={styles.handleText}>☰</Text>
              </View>
            </Animated.View>
          );
        })}
      </ScrollView>
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
  rowDragging: { backgroundColor: colors.surfaceRaised, borderRadius: theme.radius, zIndex: 2, elevation: 4 },
  position: { width: 28, color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  name: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  handle: {
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'stretch',
    paddingHorizontal: theme.spacing.md,
    marginRight: -theme.spacing.xs,
  },
  handleText: { color: colors.textMuted, fontSize: 26 },
});
