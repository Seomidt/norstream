import { beforeEach, describe, expect, it } from 'vitest';
import type { Channel } from '@uhf-play/core';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';
import {
  getChannel,
  listCategories,
  listChannels,
  replaceCategories,
  replaceChannels,
  setFavorite,
} from './channels.js';

function channel(over: Partial<Channel> & { id: string; name: string }): Channel {
  return {
    number: null,
    logoUrl: null,
    categoryId: null,
    epgChannelId: null,
    hasArchive: false,
    archiveDays: 0,
    ...over,
  };
}

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('kategorier', () => {
  it('gemmer og henter i navnerraekkefoelge', async () => {
    await replaceCategories(db, [
      { id: '2', name: 'Sport' },
      { id: '1', name: 'Danmark' },
    ]);
    expect(await listCategories(db)).toEqual([
      { id: '1', name: 'Danmark' },
      { id: '2', name: 'Sport' },
    ]);
  });

  it('fjerner kategorier der ikke laengere findes', async () => {
    await replaceCategories(db, [{ id: '1', name: 'Danmark' }]);
    await replaceCategories(db, [{ id: '2', name: 'Sport' }]);
    expect(await listCategories(db)).toEqual([{ id: '2', name: 'Sport' }]);
  });
});

describe('replaceChannels', () => {
  it('bevarer panelets raekkefoelge', async () => {
    await replaceChannels(db, [
      channel({ id: 'b', name: 'TV 2' }),
      channel({ id: 'a', name: 'DR1' }),
    ]);
    expect((await listChannels(db)).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('bevarer favoritter paa tvaers af resynkronisering', async () => {
    await replaceChannels(db, [channel({ id: 'a', name: 'DR1' })]);
    await setFavorite(db, 'a', true);
    await replaceChannels(db, [
      channel({ id: 'a', name: 'DR1 HD' }),
      channel({ id: 'b', name: 'TV 2' }),
    ]);
    const a = await getChannel(db, 'a');
    expect(a?.isFavorite).toBe(true);
    expect(a?.name).toBe('DR1 HD');
    expect((await getChannel(db, 'b'))?.isFavorite).toBe(false);
  });

  it('fjerner kanaler panelet ikke laengere har', async () => {
    await replaceChannels(db, [
      channel({ id: 'a', name: 'DR1' }),
      channel({ id: 'b', name: 'TV 2' }),
    ]);
    await replaceChannels(db, [channel({ id: 'a', name: 'DR1' })]);
    expect((await listChannels(db)).map((c) => c.id)).toEqual(['a']);
  });

  it('toemmer tabellen naar panelet ikke har nogen kanaler', async () => {
    await replaceChannels(db, [channel({ id: 'a', name: 'DR1' })]);
    await replaceChannels(db, []);
    expect(await listChannels(db)).toEqual([]);
  });

  it('bevarer arkiv-felterne', async () => {
    await replaceChannels(db, [
      channel({ id: 'a', name: 'DR1', hasArchive: true, archiveDays: 7 }),
    ]);
    const a = await getChannel(db, 'a');
    expect(a?.hasArchive).toBe(true);
    expect(a?.archiveDays).toBe(7);
  });
});

describe('listChannels', () => {
  beforeEach(async () => {
    await replaceChannels(db, [
      channel({ id: 'a', name: 'DR1', categoryId: '1' }),
      channel({ id: 'b', name: 'TV 2 Sport', categoryId: '2' }),
      channel({ id: 'c', name: 'Kanal 5', categoryId: '1' }),
    ]);
  });

  it('filtrerer paa kategori', async () => {
    expect((await listChannels(db, { categoryId: '1' })).map((c) => c.id)).toEqual([
      'a',
      'c',
    ]);
  });

  it('soeger uafhaengigt af store og smaa bogstaver', async () => {
    expect((await listChannels(db, { search: 'sport' })).map((c) => c.id)).toEqual([
      'b',
    ]);
  });

  it('kombinerer kategori og soegning', async () => {
    expect(
      (await listChannels(db, { categoryId: '1', search: 'dr' })).map((c) => c.id),
    ).toEqual(['a']);
  });

  it('filtrerer paa favoritter', async () => {
    await setFavorite(db, 'c', true);
    expect(
      (await listChannels(db, { favouritesOnly: true })).map((c) => c.id),
    ).toEqual(['c']);
  });

  it('behandler procenttegn i soegningen som tekst, ikke som joker', async () => {
    expect(await listChannels(db, { search: '%' })).toHaveLength(0);
  });

  it('ignorerer en soegning der kun er mellemrum', async () => {
    expect(await listChannels(db, { search: '   ' })).toHaveLength(3);
  });
});

describe('setFavorite', () => {
  it('slaar til og fra', async () => {
    await replaceChannels(db, [channel({ id: 'a', name: 'DR1' })]);
    await setFavorite(db, 'a', true);
    expect((await getChannel(db, 'a'))?.isFavorite).toBe(true);
    await setFavorite(db, 'a', false);
    expect((await getChannel(db, 'a'))?.isFavorite).toBe(false);
  });

  it('giver null for en ukendt kanal', async () => {
    expect(await getChannel(db, 'findes-ikke')).toBeNull();
  });

  it('slaar til for en ukendt kanal uden at fejle', async () => {
    await expect(setFavorite(db, 'ukendt-kanal', true)).resolves.not.toThrow();
  });
});

describe('favoritter overlever synkronisering', () => {
  it('bevarer favoritter naar panelet har ingen kanaler', async () => {
    await replaceChannels(db, [channel({ id: 'a', name: 'DR1' })]);
    await setFavorite(db, 'a', true);
    await replaceChannels(db, []);
    expect(await listChannels(db)).toHaveLength(0);
    await replaceChannels(db, [channel({ id: 'a', name: 'DR1' })]);
    expect((await getChannel(db, 'a'))?.isFavorite).toBe(true);
  });
});

describe('skalering til store kanallister', () => {
  it('haandterer 1200 kanaler uden parameterfejl', async () => {
    const largeChannelList: Channel[] = [];
    for (let i = 0; i < 1200; i++) {
      largeChannelList.push(
        channel({
          id: `channel-${i}`,
          name: `Channel ${i}`,
        }),
      );
    }
    await expect(replaceChannels(db, largeChannelList)).resolves.not.toThrow();
    const all = await listChannels(db);
    expect(all).toHaveLength(1200);
  });
});

describe('search escaping', () => {
  beforeEach(async () => {
    await replaceChannels(db, [
      channel({ id: 'a', name: 'DR1' }),
      channel({ id: 'b', name: 'TV 2 Sport' }),
      channel({ id: 'c', name: 'Kanal 5' }),
    ]);
  });

  it('behandler understreg i soegningen som tekst, ikke som joker', async () => {
    expect(await listChannels(db, { search: '_' })).toHaveLength(0);
  });
});
