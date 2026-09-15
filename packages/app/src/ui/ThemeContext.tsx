import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { darkColors, lightColors } from './theme.js';
import type { ThemeColors, ThemeScheme } from './theme.js';

export interface ThemeValue {
  scheme: ThemeScheme;
  colors: ThemeColors;
}

const DARK: ThemeValue = { scheme: 'dark', colors: darkColors };

/** Uden en ThemeProvider (NorRadio, tests) er temaet moerkt. */
const ThemeContext = createContext<ThemeValue>(DARK);

export function ThemeProvider({ scheme, children }: { scheme: ThemeScheme; children: ReactNode }) {
  const value = useMemo<ThemeValue>(
    () => (scheme === 'light' ? { scheme, colors: lightColors } : DARK),
    [scheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/** Det aktuelle tema: farverne og om det er lyst eller moerkt. */
export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

type StyleFactory<T> = (colors: ThemeColors) => T;
const cache = new WeakMap<StyleFactory<unknown>, Map<ThemeColors, unknown>>();

/**
 * Et stilark bygget af det aktuelle temas farver.
 *
 * `makeStyles` er en funktion (colors) => StyleSheet.create({...}). Den
 * kaldes én gang per tema og huskes, saa alle forekomster af en skaerm
 * deler det samme stilark, som foer da det laa paa modulniveau.
 */
export function useStyles<T>(makeStyles: StyleFactory<T>): T {
  const { colors } = useTheme();
  let byColors = cache.get(makeStyles as StyleFactory<unknown>);
  if (byColors === undefined) {
    byColors = new Map();
    cache.set(makeStyles as StyleFactory<unknown>, byColors);
  }
  let built = byColors.get(colors) as T | undefined;
  if (built === undefined) {
    built = makeStyles(colors);
    byColors.set(colors, built);
  }
  return built;
}
