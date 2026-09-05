import { XtreamAuthError, XtreamClient } from '@norstream/core';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { getEpgFreshness, markEpgFetched, needsEpgFetch } from '../storage/epgFetch.js';
import { deleteProgrammesBefore, upsertProgrammes } from '../storage/programmes.js';
import type { SqlDatabase } from '../storage/types.js';

/**
 * Hvor mange programmer der hentes per kanal. Tolv daekker et halvt til et helt
 * doegn paa de fleste kanaler og holder svaret paa faa kilobyte.
 */
const DEFAULT_LIMIT = 12;

/**
 * Hoejst fire kald i luften ad gangen.
 *
 * Panelets `max_connections: 1` gaelder streams, ikke `player_api.php` — men en
 * ubegraenset fan-out over en synlig guide-side ville stadig vaere uartig mod et
 * panel der er langsomt nok til at have en 98 MB XMLTV-fil.
 */
const MAX_PARALLEL = 4;

/** Som i XMLTV-vejen: programmer der sluttede for over 12 timer siden ryddes. */
const RETENTION_HOURS = 12;

export interface EnsureEpgResult {
  /** Antal kanaler der faktisk blev hentet for. */
  fetched: number;
  /** Antal programmer skrevet til databasen. */
  programmes: number;
}

/**
 * Koerer `worker` over `items` med hoejst `limit` samtidige kald. Stopper
 * saa snart `shouldStop` bliver sand, saa en afvist login ikke foerst skal
 * igennem resten af listen.
 */
async function runBounded<T>(
  items: readonly T[],
  limit: number,
  shouldStop: () => boolean,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      if (shouldStop()) return;
      const index = next;
      next += 1;
      const item = items[index];
      if (index >= items.length || item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Sikrer at de angivne kanaler har frisk EPG, og henter kun for dem der
 * mangler den.
 *
 * Dette er hele erstatningen for XMLTV-vejen. `get_short_epg` slaar op paa
 * `stream_id`, som alle kanaler har, i stedet for `epg_channel_id`, som 87 %
 * mangler — og svaret er faa kilobyte i stedet for 98 MB, der aldrig naaede
 * frem inden for en timeout.
 *
 * `XtreamAuthError` kastes videre: appen skal kunne rydde keychain og sende
 * brugeren til onboarding. Alle andre fejl sluges per kanal, saa én doed kanal
 * ikke tager programdata fra resten af skaermen.
 *
 * `now` er eksplicit. Bruges vaeguret her, bestaar testene den ene dag og
 * fejler den naeste — det er sket foer i netop dette lag.
 */
export async function ensureEpg(
  db: SqlDatabase,
  creds: XtreamCredentials,
  fetchImpl: FetchLike,
  streamIds: readonly string[],
  now: Date = new Date(),
  limit: number = DEFAULT_LIMIT,
): Promise<EnsureEpgResult> {
  const unique = [...new Set(streamIds)].filter((id) => id.length > 0);

  const stale: string[] = [];
  for (const streamId of unique) {
    if (needsEpgFetch(await getEpgFreshness(db, streamId), now)) stale.push(streamId);
  }
  if (stale.length === 0) return { fetched: 0, programmes: 0 };

  const client = new XtreamClient(creds, fetchImpl);
  let authFailure: XtreamAuthError | null = null;
  let fetched = 0;
  let programmes = 0;

  await runBounded(stale, MAX_PARALLEL, () => authFailure !== null, async (streamId) => {
    let batch;
    try {
      batch = await client.getShortEpg(streamId, limit);
    } catch (cause) {
      if (cause instanceof XtreamAuthError) authFailure = cause;
      // Netvaerksfejl paa én kanal er ikke fatalt: de oevrige skal stadig
      // have deres programdata. Kanalen mangler blot indtil naeste forsoeg.
      return;
    }

    await upsertProgrammes(db, batch);
    // Ogsaa naar batch er tom: se needsEpgFetch's regel 1. Uden dette ville
    // en kanal uden programdata blive hentet igen ved hver rendering.
    await markEpgFetched(db, streamId, now);
    fetched += 1;
    programmes += batch.length;
  });

  if (authFailure !== null) throw authFailure;

  // Ryd kun naar vi faktisk fik noget. Ellers ville en tur hvor panelet var
  // nede slette den EPG appen allerede havde, uden noget at saette i stedet.
  if (programmes > 0) {
    await deleteProgrammesBefore(db, new Date(now.getTime() - RETENTION_HOURS * 60 * 60_000));
  }

  return { fetched, programmes };
}
