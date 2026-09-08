import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import type { StoredChannel } from '../../storage/channels.js';
import { searchNameFor } from '../../sync/logoSearch.js';
import { ChannelLogo } from '../../ui/ChannelLogo.js';
import { theme } from '../../ui/theme.js';

export type RadioState = 'connecting' | 'playing' | 'paused' | 'error';

interface Props {
  channel: StoredChannel;
  state: RadioState;
  /** Med ord: "Spiller · 1 lydspor", "Forbinder …", fejlen. */
  stateText: string;
  /** Den skjulte videovisning, der holder afspilleren i live. */
  hiddenVideo: ReactNode;
  hasPrevious: boolean;
  hasNext: boolean;
  onBack: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onToggle: () => void;
}

/** Hvor mange soejler der svinger, og hvor hurtigt hver af dem gaar. */
const BAR_PERIODS_MS = [620, 480, 740, 540, 660, 500, 700];

/**
 * Radio har intet billede, saa skaermen maa selv vaere noget at se paa:
 * logoet stort, navnet renset for panelets maerker, og soejler der svinger
 * saa laenge der spilles. Ingen Tekst og intet Start forfra — det er
 * fjernsynets knapper, og de gav kun en forklaring paa hvorfor de ikke
 * virkede.
 */
export function RadioView({
  channel,
  state,
  stateText,
  hiddenVideo,
  hasPrevious,
  hasNext,
  onBack,
  onPrevious,
  onNext,
  onToggle,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  const title = useMemo(() => {
    const cleaned = searchNameFor(channel.name);
    return cleaned.length > 0 ? cleaned : channel.name;
  }, [channel.name]);
  const playing = state === 'playing';

  return (
    <View style={[styles.root, { paddingTop: insets.top + theme.spacing.md, paddingBottom: insets.bottom + theme.spacing.md }]}>
      <View style={styles.hidden}>{hiddenVideo}</View>
      <View style={styles.glowTop} pointerEvents="none" />
      <View style={styles.glowBottom} pointerEvents="none" />

      <View style={[styles.stage, landscape && styles.stageLandscape]}>
        <View style={styles.disc}>
          <ChannelLogo uris={channel.logoUrls} name={channel.name} memoryKey={channel.id} size={landscape ? 120 : 168} />
        </View>
        <View style={styles.text}>
          <Text style={styles.kicker}>RADIO</Text>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {title !== channel.name && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {channel.name}
            </Text>
          )}
          <Equalizer playing={playing} />
          <Text style={[styles.state, state === 'error' && styles.stateError]}>{stateText}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable style={styles.side} onPress={onBack} hitSlop={8} accessibilityLabel="Tilbage">
          <Text style={styles.sideText}>‹ Tilbage</Text>
        </Pressable>
        <Pressable
          style={[styles.round, !hasPrevious && styles.roundDisabled]}
          disabled={!hasPrevious}
          onPress={onPrevious}
          accessibilityLabel="Forrige kanal"
        >
          <Text style={styles.roundText}>⏮</Text>
        </Pressable>
        <Pressable style={styles.play} onPress={onToggle} accessibilityLabel={playing ? 'Pause' : 'Afspil'}>
          <Text style={styles.playText}>{playing ? '❚❚' : '▶'}</Text>
        </Pressable>
        <Pressable
          style={[styles.round, !hasNext && styles.roundDisabled]}
          disabled={!hasNext}
          onPress={onNext}
          accessibilityLabel="Næste kanal"
        >
          <Text style={styles.roundText}>⏭</Text>
        </Pressable>
        <View style={styles.side} />
      </View>
    </View>
  );
}

/** Soejler der svinger i hver sin takt mens der spilles, og lægger sig ned naar der er stille. */
function Equalizer({ playing }: { playing: boolean }) {
  const values = useRef(BAR_PERIODS_MS.map(() => new Animated.Value(0.15))).current;
  useEffect(() => {
    if (!playing) {
      const settle = Animated.parallel(
        values.map((value) => Animated.timing(value, { toValue: 0.15, duration: 300, useNativeDriver: false })),
      );
      settle.start();
      return () => settle.stop();
    }
    const loops = values.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, {
            toValue: 1,
            duration: BAR_PERIODS_MS[index] ?? 600,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
          Animated.timing(value, {
            toValue: 0.2,
            duration: (BAR_PERIODS_MS[index] ?? 600) * 0.8,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    for (const loop of loops) loop.start();
    return () => {
      for (const loop of loops) loop.stop();
    };
  }, [playing, values]);

  return (
    <View style={styles.equalizer}>
      {values.map((value, index) => (
        <Animated.View
          key={index}
          style={[
            styles.bar,
            {
              height: value.interpolate({ inputRange: [0, 1], outputRange: [6, 44] }),
              opacity: playing ? 1 : 0.45,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b0b12', paddingHorizontal: theme.spacing.lg },
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  glowTop: {
    position: 'absolute',
    top: -160,
    left: -80,
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: theme.colors.accent,
    opacity: 0.16,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -200,
    right: -120,
    width: 420,
    height: 420,
    borderRadius: 210,
    backgroundColor: '#8a4cff',
    opacity: 0.12,
  },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: theme.spacing.lg },
  stageLandscape: { flexDirection: 'row', gap: theme.spacing.xl },
  disc: { borderRadius: theme.radius, overflow: 'hidden' },
  text: { alignItems: 'center', gap: theme.spacing.xs, maxWidth: 420 },
  kicker: { color: theme.colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 3 },
  title: { color: theme.colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: theme.colors.textMuted, fontSize: 12, textAlign: 'center' },
  state: { color: theme.colors.textMuted, fontSize: 13, marginTop: theme.spacing.xs },
  stateError: { color: theme.colors.danger },
  equalizer: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 44, marginTop: theme.spacing.sm },
  bar: { width: 6, borderRadius: 3, backgroundColor: theme.colors.accent },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.spacing.md },
  side: { flex: 1 },
  sideText: { color: theme.colors.textMuted, fontSize: 15, fontWeight: '600' },
  round: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff14',
  },
  roundDisabled: { opacity: 0.3 },
  roundText: { color: theme.colors.text, fontSize: 20 },
  play: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.accent,
  },
  playText: { color: '#ffffff', fontSize: 28, fontWeight: '800' },
});
