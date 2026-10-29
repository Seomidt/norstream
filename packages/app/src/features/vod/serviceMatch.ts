import type { VodKind } from '@norstream/core';
import type { HomeProvider } from '../../storage/settings.js';
import type { SqlDatabase } from '../../storage/types.js';
import { itemKeysByTmdbIds } from '../../storage/vod.js';
import { discoverTitles } from '../../sync/tmdbHome.js';
import type { TmdbFetch } from '../../sync/tmdb.js';
import type { TmdbTitle } from '../../sync/tmdbHome.js';
import { findInPanel } from '../home/panelMatch.js';
import { logEvent } from '../../diagnostics/log.js';

/**
 * "Netflix i din pakke" (v368): det en tjeneste har i Danmark lige nu, skaaret
 * ned til det panelet faktisk har. Brugeren: "vi skal kun se det vi har."
 *
 * TMDB's liste over tjenesten (de mest populaere, PAGES sider à 20) matches
 * mod pakken paa to maader: foerst paa TMDB-id for de titler der allerede er
 * slaaet op (plakat eller baggrundsjobbet), saa paa navn og aar som
 * forsidens "Fordi du saa …". Svaret huskes en time per tjeneste og slags.
 */
export const PAGES = 5;
const TTL_MS = 60 * 60_000;

interface Cached {
  at: number;
  keys: string[];
  /** Hvor mange titler tjenesten havde paa listen, til teksten "N af M". */
  listed: number;
}

const cache = new Map<string, Cached>();

export function resetServiceMatchForTests(): void {
  cache.clear();
}

export interface ServiceMatch {
  keys: string[];
  listed: number;
}

/** Panelets noegler for det tjenesterne har, forenet. */
export async function titlesInPackage(
  db: SqlDatabase,
  fetchImpl: TmdbFetch,
  apiKey: string,
  providers: readonly HomeProvider[],
  kind: VodKind,
  options: { pages?: number; now?: () => number } = {},
): Promise<ServiceMatch> {
  const now = options.now ?? Date.now;
  const keys = new Set<string>();
  let listed = 0;
  for (const provider of providers) {
    const one = await forProvider(db, fetchImpl, apiKey, provider, kind, options.pages ?? PAGES, now);
    for (const key of one.keys) keys.add(key);
    listed += one.listed;
  }
  return { keys: [...keys], listed };
}

async function forProvider(
  db: SqlDatabase,
  fetchImpl: TmdbFetch,
  apiKey: string,
  provider: HomeProvider,
  kind: VodKind,
  pages: number,
  now: () => number,
): Promise<Cached> {
  const cacheKey = `${provider.id}:${provider.region}:${kind}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined && now() - hit.at < TTL_MS) return hit;

  const titles: TmdbTitle[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= pages; page += 1) {
    const chunk = await discoverTitles(fetchImpl, apiKey, provider.id, kind, provider.region, page);
    if (chunk.length === 0) break;
    for (const title of chunk) {
      if (!seen.has(title.id)) {
        seen.add(title.id);
        titles.push(title);
      }
    }
  }

  // Foerst paa id — ét opslag for alle — saa paa navn for resten.
  const byId = await itemKeysByTmdbIds(db, kind, titles.map((title) => title.id));
  const keys: string[] = [];
  let byName = 0;
  for (const title of titles) {
    const known = byId.get(title.id);
    if (known !== undefined) {
      keys.push(known);
      continue;
    }
    const item = await findInPanel(db, title).catch(() => null);
    if (item !== null) {
      keys.push(item.key);
      byName += 1;
    }
  }
  const result: Cached = { at: now(), keys: [...new Set(keys)], listed: titles.length };
  cache.set(cacheKey, result);
  logEvent('baggrund', `tjeneste ${provider.name} (${kind === 'movie' ? 'film' : 'serier'}): ${titles.length} paa listen, ${result.keys.length} i pakken (${byName} paa navn)`);
  return result;
}
