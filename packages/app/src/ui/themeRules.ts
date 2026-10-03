import { isDaylight } from './sun.js';
import type { ThemeScheme } from './theme.js';

/**
 * Hvordan temaet vaelges.
 *
 * - sun: lyst fra solopgang til solnedgang, ellers moerkt. Standard, ogsaa
 *   paa tv: en lys flade om aftenen traetter, men den er kun lys naar det
 *   er lyst udenfor.
 * - system: som telefonen (dens eget skema, fx "moerkt fra solnedgang").
 * - dark / light: laast.
 */
export type ThemeMode = 'sun' | 'system' | 'dark' | 'light';
export const THEME_MODES: readonly ThemeMode[] = ['sun', 'system', 'dark', 'light'];

export interface Place {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
}

/** Stederne man kan vaelge. Forskellen mellem dem er under et kvarter, men den er der. */
export const PLACES: readonly Place[] = [
  { key: 'aarhus', name: 'Aarhus', latitude: 56.16, longitude: 10.2 },
  { key: 'koebenhavn', name: 'København', latitude: 55.68, longitude: 12.57 },
  { key: 'odense', name: 'Odense', latitude: 55.4, longitude: 10.39 },
  { key: 'aalborg', name: 'Aalborg', latitude: 57.05, longitude: 9.92 },
  { key: 'esbjerg', name: 'Esbjerg', latitude: 55.47, longitude: 8.45 },
  { key: 'bornholm', name: 'Bornholm', latitude: 55.1, longitude: 14.9 },
  { key: 'skagen', name: 'Skagen', latitude: 57.72, longitude: 10.59 },
  { key: 'soenderborg', name: 'Sønderborg', latitude: 54.91, longitude: 9.79 },
];
export const DEFAULT_PLACE = PLACES[0] as Place;

export function placeByKey(key: string | null): Place {
  return PLACES.find((place) => place.key === key) ?? DEFAULT_PLACE;
}

export function resolveScheme(
  mode: ThemeMode,
  systemScheme: string | null | undefined,
  now: Date,
  place: Place,
): ThemeScheme {
  switch (mode) {
    case 'dark':
      return 'dark';
    case 'light':
      return 'light';
    case 'system':
      return systemScheme === 'light' ? 'light' : 'dark';
    default:
      return isDaylight(now, place.latitude, place.longitude) ? 'light' : 'dark';
  }
}

