import type { SqlDatabase } from './types.js';
import { invalidateQueryCache } from './queryCache.js';
import { invalidateGuideSnapshot } from './guideSnapshot.js';

/**
 * Haandrettede timekorrektioner fra v418 (EPG og arkiv ±1 time pr. kilde).
 * De er fjernet i v423: en fast time passer kun indtil naeste skift mellem
 * sommer- og vintertid. Programtider bruges som udbyderen sender dem, og
 * arkivadressen regnes i panelets egen tidszone for udsendelsens dato.
 * Praefikserne staar her, saa opgradering og gendannelse kan rydde dem.
 */
export const EPG_TIME_SHIFT_PREFIX = 'epg_shift_minutes:';
export const ARCHIVE_TIME_SHIFT_PREFIX = 'archive_shift_minutes:';

/** Kompatibilitetsvisning for v418/v419-integrationspunkter: raa tider. */
export const EPG_TIMING_SCHEMA = `
CREATE VIEW IF NOT EXISTS programmes_effective AS
SELECT channel_id, start_ms, stop_ms, title, description,
       start_ms AS source_start_ms, stop_ms AS source_stop_ms
FROM programmes;
`;

/** Fjerner alle gemte timekorrektioner. Koeres én gang ved opgradering. */
export async function removeTimeCorrections(db: SqlDatabase): Promise<void> {
  await db.runAsync(
    'DELETE FROM settings WHERE key LIKE ? OR key LIKE ?',
    [`${EPG_TIME_SHIFT_PREFIX}%`, `${ARCHIVE_TIME_SHIFT_PREFIX}%`],
  );
}

const revisions = new WeakMap<SqlDatabase, number>();
export function epgTimingRevision(db: SqlDatabase): number { return revisions.get(db) ?? 0; }
/** En gendannelse skifter kilder og kanaler: aeldre guidesvar afvises. */
export function invalidateEpgTiming(db: SqlDatabase): void {
  revisions.set(db, epgTimingRevision(db) + 1);
  invalidateQueryCache();
  invalidateGuideSnapshot(db);
}
