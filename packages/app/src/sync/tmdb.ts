import type { FetchLike } from '@norstream/core';

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

interface SearchResult {
  results?: Array<{ poster_path?: string | null; release_date?: string; first_air_date?: string; title?: string; name?: string }>;
}

/**
 * Plakatens adresse, eller null naar TMDB ikke kender titlen. Fejl giver
 * ogsaa null; en plakat der mangler er ikke en fejl paa skaermen.
 */
export async function findTmdbPoster(
  fetchImpl: FetchLike,
  apiKey: string,
  kind: 'movie' | 'series',
  name: string,
): Promise<string | null> {
  const { title, year } = cleanVodTitle(name);
  if (title.length === 0) return null;
  const endpoint = kind === 'series' ? 'tv' : 'movie';
  const yearParam = year === null ? '' : kind === 'series' ? `&first_air_date_year=${year}` : `&year=${year}`;
  const url =
    `https://api.themoviedb.org/3/search/${endpoint}?query=${encodeURIComponent(title)}` +
    `${yearParam}&include_adult=false&language=da-DK&api_key=${encodeURIComponent(apiKey)}`;
  try {
    let response = await fetchImpl(url);
    if (!response.ok) return null;
    let parsed = (await response.json()) as SearchResult;
    let hit = (parsed.results ?? []).find((result) => typeof result.poster_path === 'string');
    // Aarstallet kan vaere panelets eget gaet. Uden det, som anden chance.
    if (hit === undefined && year !== null) {
      response = await fetchImpl(url.replace(yearParam, ''));
      if (!response.ok) return null;
      parsed = (await response.json()) as SearchResult;
      hit = (parsed.results ?? []).find((result) => typeof result.poster_path === 'string');
    }
    if (hit === undefined || typeof hit.poster_path !== 'string') return null;
    return `${IMAGE_BASE}${hit.poster_path}`;
  } catch {
    return null;
  }
}
