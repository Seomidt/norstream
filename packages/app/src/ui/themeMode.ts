import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import { nextSunChangeMs } from './sun.js';
import type { ThemeScheme } from './theme.js';
import { DEFAULT_PLACE, placeByKey, resolveScheme } from './themeRules.js';
import type { ThemeMode } from './themeRules.js';

export { DEFAULT_PLACE, PLACES, THEME_MODES, placeByKey, resolveScheme } from './themeRules.js';
export type { Place, ThemeMode } from './themeRules.js';

/**
 * Valget, i hukommelsen. Indstillinger skriver det her og i databasen;
 * App.tsx lytter og regner temaet om. Foer databasen er laest, gaelder
 * standarden.
 */
interface Preference {
  mode: ThemeMode;
  placeKey: string;
}
let preference: Preference = { mode: 'sun', placeKey: DEFAULT_PLACE.key };
const listeners = new Set<() => void>();

export function themePreference(): Preference {
  return preference;
}

export function setThemePreference(next: Partial<Preference>): void {
  preference = { ...preference, ...next };
  for (const listener of [...listeners]) listener();
}

export function subscribeThemePreference(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Temaet lige nu, og det skifter af sig selv ved solopgang/-nedgang og naar telefonen skifter. */
export function useResolvedScheme(): ThemeScheme {
  const systemScheme = useColorScheme();
  const [, tick] = useState(0);
  useEffect(() => subscribeThemePreference(() => tick((value) => value + 1)), []);
  const { mode, placeKey } = preference;
  const place = placeByKey(placeKey);
  useEffect(() => {
    if (mode !== 'sun') return;
    // Vaek ved naeste solopgang/-nedgang, og mindst hver time (uret kan vaere stillet).
    const wait = Math.min(3_600_000, Math.max(1_000, nextSunChangeMs(new Date(), place.latitude, place.longitude) - Date.now() + 1_000));
    const timer = setTimeout(() => tick((value) => value + 1), wait);
    return () => clearTimeout(timer);
  });
  return resolveScheme(mode, systemScheme, new Date(), place);
}
