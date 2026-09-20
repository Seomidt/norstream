import { parseNewsItems } from '@norstream/core';
import { getSetting, setSetting } from '../storage/settings.js';
import type { HeaderFetch } from '../net/doh.js';
import type { SqlDatabase } from '../storage/types.js';

/**
 * Nyhederne til guidens nyhedsstribe. Overskrifterne hentes fra DR's RSS
 * (gratis, ingen noegle) og oversaettes af core. Alt sluges stille: fejler
 * noget, vises der bare de sidst kendte overskrifter — aldrig en raa fejl.
 */

/** Én overskrift til striben: teksten og et kort maerke (kategori eller "DR"). */
export interface NewsHeadline {
  text: string;
  label: string;
}

export interface News {
  headlines: NewsHeadline[];
}

/** Kildens standardmaerke, naar en nyhed ikke selv angav en kategori. */
const DEFAULT_LABEL = 'DR';

// _v2: formen skiftede (fra string[] til {text,label}), og hentningen sender nu
// en User-Agent. En frisk noegle undgaar at en gammel, tom-fortolket kopi vises.
const KEY_NEWS = 'news_cache_v2';
/** Hentes hoejst et par gange i timen; overskrifterne skifter ikke hurtigere. */
const MAX_AGE_MS = 20 * 60_000;
/** DR's offentlige nyhedsstroem — gratis og uden legitimation. */
const DR_RSS_URL = 'https://www.dr.dk/nyheder/service/feeds/allenyheder';
/**
 * DR's server (Akamai) svarer 403 — eller en samtykke-side helt uden <item> —
 * paa et kald uden en browser-agtig User-Agent. Derfor kom der vejr men ingen
 * nyheder: vejrtjenesterne er ligeglade, det er DR ikke. Et almindeligt
 * Accept-hoved til med, saa vi faar RSS og ikke andet.
 */
const RSS_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Linux; Android 12; NorStream) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
  Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
};

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
    const headlines = (parsed.news as News).headlines
      .filter(
        (h): h is NewsHeadline =>
          typeof h === 'object' && h !== null && typeof (h as NewsHeadline).text === 'string',
      )
      .map((h) => ({ text: h.text, label: typeof h.label === 'string' && h.label.length > 0 ? h.label : DEFAULT_LABEL }));
    return { news: { headlines }, fetchedAt: parsed.fetchedAt };
  } catch {
    return null;
  }
}

/** De senest gemte overskrifter, saa striben kan vise noget straks. */
export async function loadCachedNews(db: SqlDatabase): Promise<News | null> {
  return toCached(await getSetting(db, KEY_NEWS))?.news ?? null;
}

/** Hvornaar nyhederne sidst blev hentet, til status-linjen i Indstillinger. */
export async function newsFetchedAt(db: SqlDatabase): Promise<number | null> {
  return toCached(await getSetting(db, KEY_NEWS))?.fetchedAt ?? null;
}

async function fetchText(fetchImpl: HeaderFetch, url: string): Promise<string | null> {
  try {
    const response = await fetchImpl(url, RSS_HEADERS);
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
  fetchImpl: HeaderFetch,
  now: Date = new Date(),
): Promise<News | null> {
  const cached = toCached(await getSetting(db, KEY_NEWS));
  if (cached !== null && now.getTime() - cached.fetchedAt < MAX_AGE_MS) {
    return cached.news;
  }

  const xml = await fetchText(fetchImpl, DR_RSS_URL);
  if (xml === null) return cached?.news ?? null;

  const items = parseNewsItems(xml);
  if (items.length === 0) return cached?.news ?? null;

  const headlines: NewsHeadline[] = items.map((item) => ({
    text: item.title,
    label: item.category ?? DEFAULT_LABEL,
  }));
  const news: News = { headlines };
  await setSetting(db, KEY_NEWS, JSON.stringify({ news, fetchedAt: now.getTime() } satisfies CachedNews));
  return news;
}
