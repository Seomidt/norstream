import type { Programme } from '@norstream/core';
import { getChannelsByIds } from './channels.js';
import type { StoredChannel } from './channels.js';
import type { SqlDatabase } from './types.js';

/**
 * Det man har set: de sidst sete kanaler, og hvor langt man er naaet i
 * udsendelser startet forfra. Begge dele er forsidens raekker "Sidst sete"
 * og "Fortsaet".
 */

/** Hvor mange sidst sete der huskes. Resten ryddes, saa tabellen ikke vokser. */
const HISTORY_KEEP = 30;

export async function recordChannelWatch(db: SqlDatabase, channelId: string, now = Date.now()): Promise<void> {
  await db.runAsync(
    `INSERT INTO channel_history (channel_id, watched_ms) VALUES (?, ?)
     ON CONFLICT(channel_id) DO UPDATE SET watched_ms = excluded.watched_ms`,
    [channelId, now],
  );
  await db.runAsync(
    `DELETE FROM channel_history WHERE channel_id NOT IN
       (SELECT channel_id FROM channel_history ORDER BY watched_ms DESC LIMIT ?)`,
    [HISTORY_KEEP],
  );
}

/** De sidst sete kanaler, nyeste foerst. Kanaler der ikke findes laengere springes over. */
export async function listRecentChannels(db: SqlDatabase, limit = 5): Promise<StoredChannel[]> {
  const rows = await db.getAllAsync<{ channel_id: string }>(
    'SELECT channel_id FROM channel_history ORDER BY watched_ms DESC LIMIT ?',
    [Math.max(1, limit * 2)],
  );
  // Ét opslag for alle kanalerne, i stedet for én tung join per raekke; ordenen
  // (nyeste foerst) holdes af listen, ikke af opslaget. Kanaler der ikke findes
  // laengere springes over.
  const channels = await getChannelsByIds(db, rows.map((row) => row.channel_id));
  const out: StoredChannel[] = [];
  for (const row of rows) {
    const channel = channels.get(row.channel_id);
    if (channel !== undefined) out.push(channel);
    if (out.length >= limit) break;
  }
  return out;
}

export interface ArchiveProgress {
  channel: StoredChannel;
  programme: Programme;
  positionSeconds: number;
  updatedMs: number;
}

/** Set faerdig naar saa stor en del er afspillet. */
export const ARCHIVE_DONE_RATIO = 0.95;
/** Saa laenge en paabegyndt udsendelse staar paa forsiden efter at den sluttede. */
export const ARCHIVE_KEEP_MS = 7 * 24 * 60 * 60_000;
/** Under dette gemmes intet: de foerste sekunder er ikke "i gang". */
const MIN_POSITION_S = 30;

export async function saveArchiveProgress(
  db: SqlDatabase,
  channelId: string,
  programme: Programme,
  positionSeconds: number,
  now = Date.now(),
): Promise<void> {
  const durationS = (programme.stop.getTime() - programme.start.getTime()) / 1000;
  const startMs = programme.start.getTime();
  if (positionSeconds < MIN_POSITION_S || durationS <= 0) return;
  if (positionSeconds >= durationS * ARCHIVE_DONE_RATIO) {
    await db.runAsync('DELETE FROM archive_progress WHERE channel_id = ? AND start_ms = ?', [channelId, startMs]);
    return;
  }
  await db.runAsync(
    `INSERT INTO archive_progress (channel_id, start_ms, stop_ms, title, position_s, updated_ms)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(channel_id, start_ms) DO UPDATE SET position_s = excluded.position_s, updated_ms = excluded.updated_ms`,
    [channelId, startMs, programme.stop.getTime(), programme.title, Math.round(positionSeconds), now],
  );
}

export async function clearArchiveProgress(db: SqlDatabase, channelId: string, startMs: number): Promise<void> {
  await db.runAsync('DELETE FROM archive_progress WHERE channel_id = ? AND start_ms = ?', [channelId, startMs]);
}

/** Paabegyndte udsendelser, senest set foerst. Gamle ryddes undervejs. */
export async function listArchiveProgress(db: SqlDatabase, now = Date.now(), limit = 10): Promise<ArchiveProgress[]> {
  await db.runAsync('DELETE FROM archive_progress WHERE stop_ms < ?', [now - ARCHIVE_KEEP_MS]);
  const rows = await db.getAllAsync<{ channel_id: string; start_ms: number; stop_ms: number; title: string; position_s: number; updated_ms: number }>(
    'SELECT channel_id, start_ms, stop_ms, title, position_s, updated_ms FROM archive_progress ORDER BY updated_ms DESC LIMIT ?',
    [limit],
  );
  const channels = await getChannelsByIds(db, rows.map((row) => row.channel_id));
  const out: ArchiveProgress[] = [];
  for (const row of rows) {
    const channel = channels.get(row.channel_id);
    if (channel === undefined) continue;
    out.push({
      channel,
      programme: { channelId: row.channel_id, title: row.title, description: null, start: new Date(row.start_ms), stop: new Date(row.stop_ms) },
      positionSeconds: row.position_s,
      updatedMs: row.updated_ms,
    });
  }
  return out;
}
