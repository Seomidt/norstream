import { beforeEach, describe, expect, it } from 'vitest';
import { channelKey } from '@norstream/core';
import type { Category, Channel, Programme } from '@norstream/core';
import { replaceCategories, replaceChannels } from './channels.js';
import { followSeries, isFollowed, listFollowedSeries, markSeriesSeen, unfollowSeries } from './followedSeries.js';
import { ARCHIVE_KEEP_MS, listArchiveProgress, listRecentChannels, recordChannelWatch, saveArchiveProgress } from './history.js';
import { REMIND_AFTER_MS, REMIND_BEFORE_MS, addReminder, dueReminder, hasReminder, listReminders, removeReminder } from './reminders.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

const SOURCE = 'src1';
const key = (streamId: string): string => channelKey(SOURCE, streamId);
const CATEGORIES: Category[] = [{ id: '1', name: 'DENMARK' }];
function channel(id: string, name: string): Channel {
  return { id, name, number: null, logoUrl: null, categoryId: '1', epgChannelId: null, hasArchive: true, archiveDays: 7 };
}
function programme(channelId: string, startMs: number, minutes: number, title = 'Udsendelse'): Programme {
  return { channelId, title, description: null, start: new Date(startMs), stop: new Date(startMs + minutes * 60_000) };
}

describe('sidst sete', () => {
  let db: SqlDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
    await db.runAsync("INSERT INTO sources VALUES ('src1','xtream','P','http://p:8080',NULL,NULL,1,0,0)");
    await replaceCategories(db, SOURCE, CATEGORIES);
    await replaceChannels(db, SOURCE, [channel('10', 'DR1'), channel('11', 'TV2'), channel('12', 'TV3')]);
  });

  it('husker de senest sete, nyeste foerst, én gang per kanal', async () => {
    await recordChannelWatch(db, key('10'), 1000);
    await recordChannelWatch(db, key('11'), 2000);
    await recordChannelWatch(db, key('10'), 3000);
    await recordChannelWatch(db, 'src1:findes-ikke', 4000);
    expect((await listRecentChannels(db, 5)).map((c) => c.name)).toEqual(['DR1', 'TV2']);
  });

  it('gemmer fremdrift i arkivet, rydder naar set faerdig, og glemmer gamle', async () => {
    const now = 10_000_000;
    const p = programme(key('10'), now - 60 * 60_000, 60, 'TV Avisen');
    await saveArchiveProgress(db, key('10'), p, 10, now); // for lidt
    expect(await listArchiveProgress(db, now)).toEqual([]);
    await saveArchiveProgress(db, key('10'), p, 600, now);
    const list = await listArchiveProgress(db, now);
    expect(list).toHaveLength(1);
    expect(list[0]?.positionSeconds).toBe(600);
    expect(list[0]?.programme.title).toBe('TV Avisen');
    await saveArchiveProgress(db, key('10'), p, 3500, now); // 97 %: faerdig
    expect(await listArchiveProgress(db, now)).toEqual([]);
    const old = programme(key('11'), now - ARCHIVE_KEEP_MS - 2 * 60 * 60_000, 60);
    await saveArchiveProgress(db, key('11'), old, 600, now);
    expect(await listArchiveProgress(db, now)).toEqual([]);
  });
});

describe('paamindelser', () => {
  let db: SqlDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
    await db.runAsync("INSERT INTO sources VALUES ('src1','xtream','P','http://p:8080',NULL,NULL,1,0,0)");
    await replaceCategories(db, SOURCE, CATEGORIES);
    await replaceChannels(db, SOURCE, [channel('10', 'DR1')]);
  });

  it('kommer tre minutter foer, bliver fem minutter efter, og forsvinder saa', async () => {
    const start = 50_000_000;
    const p = programme(key('10'), start, 60, 'Matador');
    await addReminder(db, key('10'), p);
    expect(await hasReminder(db, key('10'), start)).toBe(true);
    expect(await dueReminder(db, start - REMIND_BEFORE_MS - 1000)).toBeNull();
    const due = await dueReminder(db, start - REMIND_BEFORE_MS + 1000);
    expect(due?.channel.name).toBe('DR1');
    expect(due?.programme.title).toBe('Matador');
    expect(await dueReminder(db, start + REMIND_AFTER_MS - 1000)).not.toBeNull();
    expect(await dueReminder(db, start + REMIND_AFTER_MS + 1000)).toBeNull();
    expect(await listReminders(db)).toEqual([]);
  });

  it('kan fjernes igen', async () => {
    const p = programme(key('10'), 60_000_000, 30);
    await addReminder(db, key('10'), p);
    await removeReminder(db, key('10'), 60_000_000);
    expect(await hasReminder(db, key('10'), 60_000_000)).toBe(false);
  });
});

describe('fulgte serier', () => {
  let db: SqlDatabase;
  beforeEach(async () => {
    db = createTestDatabase();
    await migrate(db);
    await db.runAsync("INSERT INTO sources VALUES ('src1','xtream','P','http://p:8080',NULL,NULL,1,0,0)");
    await db.runAsync("INSERT INTO vod_categories (id, source_id, name, kind) VALUES ('c1','src1','SERIES','series')");
    await db.runAsync(
      "INSERT INTO vod_items (key, source_id, item_id, kind, name, poster_url, category_id, rating, year, added_ms, container_ext, sort_order) VALUES ('src1:s1','src1','s1','series','Matador',NULL,'c1',NULL,NULL,0,NULL,0)",
    );
  });

  it('nye afsnit er dem der er kommet siden man saa listen', async () => {
    const ep = (n: number) =>
      db.runAsync("INSERT INTO episodes (key, series_key, episode_id, season, episode, title, plot, duration_min, container_ext, air_date) VALUES (?, 'src1:s1', ?, 1, ?, 'Afsnit', NULL, NULL, NULL, NULL)", [`src1:s1:${n}`, `${n}`, n]);
    await ep(1);
    await ep(2);
    await followSeries(db, 'src1:s1', 1000);
    expect(await isFollowed(db, 'src1:s1')).toBe(true);
    let list = await listFollowedSeries(db);
    expect(list[0]?.episodes).toBe(2);
    expect(list[0]?.seenEpisodes).toBe(2);
    await ep(3);
    list = await listFollowedSeries(db);
    expect(list[0]?.episodes - list[0]!.seenEpisodes).toBe(1);
    await markSeriesSeen(db, 'src1:s1');
    list = await listFollowedSeries(db);
    expect(list[0]?.seenEpisodes).toBe(3);
    await unfollowSeries(db, 'src1:s1');
    expect(await listFollowedSeries(db)).toEqual([]);
  });
});
