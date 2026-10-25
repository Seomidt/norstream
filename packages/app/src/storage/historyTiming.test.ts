import { beforeEach, describe, expect, it } from 'vitest';
import type { Programme } from '@norstream/core';
import { setEpgTimeShifts } from './epgTiming.js';
import { ARCHIVE_KEEP_MS, clearArchiveProgress, listArchiveProgress, saveArchiveProgress } from './history.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

const RAW_START = Date.parse('2026-10-25T17:00:00Z');
const HALF_HOUR = 30 * 60_000;
const HOUR = 60 * 60_000;
const NOW = Date.parse('2026-10-25T18:15:00Z');
let db: SqlDatabase;

function programme(channelId = 'a:1', shiftMinutes = 60): Programme {
  return {
    channelId, title: '19 News', description: null,
    start: new Date(RAW_START + shiftMinutes * 60_000),
    stop: new Date(RAW_START + HALF_HOUR + shiftMinutes * 60_000),
  };
}

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  for (const id of ['a', 'b']) {
    await db.runAsync(
      `INSERT INTO sources(id,kind,name,url,created_at) VALUES (?,'xtream',?,'https://panel.example',1)`,
      [id, id],
    );
    await db.runAsync(
      `INSERT INTO channels(id,source_id,stream_id,name,has_archive,archive_days) VALUES (?,?,'1','TV 2',1,7)`,
      [`${id}:1`, id],
    );
  }
  await setEpgTimeShifts(db, 'a', { epgMinutes: 60, archiveMinutes: 60 });
  await setEpgTimeShifts(db, 'b', { epgMinutes: -60, archiveMinutes: 0 });
});

describe('arkivhistorik med korrigerede programtider', () => {
  it('bevarer raa identitet og position gennem gentagne gemninger og genstart', async () => {
    await saveArchiveProgress(db, 'a:1', programme(), 300, NOW);
    let rows = await db.getAllAsync<{ start_ms: number; stop_ms: number; position_s: number }>('SELECT start_ms,stop_ms,position_s FROM archive_progress');
    expect(rows).toEqual([{ start_ms: RAW_START, stop_ms: RAW_START + HALF_HOUR, position_s: 300 }]);
    const [first] = await listArchiveProgress(db, NOW);
    expect(first.programme.start.getTime()).toBe(RAW_START + HOUR);
    expect(first.programme.stop.getTime()).toBe(RAW_START + HOUR + HALF_HOUR);
    expect(first.positionSeconds).toBe(300);
    await saveArchiveProgress(db, 'a:1', first.programme, 500, NOW + 1);
    await migrate(db);
    const [again] = await listArchiveProgress(db, NOW);
    expect(again.programme.start.getTime()).toBe(RAW_START + HOUR);
    expect(again.positionSeconds).toBe(500);
    rows = await db.getAllAsync('SELECT start_ms,stop_ms,position_s FROM archive_progress');
    expect(rows).toEqual([{ start_ms: RAW_START, stop_ms: RAW_START + HALF_HOUR, position_s: 500 }]);
  });

  it('viser eksisterende raadata med ny rettelse uden at flytte en anden kilde', async () => {
    for (const channel of ['a:1', 'b:1']) {
      await db.runAsync(
        `INSERT INTO archive_progress(channel_id,start_ms,stop_ms,title,position_s,updated_ms) VALUES (?,?,?,'19 News',120,?)`,
        [channel, RAW_START, RAW_START + HALF_HOUR, NOW],
      );
    }
    const initial = await listArchiveProgress(db, NOW);
    expect(initial.find(p => p.channel.sourceId === 'a')?.programme.start.getTime()).toBe(RAW_START + HOUR);
    expect(initial.find(p => p.channel.sourceId === 'b')?.programme.start.getTime()).toBe(RAW_START - HOUR);
    await setEpgTimeShifts(db, 'a', { epgMinutes: 120, archiveMinutes: 60 });
    const changed = await listArchiveProgress(db, NOW);
    expect(changed.find(p => p.channel.sourceId === 'a')?.programme.start.getTime()).toBe(RAW_START + 2 * HOUR);
    expect(changed.find(p => p.channel.sourceId === 'b')?.programme.start.getTime()).toBe(RAW_START - HOUR);
    expect((await db.getAllAsync<{ start_ms: number }>('SELECT start_ms FROM archive_progress')).map(row => row.start_ms)).toEqual([RAW_START, RAW_START]);
  });

  it('sletter den rigtige raa post med korrigeret starttid', async () => {
    await saveArchiveProgress(db, 'a:1', programme(), 300, NOW);
    await saveArchiveProgress(db, 'b:1', programme('b:1', -60), 300, NOW);
    await clearArchiveProgress(db, 'a:1', programme().start.getTime());
    expect(await db.getAllAsync('SELECT channel_id,start_ms FROM archive_progress')).toEqual([{ channel_id: 'b:1', start_ms: RAW_START }]);
  });

  it('finder kildens korrektion for en gammel kanalnoegle uden praefiks', async () => {
    await db.runAsync("INSERT INTO channels(id,source_id,stream_id,name) VALUES ('legacy','a','2','TV 2')");
    await saveArchiveProgress(db, 'legacy', programme('legacy'), 300, NOW);
    expect(await db.getFirstAsync("SELECT start_ms FROM archive_progress WHERE channel_id='legacy'")).toEqual({ start_ms: RAW_START });
    expect((await listArchiveProgress(db, NOW))[0].programme.start.getTime()).toBe(RAW_START + HOUR);
    await clearArchiveProgress(db, 'legacy', RAW_START + HOUR);
    expect(await db.getAllAsync('SELECT * FROM archive_progress')).toEqual([]);
  });

  it('faerdig afspilning fjerner historikken uden en ekstra forskydning', async () => {
    await saveArchiveProgress(db, 'a:1', programme(), 300, NOW);
    await saveArchiveProgress(db, 'a:1', programme(), 1710, NOW);
    expect(await db.getAllAsync('SELECT * FROM archive_progress')).toEqual([]);
  });

  it('beregner opbevaring efter korrigeret sluttid paa begge sider af graensen', async () => {
    const rawStop = NOW - ARCHIVE_KEEP_MS - HALF_HOUR;
    for (const channel of ['a:1', 'b:1']) {
      await db.runAsync(
        `INSERT INTO archive_progress(channel_id,start_ms,stop_ms,title,position_s,updated_ms) VALUES (?,?,?,'Gammel',120,?)`,
        [channel, rawStop - HOUR, rawStop, NOW],
      );
    }
    expect((await listArchiveProgress(db, NOW)).map(p => p.channel.id)).toEqual(['a:1']);
    expect(await db.getAllAsync('SELECT channel_id FROM archive_progress')).toEqual([{ channel_id: 'a:1' }]);
  });

  it('gemmer med afspillerens korrektion naar indstillingen er aendret undervejs', async () => {
    await setEpgTimeShifts(db, 'a', { epgMinutes: 0, archiveMinutes: 0 });
    await saveArchiveProgress(db, 'a:1', programme(), 300, NOW, 60);
    expect(await db.getFirstAsync('SELECT start_ms,stop_ms FROM archive_progress')).toEqual({ start_ms: RAW_START, stop_ms: RAW_START + HALF_HOUR });
    await expect(saveArchiveProgress(db, 'a:1', programme(), 300, NOW, NaN)).rejects.toThrow('ugyldig');
    await expect(saveArchiveProgress(db, 'a:1', programme(), 300, NOW, 721)).rejects.toThrow('ugyldig');
    expect(await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM archive_progress')).toEqual({ count: 1 });
  });
});
