import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { weatherIcon, weatherText } from '@norstream/core';
import type { WeatherIcon } from '@norstream/core';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import type { Weather } from '../../sync/weather.js';

/**
 * Nyhedsstribe i bunden af guiden (kun tv). Tiden staar fast til venstre; til
 * hoejre ruller vejret og de danske overskrifter forbi, som paa en nyhedskanal.
 * Uden vejr eller nyheder ruller det der er — er der intet, staar striben tom
 * frem for at vise en fejl. Striben er kun i live mens guiden er fremme; gaar
 * man til en anden fane, afmonteres den og animationen stopper.
 */

const WEEKDAYS = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const ICON: Record<WeatherIcon, string> = {
  sun: '☀️',
  cloud: '☁️',
  rain: '🌧️',
  snow: '❄️',
  fog: '🌫️',
  storm: '⛈️',
};

/** Hvor hurtigt striben ruller, i punkter per sekund. Roligt, saa den kan laeses. */
const PX_PER_SEC = 55;

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dayLabel(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

function weatherSegment(weather: Weather): string {
  const parts = [`${ICON[weatherIcon(weather.code)]} ${Math.round(weather.tempNow)}°`];
  if (weather.tempMax !== null && weather.tempMin !== null) {
    parts.push(`${Math.round(weather.tempMax)}° / ${Math.round(weather.tempMin)}°`);
  }
  parts.push(weatherText(weather.code));
  return parts.join(' · ');
}

/** Én stribe indhold: vejret foerst (mrket VEJR), saa overskrifterne (mrket DR). */
function Segments({ weather, headlines }: { weather: Weather | null; headlines: string[] }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.segments}>
      {weather !== null && (
        <>
          <Text style={styles.labelWx}>VEJR</Text>
          <Text style={styles.item}>{weatherSegment(weather)}</Text>
          <Text style={styles.dot}>•</Text>
        </>
      )}
      {headlines.map((headline, index) => (
        <View key={`${index}-${headline}`} style={styles.segRow}>
          <Text style={styles.labelNw}>DR</Text>
          <Text style={styles.item}>{headline}</Text>
          <Text style={styles.dot}>•</Text>
        </View>
      ))}
    </View>
  );
}

export function NewsTicker({
  now,
  weather,
  headlines,
}: {
  now: Date;
  weather: Weather | null;
  headlines: string[];
}) {
  const styles = useStyles(makeStyles);
  const translateX = useRef(new Animated.Value(0)).current;
  /** Bredden paa én kopi af indholdet; animationen kender foerst farten naar den er maalt. */
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => {
    if (contentWidth <= 0) return;
    translateX.setValue(0);
    // To kopier ligger side om side. Naar den foerste er rullet helt ud til
    // venstre (-bredde), staar den anden praecis hvor den foerste startede;
    // et nulstil til 0 er derfor umaerkeligt, og striben loeber uendeligt.
    const animation = Animated.loop(
      Animated.timing(translateX, {
        toValue: -contentWidth,
        duration: (contentWidth / PX_PER_SEC) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [contentWidth, translateX]);

  const hasContent = weather !== null || headlines.length > 0;

  return (
    <View style={styles.bar}>
      <View style={styles.clockBlock}>
        <Text style={styles.kl} numberOfLines={1}>
          {clock(now)}
        </Text>
        <Text style={styles.day} numberOfLines={1}>
          {dayLabel(now)}
        </Text>
      </View>
      <View style={styles.track}>
        {hasContent && (
          <Animated.View style={[styles.move, { transform: [{ translateX }] }]}>
            <View onLayout={(event) => setContentWidth(event.nativeEvent.layout.width)}>
              <Segments weather={weather} headlines={headlines} />
            </View>
            {/* Kopi nummer to, saa der aldrig er et tomt hul efter den foerste. */}
            <Segments weather={weather} headlines={headlines} />
          </Animated.View>
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 40,
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  clockBlock: {
    justifyContent: 'center',
    paddingHorizontal: 14,
    backgroundColor: colors.surfaceRaised,
  },
  kl: { color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: 0.3, lineHeight: 19 },
  day: { color: colors.textMuted, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 1 },
  // Rullebanen: alt uden for den klippes vaek, saa den lange stribe kun ses her.
  track: { flex: 1, overflow: 'hidden', justifyContent: 'center' },
  // Uden en fast bredde faar Animated.View sin bredde af indholdet — netop det
  // vi maaler for at kende farten.
  move: { flexDirection: 'row', alignItems: 'center' },
  segments: { flexDirection: 'row', alignItems: 'center' },
  segRow: { flexDirection: 'row', alignItems: 'center' },
  // Varm tone til vejr-mrket, saa det skiller sig fra den blaa DR-accent; den
  // er valgt saa den kan laeses paa baade lyst og moerkt tema.
  labelWx: { color: '#d98a1f', fontSize: 13, fontWeight: '800', marginLeft: 16, marginRight: 8 },
  labelNw: { color: colors.accent, fontSize: 13, fontWeight: '800', marginLeft: 16, marginRight: 8 },
  item: { color: colors.text, fontSize: 14 },
  dot: { color: colors.border, fontSize: 14, marginHorizontal: 10 },
});
