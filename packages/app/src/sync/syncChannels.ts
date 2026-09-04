import { XtreamClient } from '@uhf-play/core';
import type { FetchLike, XtreamCredentials } from '@uhf-play/core';
import { replaceCategories, replaceChannels } from '../storage/channels.js';
import { setLastSyncMs } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';

/**
 * Henter panelets kategorier og kanaler og skriver dem til databasen.
 *
 * Begge kald sker foer den foerste skrivning: fejler panelet undervejs,
 * kaster funktionen uden at have roert cachen, saa appen kan blive ved med
 * at koere paa de data den allerede har.
 */
export async function syncChannels(
  db: SqlDatabase,
  creds: XtreamCredentials,
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<{ categories: number; channels: number }> {
  const client = new XtreamClient(creds, fetchImpl);

  const categories = await client.getLiveCategories();
  const channels = await client.getLiveStreams();

  await replaceCategories(db, categories);
  await replaceChannels(db, channels);
  await setLastSyncMs(db, now.getTime());

  return { categories: categories.length, channels: channels.length };
}
