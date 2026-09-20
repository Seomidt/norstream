import type { FetchLike } from '@norstream/core';
import { parseNewsHeadlines } from '@norstream/core';
import { getSetting, setSetting } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';

/**
 * Nyhederne til guidens nyhedsstribe. Overskrifterne hentes fra DR's RSS
 * (gratis, ingen noegle) og oversaettes af core. Alt sluges stille: fejler
 * noget, vises der bare de sidst kendte overskrifter — aldrig en raa fejl.
 */

export interface News {
  headlines: string[];
}

const KEY_NEWS = 'news_cache';
/** Hentes hoejst et par gange i timen; overskrifterne skifter ikke hurtigere. */
const MAX_AGE_MS = 20 * 60_000;
/** DR's offentlige nyhedsstroem — gratis og uden legitimation. */
const DR_RSS_URL = 'https://www.dr.dk/nyheder/service/feeds/allenyheder';

interface CachedNews {
  news: News;
  fetchedAt: number;
}

function toCached(value: string | null): CachedNews | null {
  if (value === null || value.length === 0) return null;
  try {
    const parsed = JSON.parse(value) as Partial<CachedNews>;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.fetchedAt !== 'number' ||
      typeof parsed.news !== 'object' ||
      parsed.news === null ||
      !Array.isArray((parsed.news as News).headlines)
    ) {
      return null;
    }
    const headlines = (parsed.news as News).headlines.filter((h): h is string => typeof h === 'string');
    return { news: { headlines }, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

/** De senest gemte overskrifter, saa striben kan vise noget straks. */
export async function loadCachedNews(db: SqlDatabase): Promise<News | null> {
  return toCached(await getSetting(db, KEY_NEWS))?.news ?? null;
}

async function fetchText(fetchImpl: FetchLike, url: string): Promise<string | null> {
  try {
    const response = await fetchImpl(url);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/**
 * Henter friske overskrifter, hoejst et par gange i timen. Er cachen frisk,
 * bruges den; mislykkes en hentning, beholdes de sidst kendte frem for at
 * blanke ud. Gav stroemmen ingen overskrifter, beholdes de gamle ogsaa.
 */
export async function refreshNews(
  db: SqlDatabase,
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<News | null> {
  const cached = toCached(await getSetting(db, KEY_NEWS));
  if (cached !== null && now.getTime() - cached.fetchedAt < MAX_AGE_MS) {
    return cached.news;
  }

  const xml = await fetchText(fetchImpl, DR_RSS_URL);
  if (xml === null) return cached?.news ?? null;

  const headlines = parseNewsHeadlines(xml);
  if (headlines.length === 0) return cached?.news ?? null;

  const news: News = { headlines };
  await setSetting(db, KEY_NEWS, JSON.stringify({ news, fetchedAt: now.getTime() } satisfies CachedNews));
  return news;
}
