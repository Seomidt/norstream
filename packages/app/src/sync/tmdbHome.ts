import { tmdbAuth } from './tmdb.js';
import type { TmdbFetch } from './tmdb.js';

/**
 * Forsiden som en tv-boks: hylder per streamingtjeneste.
 *
 * TMDB ved hvad der kan ses hvor (data fra JustWatch), og kan opremse de
 * tjenester der findes i et land og de titler hver af dem har lige nu.
 * Appen selv streamer intet fra dem; den viser hvad der er, og sender
 * videre til tjenestens egen app naar man trykker. Findes titlen ogsaa i
 * brugerens egen pakke, er det foerste valg.
 *
 * Alt her er opslag hos TMDB med brugerens egen noegle; uden noegle er
 * forsiden kun det appen selv har.
 */

const API = 'https://api.themoviedb.org/3';
const POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const LOGO_BASE = 'https://image.tmdb.org/t/p/w92';
export const HOME_REGION = 'DK';
/** Hvor mange tjenester der tilbydes i indstillingerne. De vigtigste foerst. */
const PROVIDER_LIMIT = 24;

export interface TmdbProvider {
  id: number;
  name: string;
  logoUrl: string | null;
}

export interface TmdbTitle {
  id: number;
  kind: 'movie' | 'series';
  title: string;
  year: number | null;
  posterUrl: string | null;
  rating: number | null;
  overview: string;
}

async function getJson(fetchImpl: TmdbFetch, apiKey: string, path: string, query: string): Promise<unknown | null> {
  const auth = tmdbAuth(apiKey);
  try {
    const response = await fetchImpl(`${API}${path}?${query}&language=da-DK${auth.query}`, auth.headers);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

interface RawProvider {
  provider_id?: number;
  provider_name?: string;
  logo_path?: string | null;
  display_priority?: number;
  display_priorities?: Record<string, number>;
}

/**
 * Tjenesterne i et land, vigtigste foerst — Netflix, Viaplay, TV 2 Play,
 * Disney+ … Film- og serielisterne slaas sammen; en tjeneste der kun er
 * paa den ene, er stadig en tjeneste.
 */
export async function listTmdbProviders(
  fetchImpl: TmdbFetch,
  apiKey: string,
  region = HOME_REGION,
): Promise<TmdbProvider[]> {
  const [movies, series] = await Promise.all([
    getJson(fetchImpl, apiKey, '/watch/providers/movie', `watch_region=${region}`),
    getJson(fetchImpl, apiKey, '/watch/providers/tv', `watch_region=${region}`),
  ]);
  const byId = new Map<number, { provider: TmdbProvider; priority: number }>();
  for (const body of [movies, series]) {
    const results = (body as { results?: RawProvider[] } | null)?.results;
    if (!Array.isArray(results)) continue;
    for (const raw of results) {
      if (typeof raw.provider_id !== 'number' || typeof raw.provider_name !== 'string') continue;
      const priority = raw.display_priorities?.[region] ?? raw.display_priority ?? 999;
      const known = byId.get(raw.provider_id);
      if (known !== undefined && known.priority <= priority) continue;
      byId.set(raw.provider_id, {
        priority,
        provider: {
          id: raw.provider_id,
          name: raw.provider_name,
          logoUrl: typeof raw.logo_path === 'string' ? `${LOGO_BASE}${raw.logo_path}` : null,
        },
      });
    }
  }
  return [...byId.values()]
    .sort((a, b) => a.priority - b.priority || a.provider.name.localeCompare(b.provider.name))
    .slice(0, PROVIDER_LIMIT)
    .map((entry) => entry.provider);
}

interface RawTitle {
  id?: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  overview?: string;
  media_type?: string;
}

/** Én titel som TMDB opremser den, eller null naar raekken mangler det vigtigste. */
export function toTmdbTitle(raw: RawTitle, kind: 'movie' | 'series'): TmdbTitle | null {
  if (typeof raw.id !== 'number') return null;
  const title = kind === 'movie' ? raw.title : raw.name;
  if (typeof title !== 'string' || title.length === 0) return null;
  const date = kind === 'movie' ? raw.release_date : raw.first_air_date;
  const year = typeof date === 'string' && /^\d{4}/.test(date) ? Number(date.slice(0, 4)) : null;
  const rating =
    typeof raw.vote_average === 'number' && raw.vote_average > 0 && (raw.vote_count ?? 1) > 0
      ? Math.round(raw.vote_average * 10) / 10
      : null;
  return {
    id: raw.id,
    kind,
    title,
    year,
    posterUrl: typeof raw.poster_path === 'string' ? `${POSTER_BASE}${raw.poster_path}` : null,
    rating,
    overview: typeof raw.overview === 'string' ? raw.overview : '',
  };
}

function titlesOf(body: unknown, kind: 'movie' | 'series'): TmdbTitle[] {
  const results = (body as { results?: RawTitle[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const titles: TmdbTitle[] = [];
  for (const raw of results) {
    const title = toTmdbTitle(raw, kind);
    if (title !== null) titles.push(title);
  }
  return titles;
}

/**
 * Det en tjeneste har lige nu, mest populaere foerst. Kun abonnement
 * (flatrate): leje og koeb er ikke "paa Netflix".
 */
export async function discoverTitles(
  fetchImpl: TmdbFetch,
  apiKey: string,
  providerId: number,
  kind: 'movie' | 'series',
  region = HOME_REGION,
): Promise<TmdbTitle[]> {
  const endpoint = kind === 'series' ? 'tv' : 'movie';
  const body = await getJson(
    fetchImpl,
    apiKey,
    `/discover/${endpoint}`,
    `with_watch_providers=${providerId}&watch_region=${region}&watch_monetization_types=flatrate` +
      '&sort_by=popularity.desc&include_adult=false',
  );
  return titlesOf(body, kind);
}

/**
 * Film og serier fra én tjeneste, flettet: film, serie, film, serie … saa
 * hylden ikke er tyve film og saa serierne bagest.
 */
export async function providerShelf(
  fetchImpl: TmdbFetch,
  apiKey: string,
  providerId: number,
  limit = 20,
  region = HOME_REGION,
): Promise<TmdbTitle[]> {
  const [movies, series] = await Promise.all([
    discoverTitles(fetchImpl, apiKey, providerId, 'movie', region),
    discoverTitles(fetchImpl, apiKey, providerId, 'series', region),
  ]);
  return interleave(movies, series).slice(0, limit);
}

export function interleave<T>(a: readonly T[], b: readonly T[]): T[] {
  const out: T[] = [];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const fromA = a[index];
    const fromB = b[index];
    if (fromA !== undefined) out.push(fromA);
    if (fromB !== undefined) out.push(fromB);
  }
  return out;
}

/** Ugens mest sete, film og serier under ét. Personer sorteres fra. */
export async function trendingTitles(fetchImpl: TmdbFetch, apiKey: string, limit = 20): Promise<TmdbTitle[]> {
  const body = await getJson(fetchImpl, apiKey, '/trending/all/week', 'page=1');
  const results = (body as { results?: RawTitle[] } | null)?.results;
  if (!Array.isArray(results)) return [];
  const titles: TmdbTitle[] = [];
  for (const raw of results) {
    if (raw.media_type !== 'movie' && raw.media_type !== 'tv') continue;
    const title = toTmdbTitle(raw, raw.media_type === 'tv' ? 'series' : 'movie');
    if (title !== null) titles.push(title);
    if (titles.length >= limit) break;
  }
  return titles;
}

/**
 * JustWatch-siden for titlen i landet: den viser hvor den kan ses og
 * sender videre til tjenesten. Bruges naar tjenesten ikke har en kendt
 * soegeadresse.
 */
export async function justWatchLink(
  fetchImpl: TmdbFetch,
  apiKey: string,
  title: TmdbTitle,
  region = HOME_REGION,
): Promise<string | null> {
  const endpoint = title.kind === 'series' ? 'tv' : 'movie';
  const body = (await getJson(fetchImpl, apiKey, `/${endpoint}/${title.id}/watch/providers`, 'page=1')) as {
    results?: Record<string, { link?: string }>;
  } | null;
  const link = body?.results?.[region]?.link;
  return typeof link === 'string' && /^https?:\/\//.test(link) ? link : null;
}

/**
 * Tjenestens egen soegning, med titlen udfyldt. Telefonen aabner adressen
 * i tjenestens app naar den er installeret, ellers i browseren. Null for
 * tjenester uden en kendt soegeadresse; saa bruges JustWatch.
 */
export function serviceSearchUrl(providerName: string, title: string): string | null {
  const name = providerName.toLowerCase();
  const q = encodeURIComponent(title);
  if (name.includes('netflix')) return `https://www.netflix.com/search?q=${q}`;
  if (name.includes('disney')) return `https://www.disneyplus.com/search?q=${q}`;
  if (name.includes('amazon') || name.includes('prime')) return `https://www.primevideo.com/search?phrase=${q}`;
  if (name.includes('viaplay')) return `https://viaplay.dk/search?query=${q}`;
  if (name === 'max' || name.includes('hbo')) return `https://play.max.com/search?q=${q}`;
  if (name.includes('apple')) return `https://tv.apple.com/dk/search?term=${q}`;
  if (name.includes('skyshowtime')) return `https://www.skyshowtime.com/dk/search?q=${q}`;
  if (name.includes('paramount')) return `https://www.paramountplus.com/search/?q=${q}`;
  if (name.includes('youtube')) return `https://www.youtube.com/results?search_query=${q}`;
  return null;
}
