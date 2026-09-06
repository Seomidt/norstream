import { XtreamClient, deriveCountryLoose } from '@norstream/core';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
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
  sourceId: string,
  creds: XtreamCredentials,
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<{ categories: number; channels: number }> {
  const client = new XtreamClient(creds, fetchImpl);

  const categories = await client.getLiveCategories();
  const channels = await client.getLiveStreams();

  // Landet per kategori udledes her og foelger med ned paa hver kanal: det er
  // den halvdel af noeglen ind i logo-registret som SQL ikke kan regne ud.
  const countryByCategory = new Map<string, string>();
  for (const category of categories) {
    const country = deriveCountryLoose(category.name);
    if (country !== null) countryByCategory.set(category.id, country.code);
  }

  await replaceCategories(db, sourceId, categories);
  await replaceChannels(db, sourceId, channels, undefined, countryByCategory);
  await setLastSyncMs(db, now.getTime(), sourceId);

  return { categories: categories.length, channels: channels.length };
}
