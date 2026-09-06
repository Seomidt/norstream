import { XtreamAuthError, XtreamClient } from '@norstream/core';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { maxArchiveDays } from '../storage/channels.js';
import {
  getArchiveFetchedAt,
  getEpgFreshness,
  markArchiveFetched,
  markEpgFetched,
  needsArchiveFetch,
  needsEpgFetch,
} from '../storage/epgFetch.js';
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

/**
 * Hvor lidt vi altid beholder, ogsaa naar ingen kanal har arkiv. Tolv timer
 * daekker "hvad var det jeg saa i aftes" i guiden.
 */
const MIN_RETENTION_HOURS = 12;

/** En dags luft oven i arkivet, saa graensetilfaeldet ikke ryger paa gulvet. */
const RETENTION_MARGIN_DAYS = 1;

/**
 * Hvor langt tilbage programdata skal beholdes.
 *
 * Reglen foelger arkivet, ikke et fast tal: et program uden for panelets
 * arkivperiode kan alligevel ikke startes, saa det er doed vaegt i databasen.
 * Omvendt ville den gamle faste 12-timers graense slette praecis de
 * udsendelser arkivet lever af — for saa vidt de overhovedet naaede at blive
 * gemt.
 */
export function retentionCutoff(now: Date, archiveDays: number): Date {
  const fromArchive = (archiveDays + RETENTION_MARGIN_DAYS) * 24;
  const hours = Math.max(MIN_RETENTION_HOURS, archiveDays > 0 ? fromArchive : 0);
  return new Date(now.getTime() - hours * 60 * 60_000);
}

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
    await deleteProgrammesBefore(db, retentionCutoff(now, await maxArchiveDays(db)));
  }

  return { fetched, programmes };
}

/**
 * Henter hele programtabellen for de viste kanaler, saa guiden kan vise baade
 * fortiden og resten af doegnet.
 *
 * `get_short_epg` giver tolv programmer fremad og intet bagud. Det raekker til
 * "nu og naeste" og ikke til en guide: bladrer man to sider frem eller én
 * tilbage, staar cellerne tomme, og en udsendelse der allerede er sendt kan
 * ikke startes — ikke fordi arkivet mangler, men fordi appen ikke ved at
 * udsendelsen har fundet sted.
 *
 * Hentes for **alle** viste kanaler, ikke kun dem med arkiv. Det var
 * begraensningen foer, og den kostede programdata paa hver eneste kanal uden
 * arkiv — som er de fleste. Kun de raekker der er fremme hentes, og hoejst hver
 * sjette time per kanal.
 *
 * Fejl per kanal sluges som i `ensureEpg`; `XtreamAuthError` kastes videre.
 */
export async function ensureFullEpg(
  db: SqlDatabase,
  creds: XtreamCredentials,
  fetchImpl: FetchLike,
  channels: readonly { id: string }[],
  now: Date = new Date(),
): Promise<EnsureEpgResult> {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const channel of channels) {
    if (channel.id.length === 0 || seen.has(channel.id)) continue;
    seen.add(channel.id);
    if (needsArchiveFetch(await getArchiveFetchedAt(db, channel.id), now)) {
      candidates.push(channel.id);
    }
  }
  if (candidates.length === 0) return { fetched: 0, programmes: 0 };

  const client = new XtreamClient(creds, fetchImpl);
  let authFailure: XtreamAuthError | null = null;
  let fetched = 0;
  let programmes = 0;

  await runBounded(candidates, MAX_PARALLEL, () => authFailure !== null, async (streamId) => {
    let batch;
    try {
      batch = await client.getFullEpg(streamId);
    } catch (cause) {
      if (cause instanceof XtreamAuthError) authFailure = cause;
      return;
    }

    await upsertProgrammes(db, batch);
    await markArchiveFetched(db, streamId, now);
    fetched += 1;
    programmes += batch.length;
  });

  if (authFailure !== null) throw authFailure;
  return { fetched, programmes };
}
