import { beforeEach, describe, expect, it } from 'vitest';
import type { Programme } from '@norstream/core';
import { ARCHIVE_KEEP_MS, clearArchiveProgress, listArchiveProgress, saveArchiveProgress } from './history.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

const START = Date.parse('2026-10-25T18:00:00Z');
const HALF_HOUR = 30 * 60_000;
const NOW = Date.parse('2026-10-25T18:15:00Z');
let db: SqlDatabase;

function programme(channelId = 'a:1'): Programme {
  return { channelId, title: '19 News', description: null, start: new Date(START), stop: new Date(START + HALF_HOUR) };
}

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  await db.runAsync(`INSERT INTO sources(id,kind,name,url,created_at) VALUES ('a','xtream','a','https://panel.example',1)`);
  await db.runAsync(`INSERT INTO channels(id,source_id,stream_id,name,has_archive,archive_days) VALUES ('a:1','a','1','TV 2',1,7)`);
});

describe('arkivhistorik med udbyderens tider (v423: ingen timekorrektion)', () => {
  it('gemmer og viser udsendelsen paa samme tid, ogsaa efter genstart', async () => {
    await saveArchiveProgress(db, 'a:1', programme(), 300, NOW);
    expect(await db.getAllAsync('SELECT start_ms,stop_ms,position_s FROM archive_progress'))
      .toEqual([{ start_ms: START, stop_ms: START + HALF_HOUR, position_s: 300 }]);
    await migrate(db);
    const [first] = await listArchiveProgress(db, NOW);
    expect(first.programme.start.getTime()).toBe(START);
    expect(first.positionSeconds).toBe(300);
  });

  it('en gammel arkivkorrektion i indstillingerne flytter intet', async () => {
    await db.runAsync("INSERT INTO settings(key,value) VALUES ('epg_shift_minutes:a','60')");
    await saveArchiveProgress(db, 'a:1', programme(), 300, NOW);
    expect((await listArchiveProgress(db, NOW))[0].programme.start.getTime()).toBe(START);
  });

  it('sletter posten paa udsendelsens egen starttid', async () => {
    await saveArchiveProgress(db, 'a:1', programme(), 300, NOW);
    await clearArchiveProgress(db, 'a:1', START);
    expect(await db.getAllAsync('SELECT * FROM archive_progress')).toEqual([]);
  });

  it('faerdig afspilning fjerner historikken', async () => {
    await saveArchiveProgress(db, 'a:1', programme(), 300, NOW);
    await saveArchiveProgress(db, 'a:1', programme(), 1710, NOW);
    expect(await db.getAllAsync('SELECT * FROM archive_progress')).toEqual([]);
  });

  it('rydder gamle poster efter sluttiden', async () => {
    const stop = NOW - ARCHIVE_KEEP_MS - 1;
    await db.runAsync(
      `INSERT INTO archive_progress(channel_id,start_ms,stop_ms,title,position_s,updated_ms) VALUES ('a:1',?,?,'Gammel',120,?)`,
      [stop - HALF_HOUR, stop, NOW],
    );
    expect(await listArchiveProgress(db, NOW)).toEqual([]);
  });
});
