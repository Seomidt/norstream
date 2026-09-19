import { XtreamClient } from '@norstream/core';
import type { FetchLike, VodDetails, XtreamCredentials } from '@norstream/core';
import type { SqlDatabase } from '../storage/types.js';
import {
  DETAILS_MAX_AGE_MS,
  adoptDetailsPoster,
  getVodDetails,
  replaceEpisodes,
  saveVodDetails,
} from '../storage/vod.js';
import type { StoredVodItem } from '../storage/vod.js';
import { getVodItem } from '../storage/vod.js';
import { listFollowedSeriesKeys } from '../storage/followedSeries.js';

/**
 * Det panelet ved om én titel — fra databasen naar det er friskt nok, ellers
 * fra panelet.
 *
 * Ét kald per titel, og kun naar titlen aabnes. Alternativet — at hente det
 * for alle titler ved synkroniseringen — er ti tusind kald for at fylde en
 * skaerm man maaske aldrig aabner.
 *
 * Fejler panelet, gives det man har: en uge gammel handling er stadig
 * handlingen. Er der intet gemt, kastes der videre, saa skaermen kan sige det.
 */
export async function ensureVodDetails(
  db: SqlDatabase,
  item: StoredVodItem,
  creds: XtreamCredentials | null,
  fetchImpl: FetchLike,
  now: Date = new Date(),
  maxAgeMs: number = DETAILS_MAX_AGE_MS,
): Promise<VodDetails> {
  const cached = await getVodDetails(db, item.key);
  const fresh = cached !== null && now.getTime() - cached.fetchedAt.getTime() < maxAgeMs;
  if (fresh) return cached.details;
  if (creds === null) {
    if (cached !== null) return cached.details;
    throw new Error('Adgangsoplysningerne til kilden mangler paa enheden.');
  }

  try {
    const client = new XtreamClient(creds, fetchImpl);
    if (item.kind === 'series') {
      const { details, episodes } = await client.getSeriesInfo(item.id);
      await saveVodDetails(db, item.key, details, now);
      await replaceEpisodes(db, item.key, episodes);
      await adoptDetailsPoster(db, item.key, details.posterUrl);
      return details;
    }
    const details = await client.getVodInfo(item.id);
    await saveVodDetails(db, item.key, details, now);
    await adoptDetailsPoster(db, item.key, details.posterUrl);
    return details;
  } catch (cause) {
    if (cached !== null) return cached.details;
    throw cause;
  }
}

/** Fulgte serier holdes friske ved hver synkronisering, saa "nye afsnit" paa forsiden passer. */
const FOLLOWED_MAX_AGE_MS = 6 * 60 * 60_000;

/**
 * Henter afsnitlisten igen for de serier man foelger fra denne kilde.
 * Ét kald per fulgt serie, hoejst hver sjette time; alle andre serier
 * hentes stadig kun naar de aabnes.
 */
export async function refreshFollowedSeries(
  db: SqlDatabase,
  sourceId: string,
  creds: XtreamCredentials,
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<void> {
  const keys = (await listFollowedSeriesKeys(db)).filter((key) => key.startsWith(`${sourceId}:`));
  for (const key of keys) {
    const item = await getVodItem(db, key);
    if (item === null || item.kind !== 'series') continue;
    try {
      await ensureVodDetails(db, item, creds, fetchImpl, now, FOLLOWED_MAX_AGE_MS);
    } catch {
      // Naeste gang.
    }
  }
}
