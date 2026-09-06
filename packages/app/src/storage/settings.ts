import type { TimeshiftDialect } from '@norstream/core';
import type { SqlDatabase } from './types.js';

const KEY_DIALECT = 'timeshift_dialect';
const KEY_OFFSET = 'panel_offset_minutes';
const KEY_LAST_SYNC = 'last_sync_ms';
const KEY_PREVIEW = 'mini_preview_enabled';
const KEY_STREAM_FORMAT = 'stream_format';

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

/**
 * Nulstiller tidspunktet for sidste kanal-synkronisering.
 *
 * Kaldes ved udlogning. Uden det springer den naeste session synkroniseringen
 * over i op til et doegn, fordi `last_sync_ms` stadig er frisk — og logger man
 * ind paa et *andet* panel, ser man det gamles kanaler indtil da.
 */
export async function clearLastSyncMs(db: SqlDatabase): Promise<void> {
  await db.runAsync('DELETE FROM settings WHERE key = ?', [KEY_LAST_SYNC]);
}

/**
 * Mini-preview er slaaet til som standard, men er appens mest skroebelige del:
 * panelet tillader én samtidig forbindelse, saa hver ny preview skal lukke den
 * forrige helt ned foerst. Spec sec.7 kraever derfor at den kan slaas fra.
 */
export async function getMiniPreviewEnabled(db: SqlDatabase): Promise<boolean> {
  return (await getSetting(db, KEY_PREVIEW)) !== 'off';
}

export async function setMiniPreviewEnabled(
  db: SqlDatabase,
  enabled: boolean,
): Promise<void> {
  await setSetting(db, KEY_PREVIEW, enabled ? 'on' : 'off');
}

/**
 * Hvilket containerformat live-streams hentes i.
 *
 * `auto` er platformens valg: `.ts` paa Android for lavere forsinkelse, HLS
 * alle andre steder fordi AVPlayer ikke kan afspille raa MPEG-TS.
 *
 * Valget er brugerens, fordi forskellen er maalbar paa netop det panelet
 * leverer: raa MPEG-TS har ingen tidslinje ud over de tidsstempler
 * transportstroemmen selv baerer, og en afspiller der estimerer forkert faar
 * undertekster til at loebe foran billedet. HLS beskriver hvert segments
 * laengde og har ikke det problem, men koster et par sekunders forsinkelse.
 * Hvilken af de to der er bedst kan kun afgoeres paa det panel man har.
 */
export type StreamFormatSetting = 'auto' | 'ts' | 'm3u8';

export async function getStreamFormatSetting(db: SqlDatabase): Promise<StreamFormatSetting> {
  const value = await getSetting(db, KEY_STREAM_FORMAT);
  return value === 'ts' || value === 'm3u8' ? value : 'auto';
}

export async function setStreamFormatSetting(
  db: SqlDatabase,
  value: StreamFormatSetting,
): Promise<void> {
  await setSetting(db, KEY_STREAM_FORMAT, value);
}
