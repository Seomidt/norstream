import type { SqlDatabase } from './types.js';

/** Spec sec.4: en kanals EPG fornys naar hentningen er aeldre end 30 minutter. */
export const EPG_MAX_AGE_MS = 30 * 60_000;

/** Minutter foran UTC paa et givet tidspunkt (sommertid i Danmark: 120). */
export type UtcOffsetAt = (ms: number) => number;

/** Boksens egen zone. Hermes og Node laeser begge enhedens tidszone. */
export const deviceUtcOffset: UtcOffsetAt = (ms) => -new Date(ms).getTimezoneOffset();

/**
 * Hvor laenge efter et skift mellem sommer- og vintertid EPG holdes ekstra frisk.
 * Udbydernes oversigter har efter skiftet ofte en time forkert i et doegn
 * eller to, til de selv retter den. Den rettelse skal med uden en haandrettet
 * timekorrektion i appen (v418-v420 viste hvor galt det gaar).
 */
export const TIME_CHANGE_WINDOW_MS = 3 * 24 * 60 * 60_000;
/** Inden for vinduet ovenfor fornys den fulde tabel efter én time i stedet for seks. */
export const TIME_CHANGE_MAX_AGE_MS = 60 * 60_000;

/**
 * Er uret skiftet mellem sommer- og vintertid siden `fromMs`? Saa er alt der
 * blev hentet foer skiftet mistaenkt: det kom fra en oversigt der maaske stadig
 * regnede med den gamle tid.
 */
export function crossedTimeChange(fromMs: number, toMs: number, offsetAt: UtcOffsetAt = deviceUtcOffset): boolean {
  return offsetAt(fromMs) !== offsetAt(toMs);
}

/** Er der skiftet tid inden for de seneste tre doegn? */
export function nearTimeChange(nowMs: number, offsetAt: UtcOffsetAt = deviceUtcOffset): boolean {
  return crossedTimeChange(nowMs - TIME_CHANGE_WINDOW_MS, nowMs, offsetAt);
}

export interface EpgFreshness {
  /** Hvornaar der sidst blev *hentet* for kanalen — ikke hvornaar der sidst blev gemt noget. */
  fetchedAt: number | null;
  /** Sluttidspunktet for det nyeste gemte program, eller null hvis der ingen er. */
  latestStopMs: number | null;
}

interface FreshnessRow {
  fetched_at: number | null;
  latest_stop: number | null;
}

/**
 * Ét opslag afgoer om en kanals EPG skal hentes igen. `fetched_at` ligger i sin
 * egen tabel frem for paa hver programraekke praecis for at goere det muligt:
 * en kanal uden programdata har stadig en hentetid.
 */
export async function getEpgFreshness(
  db: SqlDatabase,
  streamId: string,
): Promise<EpgFreshness> {
  const row = await db.getFirstAsync<FreshnessRow>(
    `SELECT
       (SELECT fetched_at FROM epg_fetch  WHERE stream_id  = ?) AS fetched_at,
       (SELECT MAX(stop_ms) FROM programmes WHERE channel_id = ?) AS latest_stop`,
    [streamId, streamId],
  );
  return {
    fetchedAt: row?.fetched_at ?? null,
    latestStopMs: row?.latest_stop ?? null,
  };
}

/**
 * Spec sec.4's tre regler, samlet ét sted og uden database, saa de kan testes
 * hver for sig:
 *
 * 1. Der er aldrig hentet for kanalen.
 * 2. Hentningen er mere end 30 minutter gammel.
 * 3. Det nyeste gemte program er allerede slut.
 * 4. Uret er skiftet mellem sommer- og vintertid siden hentningen.
 *
 * **Regel 1 er "der er ikke hentet", ikke "der er ingen programmer."** Laest paa
 * den anden maade ville enhver kanal panelet ikke har EPG for blive hentet igen
 * ved hver eneste rendering — netop den stormloeb cachen findes for at
 * forhindre. Et vellykket kald der gav nul programmer saetter derfor ogsaa
 * `fetched_at`, og regel 2 daekker kanalen bagefter.
 */
export function needsEpgFetch(freshness: EpgFreshness, now: Date, offsetAt: UtcOffsetAt = deviceUtcOffset): boolean {
  if (freshness.fetchedAt === null) return true;

  const ms = now.getTime();
  if (ms - freshness.fetchedAt >= EPG_MAX_AGE_MS) return true;
  if (crossedTimeChange(freshness.fetchedAt, ms, offsetAt)) return true;

  // Regel 3 kan ikke udloeses uden data; regel 2 daekker det tilfaelde.
  if (freshness.latestStopMs !== null && freshness.latestStopMs <= ms) return true;

  return false;
}

export async function markEpgFetched(
  db: SqlDatabase,
  streamId: string,
  now: Date,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO epg_fetch (stream_id, fetched_at) VALUES (?, ?)
     ON CONFLICT(stream_id) DO UPDATE SET fetched_at = excluded.fetched_at`,
    [streamId, now.getTime()],
  );
}

/**
 * Hvor laenge en hentet programtabel regnes for frisk.
 *
 * Seks timer, ikke tredive minutter som "nu og naeste": det denne tabel bruges
 * til er fortiden, og den aendrer sig ikke. Det eneste der loeber fra os er
 * fremtiden i den anden ende, og et halvt doegn er rigeligt til at faa den med.
 */
export const ARCHIVE_EPG_MAX_AGE_MS = 6 * 60 * 60_000;

interface ArchiveFetchRow {
  fetched_at: number | null;
}

/** Hvornaar den fulde programtabel sidst blev hentet for kanalen. */
export async function getArchiveFetchedAt(
  db: SqlDatabase,
  streamId: string,
): Promise<number | null> {
  const row = await db.getFirstAsync<ArchiveFetchRow>(
    'SELECT fetched_at FROM epg_archive_fetch WHERE stream_id = ?',
    [streamId],
  );
  return row?.fetched_at ?? null;
}

/**
 * Seks timer som udgangspunkt. Ved et tidsskift er en tabel hentet foer
 * skiftet altid gammel, og de foerste tre doegn efter skiftet fornyes den hver
 * time, saa udbyderens egen rettelse kommer frem uden at nogen roerer appen.
 */
export function needsArchiveFetch(fetchedAt: number | null, now: Date, offsetAt: UtcOffsetAt = deviceUtcOffset): boolean {
  if (fetchedAt === null) return true;
  const ms = now.getTime();
  if (crossedTimeChange(fetchedAt, ms, offsetAt)) return true;
  const maxAge = nearTimeChange(ms, offsetAt) ? TIME_CHANGE_MAX_AGE_MS : ARCHIVE_EPG_MAX_AGE_MS;
  return ms - fetchedAt >= maxAge;
}

export async function markArchiveFetched(
  db: SqlDatabase,
  streamId: string,
  now: Date,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO epg_archive_fetch (stream_id, fetched_at) VALUES (?, ?)
     ON CONFLICT(stream_id) DO UPDATE SET fetched_at = excluded.fetched_at`,
    [streamId, now.getTime()],
  );
}

/**
 * Skal den korte programoversigt hentes for kanalen?
 *
 * `get_short_epg` giver de naeste tolv programmer. `get_simple_data_table`
 * giver hele tabellen — dage frem og tilbage — og guiden henter den for hver
 * synlig kanal. Er den fulde tabel frisk, tilfoejer de tolv **ingenting**, og
 * et kald per kanal hver halve time er ren spild af panelets ene forbindelse.
 *
 * Reglen staar her frem for inde i hente-lagets loekke, saa den kan proeves
 * for sig: en fejl her koster enten et hav af overfloedige kald eller en guide
 * der ikke opdaterer sig.
 */
export function needsShortEpg(
  freshness: EpgFreshness,
  archiveFetchedAt: number | null,
  now: Date,
  offsetAt: UtcOffsetAt = deviceUtcOffset,
): boolean {
  if (!needsArchiveFetch(archiveFetchedAt, now, offsetAt)) return false;
  return needsEpgFetch(freshness, now, offsetAt);
}
