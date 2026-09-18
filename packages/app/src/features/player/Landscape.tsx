import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, useTVEventHandler, useWindowDimensions } from 'react-native';
import type { ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '../../ui/theme.js';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { isTV } from '../../ui/tv.js';

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
 *
 * Bjaelken og hjoerneknappen holder sig inden for de sikre kanter. Paa en
 * foldet telefon slaaet ud ligger telefonens egen knaplinje nederst, og
 * uden luften laa Tilbage praecis under den, saa linjen tog trykket.
 */
export function useLandscape(): boolean {
  const { width, height } = useWindowDimensions();
  return width > height;
}

/** Hvor laenge bjaelken staar, foer den gemmer sig igen. */
const AUTO_HIDE_MS = 5_000;

/** Tasterne fra fjernbetjeningen som afspilleren selv skal tage sig af. */
export type PlayerKey = 'select' | 'left' | 'right' | 'playPause' | 'rewind' | 'fastForward';

/**
 * Skaermen holdes vaagen, men kun mens der afspilles (Google TV-BY: ved
 * pause maa fjernsynet gaa i pauseskaerm). En egen komponent, saa
 * useKeepAwake kan slaas til og fra ved at montere den.
 */
function KeepAwake() {
  useKeepAwake();
  return null;
}

export function LandscapePlayer({
  video,
  bar,
  overlays,
  playing = true,
  onPlayerKey,
}: {
  /** Selve videoen; laegges over hele skaermen. */
  video: ReactNode;
  /** Appens knapper. */
  bar: ReactNode;
  /** Vaelgere og lignende, der skal ligge oven paa alt. */
  overlays?: ReactNode;
  /** Sand mens der afspilles: saa holdes skaermen vaagen. */
  playing?: boolean;
  /**
   * Tv, Googles regler for afspilning (TV-PC, TV-PP): OK pauser og
   * genoptager, pil venstre/hoejre spoler, og play/pause-tasten virker.
   * Kaldes for OK og pilene kun naar bjaelken er skjult (ellers rammer
   * de knapperne), og for medietasterne altid. Returnerer sand naar
   * tasten er brugt.
   */
  onPlayerKey?: (key: PlayerKey) => boolean;
}) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [barShown, setBarShown] = useState(true);
  /** Taeller op ved hvert tryk, saa uret til at gemme bjaelken starter forfra. */
  const [activity, setActivity] = useState(0);
  // Paa tv: ethvert tryk paa fjernbetjeningen viser bjaelken igen og
  // giver den ny tid. Foer gemte den sig fem sekunder efter at den kom
  // frem, ogsaa midt i at man koerte hen til en knap: "knapperne virker ikke".
  const barShownRef = useRef(barShown);
  barShownRef.current = barShown;
  useTVEventHandler((event) => {
    if (event.eventType === 'focus' || event.eventType === 'blur') return;
    // Android sender tryk ned (0) og op (1); tasterne taeller én gang.
    const keyUp = event.eventKeyAction === undefined || Number(event.eventKeyAction) !== 0;
    const type = event.eventType;
    if (keyUp && onPlayerKey !== undefined) {
      if (type === 'playPause' || type === 'rewind' || type === 'fastForward') onPlayerKey(type);
      else if (!barShownRef.current && (type === 'select' || type === 'left' || type === 'right')) onPlayerKey(type);
    }
    setBarShown(true);
    setActivity((value) => value + 1);
  });
  useEffect(() => {
    // Paa tv gemmer bjaelken sig IKKE: hver gang den gemte sig og kom igen,
    // blev knapperne tegnet forfra, og fokus faldt tilbage paa den foerste
    // ("Start forfra") — man kunne slet ikke komme hen til Tekst/zap. Med en
    // fast bjaelke bliver knapperne staaende og kan naas frit. Paa telefon
    // (fingre, ikke fokus) gemmer den sig stadig af sig selv.
    if (!barShown || isTV) return;
    const timer = setTimeout(() => setBarShown(false), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [barShown, activity]);

  return (
    <View style={styles.root}>
      <StatusBar hidden />
      {playing && <KeepAwake />}
      <View style={StyleSheet.absoluteFill}>{video}</View>
      {/* Hjoerneknappen er til fingre: paa tv viser ethvert tryk paa
          fjernbetjeningen bjaelken, og en prik-knap oppe i hjoernet var
          bare noget man undrede sig over. */}
      {!isTV && (
        <TvPressable
          style={[styles.corner, { top: theme.spacing.sm + insets.top, right: theme.spacing.md + insets.right }]}
          hitSlop={12}
          onPress={() => setBarShown((value) => !value)}
          accessibilityLabel="Vis knapper"
        >
          <Text style={styles.cornerText}>{barShown ? '×' : '⋯'}</Text>
        </TvPressable>
      )}
      {barShown && (
        <View
          style={[
            styles.bar,
            {
              // Paa tv ingen ekstra bund-luft: der er ingen navigationslinje at
              // holde fri af, og skaermens "sikre kant" skubbede ellers
              // knapperne et godt stykke op fra bunden. Nu ligger de i bunden.
              paddingBottom: theme.spacing.md + (isTV ? 0 : insets.bottom),
              paddingLeft: theme.spacing.md + (isTV ? 0 : insets.left),
              paddingRight: theme.spacing.md + (isTV ? 0 : insets.right),
            },
          ]}
          pointerEvents="box-none"
        >
          {bar}
        </View>
      )}
      {overlays}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
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
  cornerText: { color: colors.text, fontSize: 22, fontWeight: '700' },
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
