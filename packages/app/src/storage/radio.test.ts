import { beforeEach, describe, expect, it } from 'vitest';
import type { RadioStation } from '../sync/radioBrowser.js';
import {
  getRadioStation,
  listRadioFavorites,
  listRadioFavoriteIds,
  moveRadioFavorite,
  reorderRadioFavorites,
  listRadioStations,
  radioStationsFetchedMs,
  rememberRadioStation,
  saveRadioStations,
  setRadioFavorite,
} from './radio.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

let db: SqlDatabase;

function station(id: string, name: string, country = 'DK'): RadioStation {
  return { id, name, country, url: `https://s/${id}`, logoUrl: null, homepage: null, votes: 1, codec: 'MP3', bitrate: 128, tags: ['pop', 'dansk'] };
}

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('radio-stationer', () => {
  it('gemmer et lands stationer i orden og husker hvornaar', async () => {
    await saveRadioStations(db, 'DK', [station('a', 'P3'), station('b', 'P4')], 1_000);
    expect((await listRadioStations(db, 'DK')).map((s) => s.name)).toEqual(['P3', 'P4']);
    expect(await radioStationsFetchedMs(db, 'DK')).toBe(1_000);
    expect(await radioStationsFetchedMs(db, 'SE')).toBeNull();
    expect((await getRadioStation(db, 'a'))?.tags).toEqual(['pop', 'dansk']);
  });

  it('erstatter landets liste uden at roere andre lande', async () => {
    await saveRadioStations(db, 'DK', [station('a', 'P3')]);
    await saveRadioStations(db, 'SE', [station('s', 'SR P1', 'SE')]);
    await saveRadioStations(db, 'DK', [station('c', 'P1')]);
    expect((await listRadioStations(db, 'DK')).map((s) => s.id)).toEqual(['c']);
    expect((await listRadioStations(db, 'SE')).map((s) => s.id)).toEqual(['s']);
  });

  it('holder favoritter i valgt orden, og husker en station fra en soegning', async () => {
    await saveRadioStations(db, 'DK', [station('a', 'P3'), station('b', 'P4')]);
    await setRadioFavorite(db, 'b', true);
    await setRadioFavorite(db, 'a', true);
    expect(await listRadioFavoriteIds(db)).toEqual(new Set(['a', 'b']));
    expect((await listRadioFavorites(db)).map((s) => s.id)).toEqual(['b', 'a']);
    await setRadioFavorite(db, 'b', false);
    expect((await listRadioFavorites(db)).map((s) => s.id)).toEqual(['a']);

    await rememberRadioStation(db, station('z', 'Fundet', 'NO'));
    await setRadioFavorite(db, 'z', true);
    expect((await listRadioFavorites(db)).map((s) => s.id)).toEqual(['a', 'z']);
    // Landets liste er ikke roert af den huskede.
    expect((await listRadioStations(db, 'NO')).map((s) => s.id)).toEqual(['z']);
  });

  it('skriver hele raekkefoelgen om paa én gang', async () => {
    await saveRadioStations(db, 'DK', [station('a', 'P3'), station('b', 'P4'), station('c', 'P5')]);
    for (const id of ['a', 'b', 'c']) await setRadioFavorite(db, id, true);
    await reorderRadioFavorites(db, ['c', 'a', 'b', 'ukendt']);
    expect((await listRadioFavorites(db)).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('flytter en favorit op og ned, og goer intet ved kanten', async () => {
    await saveRadioStations(db, 'DK', [station('a', 'P3'), station('b', 'P4'), station('c', 'P5')]);
    for (const id of ['a', 'b', 'c']) await setRadioFavorite(db, id, true);
    expect((await listRadioFavorites(db)).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    await moveRadioFavorite(db, 'c', -1);
    expect((await listRadioFavorites(db)).map((s) => s.id)).toEqual(['a', 'c', 'b']);
    await moveRadioFavorite(db, 'a', -1);
    expect((await listRadioFavorites(db)).map((s) => s.id)).toEqual(['a', 'c', 'b']);
    await moveRadioFavorite(db, 'a', 1);
    expect((await listRadioFavorites(db)).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });
});
