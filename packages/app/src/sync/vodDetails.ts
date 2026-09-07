import { XtreamClient } from '@norstream/core';
import type { FetchLike, VodDetails, XtreamCredentials } from '@norstream/core';
import type { SqlDatabase } from '../storage/types.js';
import {
  DETAILS_MAX_AGE_MS,
  getVodDetails,
  replaceEpisodes,
  saveVodDetails,
} from '../storage/vod.js';
import type { StoredVodItem } from '../storage/vod.js';

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
): Promise<VodDetails> {
  const cached = await getVodDetails(db, item.key);
  const fresh = cached !== null && now.getTime() - cached.fetchedAt.getTime() < DETAILS_MAX_AGE_MS;
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
      return details;
    }
    const details = await client.getVodInfo(item.id);
    await saveVodDetails(db, item.key, details, now);
    return details;
  } catch (cause) {
    if (cached !== null) return cached.details;
    throw cause;
  }
}
