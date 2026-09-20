import { StyleSheet, Text, View } from 'react-native';
import { weatherIcon, weatherText } from '@norstream/core';
import type { WeatherIcon } from '@norstream/core';
import { useStyles } from '../../ui/ThemeContext.js';
import type { ThemeColors } from '../../ui/theme.js';
import type { Weather } from '../../sync/weather.js';

/**
 * Uret + vejret til venstre for preview i guiden (kun tv). Uret er stort, saa
 * man kan se klokken fra sofaen; vejret staar under med boksens lokale forhold.
 * Uden vejrdata vises kun uret — aldrig en fejl.
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

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function dateLabel(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}

export function ClockWeather({ now, weather }: { now: Date; weather: Weather | null }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.box}>
      <Text style={styles.clock} numberOfLines={1}>
        {clock(now)}
      </Text>
      <Text style={styles.date} numberOfLines={1}>
        {dateLabel(now)}
      </Text>
      {weather !== null && (
        <View style={styles.wx}>
          <View style={styles.wxTop}>
            <Text style={styles.icon}>{ICON[weatherIcon(weather.code)]}</Text>
            <Text style={styles.temp} numberOfLines={1}>
              {Math.round(weather.tempNow)}°
              {weather.tempMax !== null && weather.tempMin !== null && (
                <Text style={styles.range}>
                  {'  '}
                  {Math.round(weather.tempMax)}° / {Math.round(weather.tempMin)}°
                </Text>
              )}
            </Text>
          </View>
          <Text style={styles.desc} numberOfLines={1}>
            {weatherText(weather.code)}
          </Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  box: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    justifyContent: 'center',
  },
  clock: { color: colors.text, fontSize: 27, fontWeight: '800', letterSpacing: 0.5, lineHeight: 30 },
  date: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  wx: { marginTop: 9, paddingTop: 8, borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
  wxTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { fontSize: 16 },
  temp: { color: colors.text, fontSize: 15, fontWeight: '700' },
  range: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  desc: { color: colors.textMuted, fontSize: 11, marginTop: 3 },
});
