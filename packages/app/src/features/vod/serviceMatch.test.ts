import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VodItem } from '@norstream/core';
import { migrate } from '../../storage/schema.js';
import { addSource } from '../../storage/sources.js';
import { createTestDatabase } from '../../storage/testDb.js';
import type { SqlDatabase } from '../../storage/types.js';
import { replaceVodCategories, replaceVodItems } from '../../storage/vod.js';
import type { TmdbFetch } from '../../sync/tmdb.js';
import { resetServiceMatchForTests, titlesInPackage } from './serviceMatch.js';

let db: SqlDatabase;
let sourceId: string;

function item(id: string, name: string, year: number | null): VodItem {
  return { id, kind: 'movie', name, posterUrl: null, categoryId: '1', rating: null, year, added: new Date(1), containerExtension: 'mkv' };
}

/** TMDB's discover: side 1 har tre titler, side 2 én, side 3 tom. */
function tmdb(): TmdbFetch {
  return vi.fn(async (url: string) => {
    const page = new URL(url).searchParams.get('page');
    const results =
      page === '1'
        ? [
            { id: 100, title: 'Dune: Part Two', release_date: '2024-02-28', poster_path: '/a.jpg' },
            { id: 200, title: 'Oppenheimer', release_date: '2023-07-21', poster_path: '/b.jpg' },
            { id: 300, title: 'Findes ikke i pakken', release_date: '2022-01-01', poster_path: '/c.jpg' },
          ]
        : page === '2'
          ? [{ id: 400, title: 'Barbie', release_date: '2023-07-21', poster_path: '/d.jpg' }]
          : [];
    return { ok: true, status: 200, json: async () => ({ results }), text: async () => '' };
  }) as unknown as TmdbFetch;
}

const netflix = { id: 8, name: 'Netflix', logoUrl: null, region: 'DK' };

beforeEach(async () => {
  resetServiceMatchForTests();
  db = createTestDatabase();
  await migrate(db);
  sourceId = (await addSource(db, { kind: 'xtream', name: 'P', url: 'http://p' })).id;
  await replaceVodCategories(db, sourceId, 'movie', [{ id: '1', name: 'DNK| Film' }]);
  await replaceVodItems(db, sourceId, 'movie', [
    item('a', 'DNK| Dune Part Two (2024)', 2024),
    item('b', 'Oppenheimer', 2023),
    item('c', 'Barbie', 2023),
    item('d', 'Noget helt andet', 2020),
  ]);
  // Oppenheimer er slaaet op hos TMDB foer: matches paa id, ikke navn.
  await db.runAsync('INSERT INTO vod_posters (item_key, url, rating, tried_ms, genres, year, tmdb_id) VALUES (?, NULL, NULL, 1, \'\', 2023, 200)', [`${sourceId}:movie-b`]);
});

describe('titlesInPackage (v368)', () => {
  it('kun det pakken har: paa id naar det kendes, ellers paa navn og aar, over flere sider', async () => {
    const fetchImpl = tmdb();
    const result = await titlesInPackage(db, fetchImpl, 'key', [netflix], 'movie');
    expect(result.listed).toBe(4);
    expect(result.keys.sort()).toEqual([`${sourceId}:movie-a`, `${sourceId}:movie-b`, `${sourceId}:movie-c`].sort());
    // Side 3 var tom, saa der blev ikke bedt om side 4 og 5.
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(3);
  });

  it('husker svaret en time per tjeneste', async () => {
    const fetchImpl = tmdb();
    let clock = 1_000_000;
    await titlesInPackage(db, fetchImpl, 'key', [netflix], 'movie', { now: () => clock });
    await titlesInPackage(db, fetchImpl, 'key', [netflix], 'movie', { now: () => clock + 1000 });
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(3);
    clock += 2 * 60 * 60_000;
    await titlesInPackage(db, fetchImpl, 'key', [netflix], 'movie', { now: () => clock });
    expect(vi.mocked(fetchImpl).mock.calls.length).toBe(6);
  });

  it('flere tjenester forenes', async () => {
    const fetchImpl = tmdb();
    const result = await titlesInPackage(db, fetchImpl, 'key', [netflix, { ...netflix, id: 9, name: 'Prime' }], 'movie');
    expect(result.keys).toHaveLength(3);
    expect(result.listed).toBe(8);
  });
});
