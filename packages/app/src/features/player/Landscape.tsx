import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { theme } from '../../ui/theme.js';

/**
 * Landskab er fuld skaerm.
 *
 * Vendes telefonen, fylder billedet hele skaermen; appens egne knapper
 * ligger i en bjaelke oven paa, som vises med et tryk paa hjoernet og
 * forsvinder igen af sig selv. Foer blev billedet hoejere end skaermen i
 * landskab, og Tekst, Start forfra og Optag roeg ud under kanten.
 *
 * Bjaelken taendes med en lille knap i hjoernet, ikke med et tryk hvor som
 * helst: afspillerens egne knapper (pause, spol) ligger paa selve billedet,
 * og et lag over dem ville tage deres tryk.
 */
export function useLandscape(): boolean {
  const { width, height } = useWindowDimensions();
  return width > height;
}

/** Hvor laenge bjaelken staar, foer den gemmer sig igen. */
const AUTO_HIDE_MS = 5_000;

export function LandscapePlayer({
  video,
  bar,
  overlays,
}: {
  /** Selve videoen; laegges over hele skaermen. */
  video: ReactNode;
  /** Appens knapper. */
  bar: ReactNode;
  /** Vaelgere og lignende, der skal ligge oven paa alt. */
  overlays?: ReactNode;
}) {
  useKeepAwake();
  const [barShown, setBarShown] = useState(true);
  useEffect(() => {
    if (!barShown) return;
    const timer = setTimeout(() => setBarShown(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [barShown]);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      <View style={StyleSheet.absoluteFill}>{video}</View>
      <Pressable
        style={styles.corner}
        hitSlop={12}
        onPress={() => setBarShown((value) => !value)}
        accessibilityLabel="Vis knapper"
      >
        <Text style={styles.cornerText}>{barShown ? '×' : '⋯'}</Text>
      </Pressable>
      {barShown && (
        <View style={styles.bar} pointerEvents="box-none">
          {bar}
        </View>
      )}
      {overlays}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  corner: {
    position: 'absolute',
    top: theme.spacing.sm,
    right: theme.spacing.md,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00000088',
  },
  cornerText: { color: theme.colors.text, fontSize: 22, fontWeight: '700' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    padding: theme.spacing.md,
    backgroundColor: '#000000aa',
  },
});
