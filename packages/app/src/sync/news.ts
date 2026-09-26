import { parseNewsItems } from '@norstream/core';
import { getSetting, setSetting } from '../storage/settings.js';
import type { HeaderFetch } from '../net/doh.js';
import type { SqlDatabase } from '../storage/types.js';

/**
 * Nyhederne til guidens nyhedsstribe. Overskrifterne hentes fra DR's RSS
 * (gratis, ingen noegle) og oversaettes af core. Alt sluges stille: fejler
 * noget, vises der bare de sidst kendte overskrifter — aldrig en raa fejl.
 */

/** Én overskrift til striben: teksten, et kort maerke (kategori/kilde) og breaking-flag. */
export interface NewsHeadline {
  text: string;
  label: string;
  breaking: boolean;
}

export interface News {
  headlines: NewsHeadline[];
}

/** Feeds vi henter fra. Hver har et standardmaerke, der bruges naar en nyhed
 *  ikke selv angiver en kategori. DR-kategori-feeds giver variationen (INDLAND,
 *  UDLAND, SPORT) ogsaa naar de enkelte nyheder ikke selv er kategoriseret; TV2
 *  er med som ekstra kilde. Svarer en feed ikke (404/403/tom), springes den bare
 *  over — striben koerer videre paa dem der virker. */
interface Feed {
  url: string;
  label: string;
}

// Maalt paa en maskine med frit internet (scripts/maal/nyhedsfeeds.mjs):
// DR's nyheder baerer INGEN <category>, saa maerket kommer fra hvilken sektion
// de hentes fra — derfor sektionerne direkte, ikke "allenyheder" (som er
// foreningen af dem alle og ville snuppe alt med ét generisk DR-maerke via
// dublet-lugningen). TV2 tilbyder ikke laengere et offentligt RSS (alt 404),
// saa Politiken er med som en aegte anden avis.
const FEEDS: readonly Feed[] = [
  { url: 'https://www.dr.dk/nyheder/service/feeds/indland', label: 'INDLAND' },
  { url: 'https://www.dr.dk/nyheder/service/feeds/udland', label: 'UDLAND' },
  { url: 'https://www.dr.dk/nyheder/service/feeds/sporten', label: 'SPORT' },
  { url: 'https://www.dr.dk/nyheder/service/feeds/penge', label: 'PENGE' },
  { url: 'https://www.dr.dk/nyheder/service/feeds/politik', label: 'POLITIK' },
  { url: 'https://politiken.dk/rss/senestenyt.rss', label: 'POLITIKEN' },
];

/** Hvor mange overskrifter striben hoejst faar, naar flere feeds er flettet sammen. */
const MAX_TICKER = 18;

// _v3: kilderne skiftede (DR-sektioner + Politiken i stedet for allenyheder+TV2).
// En frisk noegle sikrer at det slaar igennem straks — ellers viste en gammel
// DR-only-kopi sig, indtil den var 20 min gammel ("der er kun DR").
const KEY_NEWS = 'news_cache_v3';
/** Hentes hoejst et par gange i timen; overskrifterne skifter ikke hurtigere. */
const MAX_AGE_MS = 20 * 60_000;
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
      .map((h) => ({
        text: h.text,
        label: typeof h.label === 'string' && h.label.length > 0 ? h.label : 'DR',
        breaking: h.breaking === true,
      }));
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
/** Fletter flere kilders lister sammen skiftevis, saa striben ikke bliver
 *  alle-DR-saa-alle-TV2, men veksler mellem kilderne. */
function interleave(lists: readonly NewsHeadline[][]): NewsHeadline[] {
  const out: NewsHeadline[] = [];
  const longest = lists.reduce((max, list) => Math.max(max, list.length), 0);
  for (let i = 0; i < longest; i += 1) {
    for (const list of lists) {
      const item = list[i];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

/**
 * Henter friske overskrifter fra alle feeds, hoejst et par gange i timen. Er
 * cachen frisk, bruges den; svarer en feed ikke, springes den over. Kom der
 * intet fra nogen af dem, beholdes de sidst kendte frem for at blanke ud.
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

  const perFeed = await Promise.all(
    FEEDS.map(async (feed): Promise<NewsHeadline[]> => {
      const xml = await fetchText(fetchImpl, feed.url);
      if (xml === null) return [];
      return parseNewsItems(xml).map((item) => ({
        text: item.title,
        label: item.category ?? feed.label,
        breaking: item.breaking,
      }));
    }),
  );

  // Fletning + dubletter luget fra (samme historie staar tit i flere feeds).
  const seen = new Set<string>();
  const headlines: NewsHeadline[] = [];
  for (const headline of interleave(perFeed)) {
    const key = headline.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    headlines.push(headline);
    if (headlines.length >= MAX_TICKER) break;
  }

  if (headlines.length === 0) return cached?.news ?? null;

  const news: News = { headlines };
  await setSetting(db, KEY_NEWS, JSON.stringify({ news, fetchedAt: now.getTime() } satisfies CachedNews));
  return news;
}
