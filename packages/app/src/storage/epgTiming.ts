import type { SqlDatabase } from './types.js';
import { withTransaction } from './transaction.js';
import { invalidateQueryCache } from './queryCache.js';
import { invalidateGuideSnapshot } from './guideSnapshot.js';

export const EPG_TIME_SHIFT_MINUTES_LIMIT = 720;
export const EPG_TIME_SHIFT_PREFIX = 'epg_shift_minutes:';
export const ARCHIVE_TIME_SHIFT_PREFIX = 'archive_shift_minutes:';

function minutesSql(value: string): string {
  return `(CASE WHEN CAST(CAST(TRIM(${value}) AS INTEGER) AS TEXT) = TRIM(${value})
                    AND CAST(${value} AS INTEGER) BETWEEN -720 AND 720
               THEN CAST(${value} AS INTEGER) ELSE 0 END)`;
}

/** Kun interne SQL-udtryk maa gives her; kilde-id'er bindes af kalderen. */
export function epgTimeShiftSql(sourceIdExpression: string): string {
  return `COALESCE((SELECT ${minutesSql('epg_timing.value')} FROM settings epg_timing
    WHERE epg_timing.key = 'epg_shift_minutes:' || (${sourceIdExpression})), 0)`;
}

/** Raadata bevares. Kun laesevisningen flytter programtiderne, saa en ny
 * hentning, genstart eller aendring af rettelsen aldrig kan laegge den til igen. */
export const EPG_TIMING_SCHEMA = `
CREATE VIEW IF NOT EXISTS programmes_effective AS
SELECT channel_id,
       start_ms + shift_ms AS start_ms,
       stop_ms + shift_ms AS stop_ms,
       title, description,
       start_ms AS source_start_ms, stop_ms AS source_stop_ms
FROM (
  SELECT p.channel_id, p.start_ms, p.stop_ms, p.title, p.description,
         ${minutesSql('timing.value')} * 60000 AS shift_ms
  FROM programmes p
  LEFT JOIN channels c ON c.id = p.channel_id
  LEFT JOIN settings timing ON timing.key = 'epg_shift_minutes:' ||
    COALESCE(NULLIF(c.source_id, ''),
      CASE WHEN INSTR(p.channel_id, ':') > 0
           THEN SUBSTR(p.channel_id, 1, INSTR(p.channel_id, ':') - 1) ELSE '' END)
);
`;

function parseMinutes(value: string | null | undefined): number {
  if (value == null) return 0;
  const raw = value.trim();
  const minutes = Number(raw);
  return Number.isInteger(minutes) && Math.abs(minutes) <= EPG_TIME_SHIFT_MINUTES_LIMIT && String(minutes) === raw
    ? minutes : 0;
}

async function readShift(db: SqlDatabase, prefix: string, sourceId: string): Promise<number> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM settings WHERE key = ?', [`${prefix}${sourceId}`]);
  return parseMinutes(row?.value);
}

export function getEpgTimeShift(db: SqlDatabase, sourceId: string): Promise<number> {
  return readShift(db, EPG_TIME_SHIFT_PREFIX, sourceId);
}

export function getArchiveTimeShift(db: SqlDatabase, sourceId: string): Promise<number> {
  return readShift(db, ARCHIVE_TIME_SHIFT_PREFIX, sourceId);
}

const revisions = new WeakMap<SqlDatabase, number>();
export function epgTimingRevision(db: SqlDatabase): number { return revisions.get(db) ?? 0; }
export function invalidateEpgTiming(db: SqlDatabase): void {
  revisions.set(db, epgTimingRevision(db) + 1);
  invalidateQueryCache();
  invalidateGuideSnapshot(db);
}

/** De to koordinater er adskilte: EPG-visning og udbyderens arkivtid. */
export async function setEpgTimeShifts(
  db: SqlDatabase,
  sourceId: string,
  timing: { epgMinutes: number; archiveMinutes: number },
): Promise<void> {
  const values = [timing.epgMinutes, timing.archiveMinutes];
  if (sourceId.length === 0 || values.some(value => !Number.isInteger(value) || Math.abs(value) > EPG_TIME_SHIFT_MINUTES_LIMIT)) {
    throw new Error('Tidskorrektionen skal være et helt antal minutter mellem -720 og 720.');
  }
  await withTransaction(db, async () => {
    for (const [prefix, minutes] of [[EPG_TIME_SHIFT_PREFIX, timing.epgMinutes], [ARCHIVE_TIME_SHIFT_PREFIX, timing.archiveMinutes]] as const) {
      await db.runAsync(
        `INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [`${prefix}${sourceId}`, String(minutes)],
      );
    }
  });
  invalidateEpgTiming(db);
}

/** Kun allerede tilsluttede paneler faar den godkendte +60-rettelse ved
 * opgradering. Nye installationer/kilder starter neutralt; egne valg bevares. */
export async function seedUpgradedEpgTiming(db: SqlDatabase): Promise<void> {
  for (const prefix of [EPG_TIME_SHIFT_PREFIX, ARCHIVE_TIME_SHIFT_PREFIX]) {
    await db.runAsync(
      `INSERT OR IGNORE INTO settings (key, value)
       SELECT ? || id, '60' FROM sources WHERE kind = 'xtream'`,
      [prefix],
    );
  }
}
