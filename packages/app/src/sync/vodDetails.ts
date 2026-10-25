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
import { listFollowedSeriesKeys, prepareFollowedSeries, reconcileFollowedSeries } from '../storage/followedSeries.js';
import { withTransaction } from '../storage/transaction.js';

const pendingDetails = new WeakMap<SqlDatabase, Map<string, Promise<VodDetails>>>();

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
  if (item.kind === 'series') await prepareFollowedSeries(db, item.key, now.getTime());
  const cached = await getVodDetails(db, item.key);
  const fresh = cached !== null && now.getTime() - cached.fetchedAt.getTime() < maxAgeMs;
  if (fresh) return cached.details;
  if (creds === null) {
    if (cached !== null) return cached.details;
    throw new Error('Adgangsoplysningerne til kilden mangler paa enheden.');
  }

  let pending = pendingDetails.get(db);
  if (pending === undefined) { pending = new Map(); pendingDetails.set(db, pending); }
  const existing = pending.get(item.key);
  if (existing !== undefined) return existing;
  const operation = (async () => {
    try {
      const client = new XtreamClient(creds, fetchImpl);
      if (item.kind === 'series') {
        const { details, episodes } = await client.getSeriesInfo(item.id);
        if (episodes.length === 0) {
          const known = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM episodes WHERE series_key = ?', [item.key]);
          if ((known?.n ?? 0) > 0) throw new Error('Panelet returnerede en tom afsnitliste; beholder den gemte liste.');
        }
        await withTransaction(db, async () => {
          await saveVodDetails(db, item.key, details, now);
          await replaceEpisodes(db, item.key, episodes);
          await reconcileFollowedSeries(db, item.key, now.getTime());
        });
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
  })().finally(() => {
    if (pending!.get(item.key) === operation) pending!.delete(item.key);
  });
  pending.set(item.key, operation);
  return operation;
}

/** Kun serieoplysninger hentes; ingen mediestroem eller fuld katalogsynk. */
export const FOLLOWED_MAX_AGE_MS = 6 * 60 * 60_000;
const FAILURE_RETRY_MS = 5 * 60_000;
const inFlight = new WeakMap<SqlDatabase, Map<string, Promise<number>>>();
const retryAfter = new WeakMap<SqlDatabase, Map<string, number>>();

/** Et kald per fulgt serie, hoejst hver sjette time efter vellykket svar.
 * Samtidige opstart/resume/synk-kald deler det samme arbejde per kilde. */
export function refreshFollowedSeries(
  db: SqlDatabase,
  sourceId: string,
  creds: XtreamCredentials,
  fetchImpl: FetchLike,
  now: Date = new Date(),
  shouldContinue: () => boolean = () => true,
): Promise<number> {
  let pending = inFlight.get(db);
  if (pending === undefined) { pending = new Map(); inFlight.set(db, pending); }
  const existing = pending.get(sourceId);
  if (existing !== undefined) return existing;
  const operation = refresh(db, sourceId, creds, fetchImpl, now, shouldContinue).finally(() => {
    if (pending!.get(sourceId) === operation) pending!.delete(sourceId);
  });
  pending.set(sourceId, operation);
  return operation;
}

async function refresh(db: SqlDatabase, sourceId: string, creds: XtreamCredentials,
  fetchImpl: FetchLike, now: Date, shouldContinue: () => boolean): Promise<number> {
  let retries = retryAfter.get(db);
  if (retries === undefined) { retries = new Map(); retryAfter.set(db, retries); }
  const keys = (await listFollowedSeriesKeys(db)).filter(key => key.startsWith(`${sourceId}:`));
  let updated = 0;
  for (const key of keys) {
    if (!shouldContinue()) break;
    if ((retries.get(key) ?? 0) > now.getTime()) continue;
    const item = await getVodItem(db, key);
    if (item === null || item.kind !== 'series') continue;
    const previous = await getVodDetails(db, key);
    if (previous !== null && now.getTime() - previous.fetchedAt.getTime() < FOLLOWED_MAX_AGE_MS) continue;
    try {
      await ensureVodDetails(db, item, creds, fetchImpl, now, FOLLOWED_MAX_AGE_MS);
      const current = await getVodDetails(db, key);
      if (current !== null && current.fetchedAt.getTime() === now.getTime()) {
        updated += 1;
        retries.delete(key);
      } else retries.set(key, now.getTime() + FAILURE_RETRY_MS);
    } catch {
      retries.set(key, now.getTime() + FAILURE_RETRY_MS);
    }
  }
  return updated;
}
