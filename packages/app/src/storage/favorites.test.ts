import { beforeEach, describe, expect, it } from 'vitest';
import { channelKey } from '@norstream/core';
import type { Category, Channel } from '@norstream/core';
import { replaceCategories, replaceChannels, setFavorite } from './channels.js';
import { listChannels } from './channels.js';
import {
  addCategoryToFavorites,
  favoriteCategories,
  moveFavorite,
  removeCategoryFromFavorites,
} from './favorites.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

/** Alt i disse tests kommer fra én kilde; noeglen er kilde + kanalens eget id. */
const SOURCE = 'src1';
const key = (streamId: string): string => channelKey(SOURCE, streamId);


const CATEGORIES: Category[] = [
  { id: '1', name: 'DENMARK HD & HEVC' },
  { id: '2', name: 'SWEDEN SPORT' },
];

function channel(id: string, categoryId: string, name: string): Channel {
  return {
    id,
    name,
    number: null,
    logoUrl: null,
    categoryId,
    epgChannelId: null,
    hasArchive: false,
    archiveDays: 0,
  };
}

const CHANNELS: Channel[] = [
  channel('10', '1', 'DNK| DR1 HD'),
  channel('11', '1', 'DNK| DR2 HD'),
  channel('20', '2', 'SWE| SVT1'),
];

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  await replaceCategories(db, SOURCE, CATEGORIES);
  await replaceChannels(db, SOURCE, CHANNELS);
});

/** Favoritterne i den orden brugeren ser dem. */
async function order(): Promise<string[]> {
  return (await listChannels(db, { favouritesOnly: true })).map((c) => c.id);
}

/** Hvilken kategori hver favorit kom fra, som den staar i tabellen. */
async function sourcesOf(): Promise<Map<string, string | null>> {
  const rows = await db.getAllAsync<{ channel_id: string; source_category_id: string | null }>(
    'SELECT channel_id, source_category_id FROM favorites',
  );
  return new Map(rows.map((row) => [row.channel_id, row.source_category_id]));
}

describe('addCategoryToFavorites', () => {
  it('kopierer kategoriens kanaler ind med deres kilde', async () => {
    const added = await addCategoryToFavorites(db, key('1'));
    expect(added).toBe(2);

    expect(await order()).toEqual([key('10'), key('11')]);
    expect((await sourcesOf()).get(key('10'))).toBe(key('1'));
  });

  it('tilfoejer kun nye kanaler naar man trykker opdatér', async () => {
    await addCategoryToFavorites(db, key('1'));
    // Udbyderen har lagt en kanal til i kategorien.
    await replaceChannels(db, SOURCE, [...CHANNELS, channel('12', '1', 'DNK| DR3')]);

    const added = await addCategoryToFavorites(db, key('1'));

    expect(added).toBe(1);
    expect(await order()).toEqual([key('10'), key('11'), key('12')]);
  });

  it('bringer ikke en kanal tilbage som brugeren selv har fjernet', async () => {
    // Spec sec.6: favoritterne er brugerens egne, og enkelte kan fjernes frit.
    await addCategoryToFavorites(db, key('1'));
    await setFavorite(db, key('11'), false);

    await addCategoryToFavorites(db, key('1'));

    expect(await order()).toEqual([key('10')]);
  });

  it('flytter ikke en kanal der allerede er favorit fra en anden kilde', async () => {
    await setFavorite(db, key('10'), true, key('2'));
    await addCategoryToFavorites(db, key('1'));

    const sources = await sourcesOf();
    expect(sources.get(key('10'))).toBe(key('2'));
    expect(sources.get(key('11'))).toBe(key('1'));
  });

  it('haenter en fjernet kanal igen naar brugeren selv favoriserer den', async () => {
    // Fravalget skal kunne fortrydes, ellers er stjernen i kanallisten en
    // knap der ikke virker for kanaler der engang kom fra en kategori.
    await addCategoryToFavorites(db, key('1'));
    await setFavorite(db, key('11'), false);
    await setFavorite(db, key('11'), true);

    await addCategoryToFavorites(db, key('1'));

    expect((await order()).sort()).toEqual([key('10'), key('11')]);
  });

  it('taeller nul naar kategorien er tom', async () => {
    await replaceChannels(db, SOURCE, []);
    await expect(addCategoryToFavorites(db, key('1'))).resolves.toBe(0);
  });
});

describe('removeCategoryFromFavorites', () => {
  it('fjerner kategoriens bidrag men lader de enkeltvise favoritter staa', async () => {
    await setFavorite(db, key('20'), true);
    await addCategoryToFavorites(db, key('1'));

    await removeCategoryFromFavorites(db, key('1'));

    expect(await order()).toEqual([key('20')]);
    expect((await sourcesOf()).get(key('20'))).toBeNull();
  });

  it('nulstiller fravalgene, saa gruppen kommer hel tilbage', async () => {
    await addCategoryToFavorites(db, key('1'));
    await setFavorite(db, key('11'), false);
    await removeCategoryFromFavorites(db, key('1'));

    await addCategoryToFavorites(db, key('1'));

    expect(await order()).toEqual([key('10'), key('11')]);
  });
});

describe('raekkefoelge', () => {
  it('laegger en ny favorit nederst, ikke i panelets orden', async () => {
    await setFavorite(db, key('20'), true);
    await setFavorite(db, key('10'), true);
    expect(await order()).toEqual([key('20'), key('10')]);
  });

  it('laegger en hel kategori nederst, i panelets orden', async () => {
    await setFavorite(db, key('20'), true);
    await addCategoryToFavorites(db, key('1'));
    expect(await order()).toEqual([key('20'), key('10'), key('11')]);
  });

  it('flytter ikke en kanal der allerede er favorit naar kategorien opdateres', async () => {
    await setFavorite(db, key('11'), true);
    await setFavorite(db, key('20'), true);
    await addCategoryToFavorites(db, key('1'));
    expect(await order()).toEqual([key('11'), key('20'), key('10')]);
  });

  it('kan flyttes til en anden plads', async () => {
    await addCategoryToFavorites(db, key('1'));
    await setFavorite(db, key('20'), true);
    await moveFavorite(db, key('20'), 0);
    expect(await order()).toEqual([key('20'), key('10'), key('11')]);
    await moveFavorite(db, key('20'), 1);
    expect(await order()).toEqual([key('10'), key('20'), key('11')]);
    await moveFavorite(db, key('10'), 99);
    expect(await order()).toEqual([key('20'), key('11'), key('10')]);
  });

  it('ignorerer en flytning af noget der ikke er favorit', async () => {
    await setFavorite(db, key('10'), true);
    await moveFavorite(db, key('20'), 0);
    expect(await order()).toEqual([key('10')]);
  });

  it('markerer kanalerne som favoritter', async () => {
    await addCategoryToFavorites(db, key('1'));
    const channels = await listChannels(db, { favouritesOnly: true });
    expect(channels.every((c) => c.isFavorite)).toBe(true);
  });
});

describe('favoriteCategories', () => {
  it('er tom naar der ingen favoritter er', async () => {
    await expect(favoriteCategories(db)).resolves.toEqual([]);
  });

  it('naevner kategorierne favoritterne kom fra, med antal, men ikke de enkeltvise', async () => {
    await setFavorite(db, key('20'), true);
    await addCategoryToFavorites(db, key('1'));
    expect(await favoriteCategories(db)).toEqual([
      { id: key('1'), name: 'DENMARK HD & HEVC', channels: 2 },
    ]);
  });

  it('udelader en kategori der er forsvundet fra panelet, men favoritterne bliver', async () => {
    await addCategoryToFavorites(db, key('1'));
    await replaceCategories(db, SOURCE, [{ id: '2', name: 'SWEDEN SPORT' }]);
    expect(await favoriteCategories(db)).toEqual([]);
    expect(await order()).toEqual([key('10'), key('11')]);
  });
});
