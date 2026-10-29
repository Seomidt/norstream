import { describe, expect, it } from 'vitest';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import { upsertProgrammes, getNowNext, listProgrammes } from './programmes.js';

it('v400-EPG laeser udbyderens UTC-tider uden den senere +60-projektion', async () => {
  const db = createTestDatabase(); await migrate(db);
  await db.execAsync(`INSERT INTO settings VALUES ('epg_shift_minutes:panel','60')`);
  const start = new Date('2026-10-26T18:00:00Z'), stop = new Date('2026-10-26T18:30:00Z');
  await upsertProgrammes(db, [{channelId:'panel:tv2',title:'19 News',description:null,start,stop}]);
  const result = await getNowNext(db, 'panel:tv2', new Date('2026-10-26T18:15:00Z'));
  expect(result.now?.start).toEqual(start);
  expect((await listProgrammes(db,'panel:tv2',start,stop))[0]?.stop).toEqual(stop);
  expect(await db.getFirstAsync('SELECT start_ms FROM programmes_effective')).toEqual({start_ms:start.getTime()});
});

describe('kun EPG tilbage til v400', () => {
  it.each([31,32])('bevarer brugerdata og fjerner timekorrektionerne fra skema %i', async version => {
    const db = createTestDatabase(); await migrate(db);
    await db.execAsync(`
      INSERT INTO sources(id,kind,name,url,created_at) VALUES ('panel','xtream','Min kilde','https://example.invalid',1),('list','m3u','Liste','https://example.invalid/list',1);
      INSERT INTO channels(id,source_id,stream_id,name) VALUES ('panel:dr2','panel','1','DR2'),('list:1','list','1','M3U');
      INSERT INTO favorites(channel_id) VALUES ('panel:dr2');
      INSERT INTO favorite_groups VALUES ('us','US',0);
      INSERT INTO favorite_group_members VALUES ('us','panel:dr2');
      INSERT INTO programmes VALUES ('panel:dr2',1000,2000,'Gammel blandet EPG',NULL),('list:1',1000,2000,'M3U behold',NULL);
      INSERT INTO archive_progress VALUES ('panel:dr2',1000,2000,'Arkiv',300,123);
      INSERT INTO vod_progress VALUES ('panel:film',300,7200,123);
      INSERT INTO followed_series VALUES ('panel:serie',123,4);
      INSERT INTO settings VALUES ('epg_shift_minutes:panel','60'),('archive_shift_minutes:panel','60'),('theme_mode','dark');
      INSERT INTO epg_fetch VALUES ('panel:dr2',123);
      INSERT INTO epg_archive_fetch VALUES ('panel:dr2',123);
      PRAGMA user_version=${version};
    `);
    await migrate(db);
    expect(await db.getAllAsync("SELECT key FROM settings WHERE key LIKE '%shift_minutes:%'")).toEqual([]);
    expect(await db.getAllAsync('SELECT title FROM programmes')).toEqual([{title:'M3U behold'}]);
    expect(await db.getAllAsync('SELECT * FROM epg_fetch')).toEqual([]);
    expect(await db.getAllAsync('SELECT * FROM epg_archive_fetch')).toEqual([]);
    expect(await db.getFirstAsync('SELECT name FROM favorite_groups')).toEqual({name:'US'});
    expect(await db.getFirstAsync('SELECT channel_id FROM favorite_group_members')).toEqual({channel_id:'panel:dr2'});
    expect(await db.getFirstAsync('SELECT position_s FROM archive_progress')).toEqual({position_s:300});
    expect(await db.getFirstAsync('SELECT position_s FROM vod_progress')).toEqual({position_s:300});
    expect(await db.getFirstAsync('SELECT series_key FROM followed_series')).toEqual({series_key:'panel:serie'});
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key='theme_mode'")).toEqual({value:'dark'});
    await upsertProgrammes(db,[{channelId:'panel:dr2',title:'Frisk oversigt',description:null,start:new Date(1000),stop:new Date(2000)}]);
    await db.execAsync("INSERT INTO epg_fetch VALUES ('panel:dr2',456)");
    await migrate(db);
    expect(await db.getFirstAsync("SELECT title FROM programmes WHERE channel_id='panel:dr2'")).toEqual({title:'Frisk oversigt'});
    expect(await db.getFirstAsync('SELECT fetched_at FROM epg_fetch')).toEqual({fetched_at:456});
  });
});

describe('v423: arkivets +60 fra v418 fjernes', () => {
  it('fra skema 33 ryddes kun korrektionerne; EPG, favoritter og indstillinger bliver', async () => {
    const db = createTestDatabase(); await migrate(db);
    await db.execAsync(`
      INSERT INTO sources(id,kind,name,url,created_at) VALUES ('panel','xtream','Min kilde','https://example.invalid',1);
      INSERT INTO channels(id,source_id,stream_id,name) VALUES ('panel:dr1','panel','1','DR1');
      INSERT INTO favorites(channel_id) VALUES ('panel:dr1');
      INSERT INTO programmes VALUES ('panel:dr1',1000,2000,'Gemt EPG',NULL);
      INSERT INTO epg_archive_fetch VALUES ('panel:dr1',123);
      INSERT INTO settings VALUES ('archive_shift_minutes:panel','60'),('epg_shift_minutes:panel','60'),('theme_mode','dark'),('panel_offset_minutes:panel','60');
      PRAGMA user_version=33;
    `);
    await migrate(db);
    expect(await db.getAllAsync("SELECT key FROM settings WHERE key LIKE '%shift_minutes:%'")).toEqual([]);
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key='theme_mode'")).toEqual({value:'dark'});
    expect(await db.getFirstAsync("SELECT value FROM settings WHERE key='panel_offset_minutes:panel'")).toEqual({value:'60'});
    expect(await db.getAllAsync('SELECT title FROM programmes')).toEqual([{title:'Gemt EPG'}]);
    expect(await db.getAllAsync('SELECT * FROM epg_archive_fetch')).toEqual([{stream_id:'panel:dr1',fetched_at:123}]);
    expect(await db.getAllAsync('SELECT channel_id FROM favorites')).toEqual([{channel_id:'panel:dr1'}]);
  });

  it('en frisk installation og en opgradering fra skema 30 faar ingen korrektion', async () => {
    const fresh = createTestDatabase(); await migrate(fresh);
    expect(await fresh.getAllAsync("SELECT key FROM settings WHERE key LIKE '%shift_minutes:%'")).toEqual([]);
  });
});
