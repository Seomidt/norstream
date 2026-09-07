import { beforeEach, describe, expect, it } from 'vitest';
import type { VodItem } from '@norstream/core';
import { migrate } from './schema.js';
import { addSource, deleteSource } from './sources.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';
import {
  getProgress,
  getVodDetails,
  getVodItem,
  listEpisodes,
  listVodCategoriesInCountry,
  listVodCountryGroups,
  listVodItems,
  replaceEpisodes,
  replaceVodCategories,
  replaceVodItems,
  saveProgress,
  saveVodDetails,
  setInWatchlist,
  vodCounts,
} from './vod.js';

let db: SqlDatabase;
let sourceId: string;

function movie(id: string, name: string, categoryId: string | null, extra: Partial<VodItem> = {}): VodItem {
  return {
    id,
    kind: 'movie',
    name,
    posterUrl: null,
    categoryId,
    rating: null,
    year: null,
    added: null,
    containerExtension: 'mkv',
    ...extra,
  };
}

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  sourceId = (await addSource(db, { kind: 'xtream', name: 'P', url: 'http://p' })).id;
  await replaceVodCategories(db, sourceId, 'movie', [
    { id: '1', name: 'DK | Film 2025' },
    { id: '2', name: 'SWEDEN | Action' },
    { id: '3', name: '4K UHD' },
  ]);
  await replaceVodItems(db, sourceId, 'movie', [
    movie('10', 'Materialists', '1', { rating: 7.3, year: 2025, added: new Date(2_000_000_000_000) }),
    movie('11', 'Druk', '1', { rating: 7.7, year: 2020, added: new Date(1_000_000_000_000) }),
    movie('12', 'Heat', '2'),
    movie('13', 'Noget i 4K', '3'),
  ]);
});

describe('film og serier i databasen', () => {
  it('grupperer kategorierne efter land, som kanalerne', async () => {
    const groups = await listVodCountryGroups(db, 'movie');
    expect(groups.map((g) => [g.key, g.channelCount])).toEqual([
      ['DK', 2],
      ['SE', 1],
      // Øvrige nederst, altid.
      ['__other__', 1],
    ]);
  });

  it('finder kategorierne i et land', async () => {
    const categories = await listVodCategoriesInCountry(db, 'movie', 'DK');
    expect(categories.map((c) => c.name)).toEqual(['DK | Film 2025']);
    expect(categories[0]?.itemCount).toBe(2);
  });

  it('lister filmene i en kategori i panelets raekkefoelge', async () => {
    const [category] = await listVodCategoriesInCountry(db, 'movie', 'DK');
    const items = await listVodItems(db, { categoryId: category?.id });
    expect(items.map((i) => i.name)).toEqual(['Materialists', 'Druk']);
    expect(items[0]?.categoryName).toBe('DK | Film 2025');
    expect(items[0]?.containerExtension).toBe('mkv');
  });

  it('kan vise de nyeste foerst', async () => {
    const items = await listVodItems(db, { kind: 'movie', newestFirst: true, limit: 2 });
    expect(items.map((i) => i.name)).toEqual(['Materialists', 'Druk']);
  });

  it('soeger paa tvaers af kategorier', async () => {
    expect((await listVodItems(db, { search: 'hea' })).map((i) => i.name)).toEqual(['Heat']);
  });

  it('holder to kilders film adskilt', async () => {
    const other = (await addSource(db, { kind: 'xtream', name: 'Q', url: 'http://q' })).id;
    await replaceVodItems(db, other, 'movie', [movie('10', 'Samme id, anden kilde', null)]);
    expect(await listVodItems(db, { kind: 'movie' })).toHaveLength(5);
    // Og en ny hentning af den ene roerer ikke den anden.
    await replaceVodItems(db, sourceId, 'movie', []);
    expect((await listVodItems(db, { kind: 'movie' })).map((i) => i.name)).toEqual([
      'Samme id, anden kilde',
    ]);
  });

  it('taeller film og serier', async () => {
    await replaceVodItems(db, sourceId, 'series', [
      { ...movie('99', 'Jane', null), kind: 'series', containerExtension: null },
    ]);
    expect(await vodCounts(db)).toEqual({ movies: 4, series: 1 });
  });
});

describe('det panelet ved om en titel', () => {
  it('gemmes og laeses igen', async () => {
    const [item] = await listVodItems(db, { search: 'Materialists' });
    await saveVodDetails(db, item!.key, {
      posterUrl: null,
      plot: 'Handling',
      genre: 'Drama',
      cast: 'A, B',
      director: 'C',
      durationMinutes: 116,
      trailerId: 'dQw4w9WgXcQ',
      backdropUrl: 'http://p/bd.jpg',
      rating: 7.3,
      year: 2025,
    });
    const stored = await getVodDetails(db, item!.key);
    expect(stored?.details.plot).toBe('Handling');
    expect(stored?.details.trailerId).toBe('dQw4w9WgXcQ');
  });

  it('gemmer afsnittene i raekkefoelge', async () => {
    await replaceVodItems(db, sourceId, 'series', [
      { ...movie('99', 'Jane', null), kind: 'series', containerExtension: null },
    ]);
    const [series] = await listVodItems(db, { kind: 'series' });
    await replaceEpisodes(db, series!.key, [
      { id: 'b', seriesId: '99', season: 2, episode: 1, title: 'S2E1', plot: null, durationMinutes: null, containerExtension: 'mkv', airDate: null },
      { id: 'a', seriesId: '99', season: 1, episode: 1, title: 'Pilot', plot: 'x', durationMinutes: 42, containerExtension: 'mkv', airDate: '2014-10-13' },
    ]);
    const episodes = await listEpisodes(db, series!.key);
    expect(episodes.map((e) => e.title)).toEqual(['Pilot', 'S2E1']);
    expect(episodes[0]?.key).toBe(`${series!.key}:a`);
  });
});

describe('min liste og fortsaet', () => {
  it('laegger en titel til side og tager den af igen', async () => {
    const [item] = await listVodItems(db, { search: 'Druk' });
    await setInWatchlist(db, item!.key, true);
    expect((await listVodItems(db, { watchlistOnly: true })).map((i) => i.name)).toEqual(['Druk']);
    expect((await getVodItem(db, item!.key))?.inWatchlist).toBe(true);
    await setInWatchlist(db, item!.key, false);
    expect(await listVodItems(db, { watchlistOnly: true })).toEqual([]);
  });

  it('husker hvor langt man er naaet', async () => {
    const [item] = await listVodItems(db, { search: 'Heat' });
    await saveProgress(db, item!.key, 1234, 10_200);
    expect(await getProgress(db, item!.key)).toEqual({ positionSeconds: 1234, durationSeconds: 10_200 });
    expect((await listVodItems(db, { inProgressOnly: true })).map((i) => i.name)).toEqual(['Heat']);
  });

  // Et tryk paa den forkerte film skal ikke lande i "Fortsaet".
  it('gemmer ikke under et minut', async () => {
    const [item] = await listVodItems(db, { search: 'Heat' });
    await saveProgress(db, item!.key, 30, 10_200);
    expect(await getProgress(db, item!.key)).toBeNull();
  });

  it('regner en titel der er set faerdig som faerdig', async () => {
    const [item] = await listVodItems(db, { search: 'Heat' });
    await saveProgress(db, item!.key, 10_100, 10_200);
    expect(await listVodItems(db, { inProgressOnly: true })).toEqual([]);
  });
});

describe('naar kilden fjernes', () => {
  it('ryger dens film, serier, afsnit, liste og fremdrift med', async () => {
    const [item] = await listVodItems(db, { search: 'Heat' });
    await setInWatchlist(db, item!.key, true);
    await saveProgress(db, item!.key, 500, 1000);
    await deleteSource(db, sourceId);
    expect(await listVodItems(db)).toEqual([]);
    expect(await listVodCountryGroups(db, 'movie')).toEqual([]);
    expect(await getProgress(db, item!.key)).toBeNull();
  });
});
