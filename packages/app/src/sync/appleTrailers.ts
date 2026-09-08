import type { FetchLikeResponse } from '@norstream/core';
import { APP_USER_AGENT } from '../net/userAgent.js';

/**
 * Trailere fra Apples egen filmbutik.
 *
 * iTunes' soegning er aaben og uden noegle, og hver film i butikken har
 * en `previewUrl`: en rigtig MP4-fil med traileren. Den spiller appens
 * egen afspiller direkte, paa alle platforme, ogsaa Apple TV, hvor der
 * ingen webvisning er og YouTubes indlejring derfor ikke findes.
 *
 * Kun film: serier har ingen preview i butikken. Titlen slaas op i den
 * danske butik foerst og saa i den amerikanske, som har mest.
 */

export type AppleFetch = (url: string) => Promise<FetchLikeResponse>;

const SEARCH = 'https://itunes.apple.com/search';
const TIMEOUT_MS = 12_000;
/** Butikkerne der proeves, i raekkefoelge. */
export const APPLE_STORES = ['dk', 'us'] as const;

export const appleFetch: AppleFetch = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': APP_USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
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

export interface AppleTrailer {
  /** MP4-adressen paa traileren. */
  url: string;
  /** Filmens navn i butikken, saa man kan se om det er den rigtige. */
  name: string;
  year: number | null;
  /** Butikken den kom fra. */
  store: string;
}

interface RawResult {
  trackName?: string;
  releaseDate?: string;
  previewUrl?: string;
  kind?: string;
}

/** Titlen reduceret til det der kan sammenlignes: smaa bogstaver, kun bogstaver og tal. */
export function comparable(title: string): string {
  return title
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Det bedste af butikkens svar: samme titel, og aarstallet inden for et
 * aar naar begge har ét. Ellers den foerste hvis titel begynder med den
 * soegte — "Dune" rammer "Dune (2021)" — og ellers ingen: en forkert
 * trailer er vaerre end ingen.
 */
export function pickAppleTrailer(
  results: readonly RawResult[],
  title: string,
  year: number | null,
  store = 'dk',
): AppleTrailer | null {
  const wanted = comparable(title);
  if (wanted.length === 0) return null;
  let loose: AppleTrailer | null = null;
  for (const raw of results) {
    if (typeof raw.trackName !== 'string' || typeof raw.previewUrl !== 'string') continue;
    if (!/^https?:\/\//i.test(raw.previewUrl)) continue;
    const found = comparable(raw.trackName);
    const foundYear =
      typeof raw.releaseDate === 'string' && /^\d{4}/.test(raw.releaseDate) ? Number(raw.releaseDate.slice(0, 4)) : null;
    const candidate: AppleTrailer = { url: raw.previewUrl, name: raw.trackName, year: foundYear, store };
    if (found === wanted) {
      if (year === null || foundYear === null || Math.abs(foundYear - year) <= 1) return candidate;
      continue;
    }
    if (loose === null && found.startsWith(wanted) && (year === null || foundYear === null || Math.abs(foundYear - year) <= 1)) {
      loose = candidate;
    }
  }
  return loose;
}

export async function findAppleTrailer(
  fetchImpl: AppleFetch,
  title: string,
  year: number | null,
  stores: readonly string[] = APPLE_STORES,
): Promise<AppleTrailer | null> {
  const term = title.trim();
  if (term.length === 0) return null;
  for (const store of stores) {
    const url =
      `${SEARCH}?term=${encodeURIComponent(term)}&media=movie&entity=movie&country=${encodeURIComponent(store)}&limit=10`;
    try {
      const response = await fetchImpl(url);
      if (!response.ok) continue;
      const body = (await response.json()) as { results?: RawResult[] } | null;
      const results = body?.results;
      if (!Array.isArray(results)) continue;
      const found = pickAppleTrailer(results, term, year, store);
      if (found !== null) return found;
    } catch {
      // Naeste butik.
    }
  }
  return null;
}
