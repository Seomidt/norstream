import type { FetchLike } from '@norstream/core';
import { parseGeoLocation, parseOpenMeteo } from '@norstream/core';
import { getSetting, setSetting } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';

/**
 * Vejret til guiden. Boksen har normalt ingen GPS, saa positionen tages ud fra
 * dens IP-adresse (by-niveau, ingen tilladelse noedvendig) og vejret hentes fra
 * open-meteo (gratis, ingen noegle). Alt sluges stille: fejler noget, vises der
 * bare intet vejr — aldrig en raa fejl paa skaermen.
 */

export interface Weather {
  tempNow: number;
  tempMax: number | null;
  tempMin: number | null;
  code: number;
  city: string | null;
}

const KEY_WEATHER = 'weather_cache';
/** Hentes hoejst én gang i timen; vejret aendrer sig ikke hurtigere end det. */
const MAX_AGE_MS = 60 * 60_000;
/** Position og open-meteo er offentlige tjenester uden legitimation. */
const IP_URL = 'https://ipwho.is/';
const METEO_URL = 'https://api.open-meteo.com/v1/forecast';

interface CachedWeather {
  weather: Weather;
  fetchedAt: number;
}

function toCached(value: string | null): CachedWeather | null {
  if (value === null || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CachedWeather>;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.fetchedAt !== 'number' ||
      typeof parsed.weather !== 'object' ||
      parsed.weather === null ||
      typeof (parsed.weather as Weather).tempNow !== 'number'
    ) {
      return null;
    }
    return { weather: parsed.weather as Weather, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

/** Det senest gemte vejr, saa guiden kan vise noget straks mens et frisk hentes. */
export async function loadCachedWeather(db: SqlDatabase): Promise<Weather | null> {
  return toCached(await getSetting(db, KEY_WEATHER))?.weather ?? null;
}

async function fetchJson(fetchImpl: FetchLike, url: string): Promise<unknown | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Henter friskt vejr, hoejst én gang i timen. Er cachen frisk, bruges den; er
 * en hentning mislykket, beholdes det sidst kendte frem for at blanke ud.
 */
export async function refreshWeather(
  db: SqlDatabase,
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<Weather | null> {
  const cached = toCached(await getSetting(db, KEY_WEATHER));
  if (cached !== null && now.getTime() - cached.fetchedAt < MAX_AGE_MS) {
    return cached.weather;
  }

  const location = parseGeoLocation(await fetchJson(fetchImpl, IP_URL));
  if (location === null) return cached?.weather ?? null;

  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lon),
    current: 'temperature_2m,weather_code',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '1',
  });
  const meteo = parseOpenMeteo(await fetchJson(fetchImpl, `${METEO_URL}?${params.toString()}`));
  if (meteo === null) return cached?.weather ?? null;

  const weather: Weather = { ...meteo, city: location.city };
  await setSetting(db, KEY_WEATHER, JSON.stringify({ weather, fetchedAt: now.getTime() } satisfies CachedWeather));
  return weather;
}
