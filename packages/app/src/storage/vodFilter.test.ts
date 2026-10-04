import { beforeEach, describe, expect, it } from 'vitest';
import type { VodItem } from '@norstream/core';
import { migrate } from './schema.js';
import { addSource } from './sources.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';
import { countVodItemsFiltered, listVodItemsFiltered, replaceVodCategories, replaceVodItems } from './vod.js';
import type { VodFilter } from './vod.js';

let db: SqlDatabase;
let sourceId: string;

function item(id: string, name: string, categoryId: string, year: number | null, rating: number | null, addedMs: number): VodItem {
  return { id, kind: 'movie', name, posterUrl: null, categoryId, rating, year, added: new Date(addedMs), containerExtension: 'mkv' };
}

const base: VodFilter = { kind: 'movie', countries: [], genres: [], yearFrom: null, yearTo: null, sort: 'newest' };

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  sourceId = (await addSource(db, { kind: 'xtream', name: 'P', url: 'http://p' })).id;
  await replaceVodCategories(db, sourceId, 'movie', [
    { id: '1', name: 'DNK| Thriller' },
    { id: '2', name: 'UK| Comedy' },
    { id: '3', name: 'DNK| Film' },
    { id: '4', name: 'US| Action' },
  ]);
  await replaceVodItems(db, sourceId, 'movie', [
    item('a', 'Natten', '1', 2026, 7.1, 500),
    item('b', 'Grin', '2', 2024, 6.0, 400),
    item('c', 'Ukendt genre', '3', 2026, null, 300),
    item('d', 'Eksplosion', '4', 2019, 8.2, 200),
    item('e', 'Gammel', '3', null, 5.5, 100),
  ]);
  // TMDB-opslag: c er en thriller fra 2026 ifoelge TMDB; e fik aar 2008.
  // TMDB's aar gaar forud for panelets, som tit er et gaet.
  await db.runAsync("INSERT INTO vod_posters (item_key, url, rating, tried_ms, genres, year) VALUES (?, NULL, 6.5, 1, ',thriller,drama,', 2026)", [`${sourceId}:movie-c`]);
  await db.runAsync("INSERT INTO vod_posters (item_key, url, rating, tried_ms, genres, year) VALUES (?, NULL, NULL, 1, '', 2008)", [`${sourceId}:movie-e`]);
  // Panelets eget genrefelt (titlen har vaeret aabnet): Grin er ogsaa romantik.
  await db.runAsync(
    "INSERT INTO vod_details (item_key, poster_url, plot, genre, cast, director, duration_min, trailer_id, backdrop_url, rating, year, fetched_ms) VALUES (?, NULL, NULL, 'Comedy, Romance', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 1)",
    [`${sourceId}:movie-b`],
  );
});

const names = (rows: { name: string }[]) => rows.map((r) => r.name);

describe('listVodItemsFiltered (v367)', () => {
  it('uden valg: alle af slagsen, nyeste foerst', async () => {
    expect(names(await listVodItemsFiltered(db, base, 50))).toEqual(['Natten', 'Grin', 'Ukendt genre', 'Eksplosion', 'Gammel']);
    expect(await countVodItemsFiltered(db, base)).toBe(5);
  });

  it('flere lande paa én gang, fra kategorinavnet', async () => {
    expect(names(await listVodItemsFiltered(db, { ...base, countries: ['DK', 'US'] }, 50))).toEqual(['Natten', 'Ukendt genre', 'Eksplosion', 'Gammel']);
    expect(names(await listVodItemsFiltered(db, { ...base, countries: ['GB'] }, 50))).toEqual(['Grin']);
  });

  it('genre fra kategorinavn, fra TMDB og fra panelets genrefelt', async () => {
    // Natten via kategorien "Thriller"; Ukendt genre via TMDB.
    expect(names(await listVodItemsFiltered(db, { ...base, genres: ['thriller'] }, 50))).toEqual(['Natten', 'Ukendt genre']);
    // Grin: kategorien "Comedy" OG detaljerne "Romance".
    expect(names(await listVodItemsFiltered(db, { ...base, genres: ['romantik'] }, 50))).toEqual(['Grin']);
    // Flere genrer = enten/eller.
    expect(names(await listVodItemsFiltered(db, { ...base, genres: ['komedie', 'action'] }, 50))).toEqual(['Grin', 'Eksplosion']);
  });

  it('aar: panelets, ellers TMDB\'s', async () => {
    expect(names(await listVodItemsFiltered(db, { ...base, yearFrom: 2026, yearTo: 2026 }, 50))).toEqual(['Natten', 'Ukendt genre']);
    expect(names(await listVodItemsFiltered(db, { ...base, yearFrom: null, yearTo: 2010 }, 50))).toEqual(['Gammel']);
    expect(await countVodItemsFiltered(db, { ...base, yearFrom: 2020, yearTo: null })).toBe(3);
  });

  it('"thriller 2026 i DK": alt paa én gang', async () => {
    const filter: VodFilter = { ...base, countries: ['DK'], genres: ['thriller'], yearFrom: 2026, yearTo: 2026 };
    expect(names(await listVodItemsFiltered(db, filter, 50))).toEqual(['Natten', 'Ukendt genre']);
  });

  it('keys: kun de titler tjeneste-opslaget gav, med de andre valg oveni (v368)', async () => {
    const keys = [`${sourceId}:movie-a`, `${sourceId}:movie-b`, `${sourceId}:movie-d`];
    expect(names(await listVodItemsFiltered(db, { ...base, keys }, 50))).toEqual(['Natten', 'Grin', 'Eksplosion']);
    expect(names(await listVodItemsFiltered(db, { ...base, keys, genres: ['action'] }, 50))).toEqual(['Eksplosion']);
    expect(await countVodItemsFiltered(db, { ...base, keys: [] })).toBe(0);
  });

  it('sortering: bedoemmelse (panelets foerst, TMDB\'s ellers, ukendte sidst), aar, titel, og sider', async () => {
    expect(names(await listVodItemsFiltered(db, { ...base, sort: 'rating' }, 50))).toEqual(['Eksplosion', 'Natten', 'Ukendt genre', 'Grin', 'Gammel']);
    expect(names(await listVodItemsFiltered(db, { ...base, sort: 'year' }, 50))).toEqual(['Natten', 'Ukendt genre', 'Grin', 'Eksplosion', 'Gammel']);
    expect(names(await listVodItemsFiltered(db, { ...base, sort: 'title' }, 2))).toEqual(['Eksplosion', 'Gammel']);
    expect(names(await listVodItemsFiltered(db, { ...base, sort: 'title' }, 2, 2))).toEqual(['Grin', 'Natten']);
  });
});
