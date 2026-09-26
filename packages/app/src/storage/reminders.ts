import type { Programme } from '@norstream/core';
import { getChannel } from './channels.js';
import type { StoredChannel } from './channels.js';
import type { SqlDatabase } from './types.js';

/**
 * Paamindelser om udsendelser.
 *
 * Sat fra udsendelsens blad i guiden. Et par minutter foer start staar der
 * en bjaelke i hjoernet, uanset hvad man ser, og OK skifter kanal. En
 * paamindelse gaelder til udsendelsen er slut; saa ryddes den.
 */
export interface Reminder {
  channelId: string;
  startMs: number;
  stopMs: number;
  title: string;
}

export interface DueReminder extends Reminder {
  channel: StoredChannel;
  programme: Programme;
}

/** Saa laenge foer start bjaelken kommer. */
export const REMIND_BEFORE_MS = 3 * 60_000;
/** Saa laenge efter start den stadig vises, hvis man ikke saa den med det samme. */
export const REMIND_AFTER_MS = 5 * 60_000;

export async function addReminder(db: SqlDatabase, channelId: string, programme: Programme): Promise<void> {
  await db.runAsync(
    'INSERT OR REPLACE INTO reminders (channel_id, start_ms, stop_ms, title) VALUES (?, ?, ?, ?)',
    [channelId, programme.start.getTime(), programme.stop.getTime(), programme.title],
  );
}

export async function removeReminder(db: SqlDatabase, channelId: string, startMs: number): Promise<void> {
  await db.runAsync('DELETE FROM reminders WHERE channel_id = ? AND start_ms = ?', [channelId, startMs]);
}

export async function hasReminder(db: SqlDatabase, channelId: string, startMs: number): Promise<boolean> {
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM reminders WHERE channel_id = ? AND start_ms = ?',
    [channelId, startMs],
  );
  return (row?.n ?? 0) > 0;
}

export async function listReminders(db: SqlDatabase): Promise<Reminder[]> {
  const rows = await db.getAllAsync<{ channel_id: string; start_ms: number; stop_ms: number; title: string }>(
    'SELECT channel_id, start_ms, stop_ms, title FROM reminders ORDER BY start_ms',
  );
  return rows.map((row) => ({ channelId: row.channel_id, startMs: row.start_ms, stopMs: row.stop_ms, title: row.title }));
}

/**
 * Den paamindelse der skal vises lige nu, om nogen: fra tre minutter foer
 * start til fem minutter efter. Udloebne ryddes undervejs.
 */
export async function dueReminder(db: SqlDatabase, now = Date.now()): Promise<DueReminder | null> {
  await db.runAsync('DELETE FROM reminders WHERE stop_ms < ? OR start_ms + ? < ?', [now, REMIND_AFTER_MS, now]);
  const row = await db.getFirstAsync<{ channel_id: string; start_ms: number; stop_ms: number; title: string }>(
    'SELECT channel_id, start_ms, stop_ms, title FROM reminders WHERE start_ms - ? <= ? ORDER BY start_ms LIMIT 1',
    [REMIND_BEFORE_MS, now],
  );
  if (row === null) return null;
  const channel = await getChannel(db, row.channel_id);
  if (channel === null) {
    await removeReminder(db, row.channel_id, row.start_ms);
    return null;
  }
  return {
    channelId: row.channel_id,
    startMs: row.start_ms,
    stopMs: row.stop_ms,
    title: row.title,
    channel,
    programme: { channelId: row.channel_id, title: row.title, description: null, start: new Date(row.start_ms), stop: new Date(row.stop_ms) },
  };
}
