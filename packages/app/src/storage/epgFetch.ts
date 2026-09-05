import type { SqlDatabase } from './types.js';

/** Spec sec.4: en kanals EPG fornys naar hentningen er aeldre end 30 minutter. */
export const EPG_MAX_AGE_MS = 30 * 60_000;

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
 *
 * **Regel 1 er "der er ikke hentet", ikke "der er ingen programmer."** Laest paa
 * den anden maade ville enhver kanal panelet ikke har EPG for blive hentet igen
 * ved hver eneste rendering — netop den stormloeb cachen findes for at
 * forhindre. Et vellykket kald der gav nul programmer saetter derfor ogsaa
 * `fetched_at`, og regel 2 daekker kanalen bagefter.
 */
export function needsEpgFetch(freshness: EpgFreshness, now: Date): boolean {
  if (freshness.fetchedAt === null) return true;

  const ms = now.getTime();
  if (ms - freshness.fetchedAt >= EPG_MAX_AGE_MS) return true;

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
