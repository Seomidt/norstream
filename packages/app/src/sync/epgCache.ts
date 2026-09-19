import { XtreamAuthError, XtreamClient, parseChannelKey } from '@norstream/core';
import type { FetchLike, XtreamCredentials } from '@norstream/core';
import { groupBySource } from '../sources/access.js';
import { maxArchiveDays } from '../storage/channels.js';
import {
  getArchiveFetchedAt,
  getEpgFreshness,
  markArchiveFetched,
  markEpgFetched,
  needsArchiveFetch,
  needsShortEpg,
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
// Ét ad gangen. Fire ad gangen fik brugerens panel til at blokere adressen
// og svare 403 paa alt — ogsaa paa det naeste login. Panelet tillader én
// stroem; det taeller tilsyneladende ogsaa API-kald.
const MAX_PARALLEL = 1;
/** En kort pause mellem kaldene, saa en byge ikke ligner et angreb. */
const PAUSE_MS = 150;

/**
 * Hvor mange dage bagud guiden OG dagssiden viser (DRAG_MIN_MINUTES = 7 dage,
 * MAX_DAYS_BACK = 7). Programdata inden for dette vindue maa ALDRIG slettes,
 * uanset arkivet: ellers viste guiden en udsendelse fra i forgaars (hentet og
 * lige lagt i cachen), mens dagssiden bagefter laeste en beskaaret database og
 * stod naesten tom. Selve *start-forfra* er stadig kun muligt inden for
 * arkivet (styret pr. udsendelse), men at KUNNE VISE oversigten koster kun
 * nogle faa kilobyte og skal daekke hele det vindue man kan bladre i.
 */
const DISPLAY_RETENTION_DAYS = 7;

/** En dags luft oven i arkivet, saa graensetilfaeldet ikke ryger paa gulvet. */
const RETENTION_MARGIN_DAYS = 1;

/**
 * Hvor langt tilbage programdata skal beholdes.
 *
 * Mindst hele det vindue guiden og dagssiden kan bladre i (7 dage), saa de to
 * skaerme aldrig er uenige om hvor langt tilbage der er data. Har en kanal et
 * laengere arkiv end det, beholdes tilsvarende mere (arkivet + en dags luft).
 * Foer fulgte graensen kun arkivet (eller faldt til 12 timer naar panelet ikke
 * oplyste arkivdage), og saa slettede oprydningen praecis de dage guiden viste.
 */
export function retentionCutoff(now: Date, archiveDays: number): Date {
  const fromArchive = (archiveDays + RETENTION_MARGIN_DAYS) * 24;
  const hours = Math.max(DISPLAY_RETENTION_DAYS * 24, fromArchive);
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
      if (PAUSE_MS > 0) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
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
  credsBySource: ReadonlyMap<string, XtreamCredentials>,
  fetchImpl: FetchLike,
  channelKeys: readonly string[],
  now: Date = new Date(),
  limit: number = DEFAULT_LIMIT,
): Promise<EnsureEpgResult> {
  const unique = [...new Set(channelKeys)].filter((id) => id.length > 0);

  const stale: string[] = [];
  for (const key of unique) {
    const [freshness, archiveAt] = await Promise.all([
      getEpgFreshness(db, key),
      getArchiveFetchedAt(db, key),
    ]);
    if (needsShortEpg(freshness, archiveAt, now)) stale.push(key);
  }
  if (stale.length === 0) return { fetched: 0, programmes: 0 };

  let authFailure: XtreamAuthError | null = null;
  let fetched = 0;
  let programmes = 0;

  // Noeglerne kan komme fra flere paneler ad gangen — guiden viser favoritter,
  // og de ligger ikke noedvendigvis samme sted. Spurgte vi det ene panel om
  // det andets kanaler, ville svaret vaere tomt og ikke til at skelne fra
  // "ingen programdata".
  for (const [sourceId, keys] of groupBySource(stale)) {
    const creds = credsBySource.get(sourceId);
    // M3U-kilder har ingen EPG-API. Deres programdata kommer fra XMLTV.
    if (creds === undefined) continue;
    const client = new XtreamClient(creds, fetchImpl);

  await runBounded(keys, MAX_PARALLEL, () => authFailure !== null, async (key) => {
    const streamId = parseChannelKey(key)?.streamId ?? key;
    let batch;
    try {
      batch = await client.getShortEpg(streamId, limit);
    } catch (cause) {
      if (cause instanceof XtreamAuthError) authFailure = cause;
      // Netvaerksfejl paa én kanal er ikke fatalt: de oevrige skal stadig
      // have deres programdata. Kanalen mangler blot indtil naeste forsoeg.
      return;
    }

    // Programmerne gemmes under den sammensatte noegle, ikke under panelets
    // eget id: to paneler har begge en kanal 1.
    await upsertProgrammes(db, batch.map((p) => ({ ...p, channelId: key })));
    // Ogsaa naar batch er tom: se needsEpgFetch's regel 1. Uden dette ville
    // en kanal uden programdata blive hentet igen ved hver rendering.
    await markEpgFetched(db, key, now);
    fetched += 1;
    programmes += batch.length;
  });
  }

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
  credsBySource: ReadonlyMap<string, XtreamCredentials>,
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

  let authFailure: XtreamAuthError | null = null;
  let fetched = 0;
  let programmes = 0;

  for (const [sourceId, keys] of groupBySource(candidates)) {
    const creds = credsBySource.get(sourceId);
    if (creds === undefined) continue;
    const client = new XtreamClient(creds, fetchImpl);

    await runBounded(keys, MAX_PARALLEL, () => authFailure !== null, async (key) => {
      const streamId = parseChannelKey(key)?.streamId ?? key;
      let batch;
      try {
        batch = await client.getFullEpg(streamId);
      } catch (cause) {
        if (cause instanceof XtreamAuthError) authFailure = cause;
        return;
      }

      await upsertProgrammes(db, batch.map((p) => ({ ...p, channelId: key })));
      await markArchiveFetched(db, key, now);
      fetched += 1;
      programmes += batch.length;
    });
  }

  if (authFailure !== null) throw authFailure;
  return { fetched, programmes };
}
