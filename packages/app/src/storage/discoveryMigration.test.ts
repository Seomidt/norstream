import { expect, it } from 'vitest';
import { createTestDatabase } from './testDb.js';
import { migrate } from './schema.js';

// Et historisk udsnit af v28/v29: ingen af de nye tabeller er til stede.
const HISTORICAL = `
CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE sources(id TEXT PRIMARY KEY,kind TEXT NOT NULL);
CREATE TABLE channels(id TEXT PRIMARY KEY,source_id TEXT NOT NULL);
CREATE TABLE programmes(channel_id TEXT NOT NULL,start_ms INTEGER NOT NULL,stop_ms INTEGER NOT NULL,title TEXT NOT NULL,description TEXT,PRIMARY KEY(channel_id,start_ms));
CREATE TABLE favorites(channel_id TEXT PRIMARY KEY,position INTEGER);
CREATE TABLE vod_progress(item_key TEXT PRIMARY KEY,position_s REAL,duration_s REAL,updated_ms INTEGER);
CREATE TABLE followed_series(series_key TEXT PRIMARY KEY,followed_ms INTEGER NOT NULL,seen_episodes INTEGER NOT NULL);
INSERT INTO favorites VALUES('source:us-favourite',3);
INSERT INTO vod_progress VALUES('source:series:episode',402,1800,100);
INSERT INTO followed_series VALUES('source:series',99,8);
`;
for (const version of [28, 29]) {
  it(`opgraderer v${version} uden at miste favoritter, fremdrift eller fulgte serier`, async () => {
    const db = createTestDatabase();
    await db.execAsync(HISTORICAL + `PRAGMA user_version=${version};`);
    await migrate(db);
    await migrate(db);
    expect(await db.getFirstAsync('PRAGMA user_version')).toEqual({ user_version: 33 });
    expect(await db.getFirstAsync('SELECT * FROM favorites')).toEqual({ channel_id: 'source:us-favourite', position: 3 });
    expect(await db.getFirstAsync('SELECT position_s FROM vod_progress')).toEqual({ position_s: 402 });
    expect(await db.getFirstAsync('SELECT * FROM followed_series')).toEqual({ series_key: 'source:series', followed_ms: 99, seen_episodes: 8 });
    const names = (await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'")).map(row => row.name);
    expect(names).toEqual(expect.arrayContaining(['movie_collections', 'movie_collection_members', 'movie_collection_lookup', 'followed_series_state', 'followed_episode_state']));
    expect(await db.getFirstAsync('SELECT COUNT(*) AS n FROM followed_episode_state')).toEqual({ n: 0 });
  });
}
