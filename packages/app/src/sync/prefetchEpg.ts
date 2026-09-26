import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { listChannels } from '../storage/channels.js';
import { getSetting, setSetting } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';
import { ensureFullEpg } from './epgCache.js';

/** Én gang i doegnet. Programtabellen aendrer sig ikke oftere. */
export const PREFETCH_INTERVAL_MS = 24 * 60 * 60_000;
const KEY = 'last_epg_prefetch_ms';

/**
 * Henter hele programtabellen for **favoritterne** paa forhaand.
 *
 * Guiden og kanallisten henter selv for de raekker der er fremme, men det
 * betyder at man venter paa panelet hver gang man ruller til nye raekker, og
 * at man ser et tomt gitter foerst. Favoritterne er den maengde guiden viser,
 * og den er lille nok — snesevis, ikke tusinder — til at hentes samlet én
 * gang i doegnet, i baggrunden, saa gitteret er fyldt naar man aabner det.
 *
 * Aldrig for alle 22.142 kanaler: det ville vaere 22.142 kald.
 *
 * `ensureFullEpg` springer selv de kanaler over hvis tabel er frisk, saa
 * det her koster kun de kald der faktisk mangler.
 */
export async function prefetchFavouritesEpg(
  db: SqlDatabase,
  credsBySource: ReadonlyMap<string, XtreamCredentials>,
  fetchImpl: FetchLike,
  now: Date = new Date(),
  force = false,
): Promise<{ fetched: number; skipped: boolean }> {
  const last = await getSetting(db, KEY);
  const lastMs = last === null ? null : Number.parseInt(last, 10);
  if (!force && lastMs !== null && Number.isFinite(lastMs) && now.getTime() - lastMs < PREFETCH_INTERVAL_MS) {
    return { fetched: 0, skipped: true };
  }

  const favourites = await listChannels(db, { favouritesOnly: true });
  let fetched = 0;
  if (favourites.length > 0) {
    const result = await ensureFullEpg(db, credsBySource, fetchImpl, favourites, now);
    fetched = result.fetched;
  }
  await setSetting(db, KEY, String(now.getTime()));
  return { fetched, skipped: false };
}
