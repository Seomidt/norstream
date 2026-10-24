import type { SqlDatabase } from './types.js';
import { getSetting } from './settings.js';

/** Lokale visningsvalg. Sky-kopier maa ikke overskrive boksens oprydning. */
export const CONTINUE_CLEAR_KEY = 'home_continue_cleared_ms';
export const VOD_CONTINUE_CLEAR_KEY = 'home_continue_vod_cleared_ms';
export const CONTINUE_HIDE_PREFIX = 'home_continue_hide:';

export async function continueCutoff(db: SqlDatabase, itemKey: string): Promise<number> {
  const values = await Promise.all([getSetting(db, CONTINUE_CLEAR_KEY), getSetting(db, CONTINUE_HIDE_PREFIX + itemKey)]);
  return Math.max(0, ...values.map(value => {
    const ms = Number(value);
    return Number.isSafeInteger(ms) && ms > 0 ? ms : 0;
  }));
}

async function saveCutoff(db: SqlDatabase, key: string, now: number): Promise<void> {
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('Ugyldigt tidspunkt');
  await db.runAsync(`INSERT INTO settings(key,value) VALUES (?,?)
    ON CONFLICT(key) DO UPDATE SET value = CAST(MAX(CAST(settings.value AS INTEGER), CAST(excluded.value AS INTEGER)) AS TEXT)`, [key, String(now)]);
}

export const dismissContinueItem = (db: SqlDatabase, itemKey: string, now = Date.now()): Promise<void> =>
  saveCutoff(db, CONTINUE_HIDE_PREFIX + itemKey, now);

export const clearContinueList = (db: SqlDatabase, now = Date.now()): Promise<void> =>
  saveCutoff(db, CONTINUE_CLEAR_KEY, now);

/** Film-menuens rydning omfatter film og serier paa begge hylder. */
export const clearVodContinueList = (db: SqlDatabase, now = Date.now()): Promise<void> =>
  saveCutoff(db, VOD_CONTINUE_CLEAR_KEY, now);

export async function continueChannelVisible(db: SqlDatabase, channelId: string): Promise<boolean> {
  const cutoff = await continueCutoff(db, `channel:${channelId}`);
  if (cutoff === 0) return true;
  const seen = await db.getFirstAsync<{ watched_ms: number }>('SELECT watched_ms FROM channel_history WHERE channel_id = ?', [channelId]);
  return seen !== null && seen.watched_ms > cutoff;
}
