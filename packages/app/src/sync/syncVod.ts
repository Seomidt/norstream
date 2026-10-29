import { XtreamClient } from '@norstream/core';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { getSetting, setSetting } from '../storage/settings.js';
import type { SqlDatabase } from '../storage/types.js';
import { countVodItems, replaceVodCategories, replaceVodItems } from '../storage/vod.js';

/**
 * Henter kildens film- og serielister.
 *
 * Fire kald: kategorier og liste for hver af de to slags. Listerne kan vaere
 * paa tusindvis af poster, men det er ét kald hver — det dyre er det panelet
 * ved om den enkelte titel, og det hentes foerst naar titlen aabnes.
 *
 * Fejler film, hentes serier stadig, og omvendt: et panel uden serier er ikke
 * et panel uden film.
 */
export async function syncVod(
  db: SqlDatabase,
  sourceId: string,
  creds: XtreamCredentials,
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<{ movies: number; series: number }> {
  const client = new XtreamClient(creds, fetchImpl);
  const result = { movies: 0, series: 0 };
  /** Hvad der gik galt, til indstillingerne. Uden det saa et tomt filkatalog ud som "ikke hentet endnu" i det uendelige. */
  const errors: string[] = [];

  try {
    // Efter hinanden, ikke samtidig: panelet tillader én forbindelse, og
    // samtidige kald var med til at faa det til at blokere adressen.
    const categories = await client.getVodCategories();
    const movies = await client.getVodStreams();
    // Et tomt svar er ikke det samme som et panel uden film. Panelet svarer
    // undertiden 200 med en tom liste naar det er travlt; skete det, tromlede
    // et helt filkatalog vaek indtil naeste hentning. Er der film i forvejen,
    // beholder vi dem og noterer det i stedet.
    const had = await countVodItems(db, sourceId, 'movie');
    if (movies.length === 0 && had > 0) {
      result.movies = had;
      errors.push('film: tomt svar fra panelet, beholdt de gamle');
    } else {
      if (categories.length > 0) await replaceVodCategories(db, sourceId, 'movie', categories);
      await replaceVodItems(db, sourceId, 'movie', movies);
      result.movies = movies.length;
    }
  } catch (cause) {
    // Med vilje: se ovenfor.
    errors.push(`film: ${describeError(cause)}`);
  }

  try {
    const categories = await client.getSeriesCategories();
    const series = await client.getSeries();
    const had = await countVodItems(db, sourceId, 'series');
    if (series.length === 0 && had > 0) {
      result.series = had;
      errors.push('serier: tomt svar fra panelet, beholdt de gamle');
    } else {
      if (categories.length > 0) await replaceVodCategories(db, sourceId, 'series', categories);
      await replaceVodItems(db, sourceId, 'series', series);
      result.series = series.length;
    }
  } catch (cause) {
    // Med vilje.
    errors.push(`serier: ${describeError(cause)}`);
  }

  await setSetting(db, `last_vod_sync_ms:${sourceId}`, String(now.getTime()));
  await setSetting(db, `last_vod_error:${sourceId}`, errors.join(', '));
  return result;
}

/** Fejlen i ord, uden adresser: en panel-URL rummer brugernavn og kodeord. */
export function describeError(cause: unknown): string {
  const text = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return text.replace(/https?:\/\/\S+/gi, '[adresse]').slice(0, 160);
}

export async function getLastVodSyncMs(db: SqlDatabase, sourceId: string): Promise<number | null> {
  const value = await getSetting(db, `last_vod_sync_ms:${sourceId}`);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
