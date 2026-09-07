import type { FetchLikeResponse } from '@norstream/core';

/**
 * Et kald med valgfri hoveder. Appens saedvanlige fetch kender ingen
 * hoveder, og TMDBs laesetoken (v4) skal sendes som et Authorization-hoved;
 * API-noeglen (v3) gaar i adressen. Begge slags accepteres, saa det er lige
 * meget hvilken af de to brugeren kopierer fra TMDBs side.
 */
export type TmdbFetch = (
  url: string,
  headers?: Record<string, string>,
) => Promise<FetchLikeResponse>;

const TIMEOUT_MS = 12_000;

/** Den rigtige hentning, med tidsgraense. */
export const tmdbFetch: TmdbFetch = async (url, headers) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      json: () => response.json() as Promise<unknown>,
      text: () => response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Hvordan noeglen sendes med. Laesetokenet er et JWT og begynder med "eyJ";
 * alt andet regnes for en v3-noegle.
 */
export function tmdbAuth(key: string): { query: string; headers?: Record<string, string> } {
  const trimmed = key.trim();
  if (trimmed.startsWith('eyJ')) return { query: '', headers: { Authorization: `Bearer ${trimmed}` } };
  return { query: `&api_key=${encodeURIComponent(trimmed)}` };
}

/**
 * Plakater fra The Movie Database, til de film og serier panelet ikke gav
 * en — eller gav en paa en vaert der er doed.
 *
 * Gratis med en noegle brugeren selv laver (TMDB → Settings → API → "API
 * Key (v3 auth)"). Uden noegle goeres intet; panelets egne plakater er
 * stadig foerste valg, og TMDB fylder kun hullerne.
 */
export interface CleanTitle {
  title: string;
  year: number | null;
}

/** Ord panelerne haenger paa titlen, som ikke er en del af den. */
const NOISE = /\b(4K|UHD|HDR|FHD|HD|SD|1080p|720p|2160p|HEVC|H265|H264|x264|x265|MULTI|SUB|DUB|DUAL|NORDIC|DK|DAN|DANSK|DANISH|SWE|SVENSK|NOR|NORSK|ENG|NF|WEB-DL|WEBRIP|BLURAY|BRRIP|REMUX)\b/gi;

/**
 * Titlen som TMDB kender den.
 *
 * Panelet skriver "DK - Spider-Man: No Way Home (2021) [4K]" eller
 * "NF| The Crown S01 - MULTI". Aarstallet tages ud og bruges til at ramme
 * den rigtige indspilning; praefiks, klammer, saesonmaerker og kvalitetsord
 * tages ud, for de rammer ingenting.
 */
export function cleanVodTitle(name: string): CleanTitle {
  let text = name.replace(/\s+/g, ' ').trim();
  // Praefiks foer en lodret streg eller en bindestreg med luft: "DK - ", "NF| ".
  text = text.replace(/^[A-Z]{2,6}\s*[|\-–:]\s*/u, '');
  let year: number | null = null;
  // Et aarstal i parentes eller klammer er et aarstal. Ellers det sidste
  // firecifrede tal i titlen — det foerste kan vaere titlen selv, som "1917".
  const bracketed = /[(\[]\s*((?:19|20)\d{2})\s*[)\]]/.exec(text);
  if (bracketed !== null && bracketed[1] !== undefined) {
    year = Number(bracketed[1]);
    text = text.replace(bracketed[0], ' ');
  } else {
    const all = [...text.matchAll(/\b((?:19|20)\d{2})\b/g)];
    const last = all[all.length - 1];
    if (last !== undefined && last[1] !== undefined && all.length > 0 && last.index !== undefined && last.index > 0) {
      year = Number(last[1]);
      text = `${text.slice(0, last.index)} ${text.slice(last.index + last[0].length)}`;
    }
  }
  text = text
    .replace(/[\[(][^\])]*[\])]/g, ' ')
    .replace(/\bS\d{1,2}(?:E\d{1,3})?\b/gi, ' ')
    .replace(/\b(?:season|saeson|sæson)\s*\d+\b/gi, ' ')
    .replace(NOISE, ' ')
    .replace(/[|]+/g, ' ')
    .replace(/\s[-–:]+\s*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[\s\-–:]+$/g, '');
  return { title: text, year };
}

const IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';
const API = 'https://api.themoviedb.org/3';

interface SearchHit {
  id?: number;
  poster_path?: string | null;
  vote_average?: number;
  vote_count?: number;
}

interface SearchResult {
  results?: SearchHit[];
}

/**
 * Titlens opslag hos TMDB: id og plakat. Aarstallet bruges foerst; rammer
 * det ikke, proeves uden — panelets aarstal er tit et gaet. Null naar
 * TMDB ikke kender titlen, eller noget gaar galt: en plakat der mangler
 * er ikke en fejl paa skaermen.
 */
export async function searchTmdb(
  fetchImpl: TmdbFetch,
  apiKey: string,
  kind: 'movie' | 'series',
  name: string,
): Promise<{ id: number; posterUrl: string | null; rating: number | null } | null> {
  const { title, year } = cleanVodTitle(name);
  if (title.length === 0) return null;
  const endpoint = kind === 'series' ? 'tv' : 'movie';
  const yearParam = year === null ? '' : kind === 'series' ? `&first_air_date_year=${year}` : `&year=${year}`;
  const auth = tmdbAuth(apiKey);
  const url =
    `${API}/search/${endpoint}?query=${encodeURIComponent(title)}` +
    `${yearParam}&include_adult=false&language=da-DK${auth.query}`;
  try {
    let hit = await firstHit(fetchImpl, url, auth.headers);
    if (hit === null && year !== null) hit = await firstHit(fetchImpl, url.replace(yearParam, ''), auth.headers);
    if (hit === null || typeof hit.id !== 'number') return null;
    // Karakteren taeller kun naar nogen har stemt; et nul fra ingen er ikke et nul.
    const rating =
      typeof hit.vote_average === 'number' && hit.vote_average > 0 && (hit.vote_count ?? 1) > 0
        ? Math.round(hit.vote_average * 10) / 10
        : null;
    return {
      id: hit.id,
      posterUrl: typeof hit.poster_path === 'string' ? `${IMAGE_BASE}${hit.poster_path}` : null,
      rating,
    };
  } catch {
    return null;
  }
}

async function firstHit(
  fetchImpl: TmdbFetch,
  url: string,
  headers: Record<string, string> | undefined,
): Promise<SearchHit | null> {
  const response = await fetchImpl(url, headers);
  if (!response.ok) return null;
  const parsed = (await response.json()) as SearchResult;
  // Den foerste med plakat; ellers den foerste overhovedet.
  const results = parsed.results ?? [];
  return results.find((result) => typeof result.poster_path === 'string') ?? results[0] ?? null;
}

/** Plakatens adresse, eller null. */
export async function findTmdbPoster(
  fetchImpl: TmdbFetch,
  apiKey: string,
  kind: 'movie' | 'series',
  name: string,
): Promise<string | null> {
  return (await searchTmdb(fetchImpl, apiKey, kind, name))?.posterUrl ?? null;
}

interface Video {
  key?: string;
  site?: string;
  type?: string;
  official?: boolean;
  name?: string;
  iso_639_1?: string;
  published_at?: string;
}

export interface TmdbTrailer {
  youtubeId: string;
  name: string;
}

/**
 * Titlens trailer paa YouTube, som TMDB kender den.
 *
 * TMDB maerker hver video med hvad den er — Trailer, Teaser, Clip — og om
 * den er officiel. Saa der er ingen grund til at maale laengden: en
 * "Trailer" er en trailer. Officielle foerst, nyeste foerst. Teasere og
 * klip tages ikke med; det var netop dem der var problemet.
 */
export async function findTmdbTrailer(
  fetchImpl: TmdbFetch,
  apiKey: string,
  kind: 'movie' | 'series',
  name: string,
): Promise<TmdbTrailer | null> {
  const found = await searchTmdb(fetchImpl, apiKey, kind, name);
  if (found === null) return null;
  const endpoint = kind === 'series' ? 'tv' : 'movie';
  const auth = tmdbAuth(apiKey);
  try {
    const response = await fetchImpl(
      `${API}/${endpoint}/${found.id}/videos?include_video_language=da,en,null${auth.query}`,
      auth.headers,
    );
    if (!response.ok) return null;
    const parsed = (await response.json()) as { results?: Video[] };
    return pickTmdbTrailer(parsed.results ?? []);
  } catch {
    return null;
  }
}

/** Den bedste af TMDBs videoer: YouTube, af typen Trailer, officiel foer uofficiel, nyest foerst. */
export function pickTmdbTrailer(videos: readonly Video[]): TmdbTrailer | null {
  const trailers = videos.filter(
    (video) =>
      video.site === 'YouTube' && video.type === 'Trailer' && typeof video.key === 'string' && video.key.length > 0,
  );
  trailers.sort((a, b) => {
    const official = Number(b.official === true) - Number(a.official === true);
    if (official !== 0) return official;
    return (b.published_at ?? '').localeCompare(a.published_at ?? '');
  });
  const best = trailers[0];
  if (best === undefined || best.key === undefined) return null;
  return { youtubeId: best.key, name: best.name ?? 'Trailer' };
}
