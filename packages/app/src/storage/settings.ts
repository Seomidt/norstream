import type { TimeshiftDialect } from '@uhf-play/core';
import type { SqlDatabase } from './types.js';

const KEY_DIALECT = 'timeshift_dialect';
const KEY_OFFSET = 'panel_offset_minutes';
const KEY_LAST_SYNC = 'last_sync_ms';

export async function getSetting(
  db: SqlDatabase,
  key: string,
): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

export async function setSetting(
  db: SqlDatabase,
  key: string,
  value: string,
): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}

/** Null betyder enten "ikke probet endnu" eller "ingen dialekt svarede". */
export async function getTimeshiftDialect(
  db: SqlDatabase,
): Promise<TimeshiftDialect | null> {
  const value = await getSetting(db, KEY_DIALECT);
  return value === 'php' || value === 'path' ? value : null;
}

export async function setTimeshiftDialect(
  db: SqlDatabase,
  dialect: TimeshiftDialect | null,
): Promise<void> {
  await setSetting(db, KEY_DIALECT, dialect ?? 'none');
}

export async function getPanelOffsetMinutes(db: SqlDatabase): Promise<number> {
  const value = await getSetting(db, KEY_OFFSET);
  if (value === null) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function setPanelOffsetMinutes(
  db: SqlDatabase,
  minutes: number,
): Promise<void> {
  await setSetting(db, KEY_OFFSET, String(Math.trunc(minutes)));
}

export async function getLastSyncMs(db: SqlDatabase): Promise<number | null> {
  const value = await getSetting(db, KEY_LAST_SYNC);
  if (value === null) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function setLastSyncMs(db: SqlDatabase, ms: number): Promise<void> {
  await setSetting(db, KEY_LAST_SYNC, String(Math.trunc(ms)));
}
