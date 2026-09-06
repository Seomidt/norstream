import { beforeEach, describe, expect, it } from 'vitest';
import { channelKey } from '@norstream/core';
import type { Category, Channel } from '@norstream/core';
import { replaceCategories, replaceChannels, setFavorite } from './channels.js';
import {
  addCategoryToFavorites,
  listFavoriteGroups,
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

describe('addCategoryToFavorites', () => {
  it('kopierer kategoriens kanaler ind med deres kilde', async () => {
    const added = await addCategoryToFavorites(db, key('1'));
    expect(added).toBe(2);

    const groups = await listFavoriteGroups(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.categoryId).toBe(key('1'));
    expect(groups[0]?.channels.map((c) => c.id)).toEqual([key('10'), key('11')]);
  });

  it('tilfoejer kun nye kanaler naar man trykker opdatér', async () => {
    await addCategoryToFavorites(db, key('1'));
    // Udbyderen har lagt en kanal til i kategorien.
    await replaceChannels(db, SOURCE, [...CHANNELS, channel('12', '1', 'DNK| DR3')]);

    const added = await addCategoryToFavorites(db, key('1'));

    expect(added).toBe(1);
    const groups = await listFavoriteGroups(db);
    expect(groups[0]?.channels.map((c) => c.id)).toEqual([key('10'), key('11'), key('12')]);
  });

  it('bringer ikke en kanal tilbage som brugeren selv har fjernet', async () => {
    // Spec sec.6: favoritterne er brugerens egne, og enkelte kan fjernes frit.
    await addCategoryToFavorites(db, key('1'));
    await setFavorite(db, key('11'), false);

    await addCategoryToFavorites(db, key('1'));

    const groups = await listFavoriteGroups(db);
    expect(groups[0]?.channels.map((c) => c.id)).toEqual([key('10')]);
  });

  it('flytter ikke en kanal der allerede er favorit fra en anden kilde', async () => {
    await setFavorite(db, key('10'), true, key('2'));
    await addCategoryToFavorites(db, key('1'));

    const groups = await listFavoriteGroups(db);
    const byCategory = new Map(groups.map((g) => [g.categoryId, g.channels.map((c) => c.id)]));
    expect(byCategory.get(key('2'))).toEqual([key('10')]);
    expect(byCategory.get(key('1'))).toEqual([key('11')]);
  });

  it('haenter en fjernet kanal igen naar brugeren selv favoriserer den', async () => {
    // Fravalget skal kunne fortrydes, ellers er stjernen i kanallisten en
    // knap der ikke virker for kanaler der engang kom fra en kategori.
    await addCategoryToFavorites(db, key('1'));
    await setFavorite(db, key('11'), false);
    await setFavorite(db, key('11'), true);

    await addCategoryToFavorites(db, key('1'));

    const groups = await listFavoriteGroups(db);
    const ids = groups.flatMap((g) => g.channels.map((c) => c.id));
    expect(ids.sort()).toEqual([key('10'), key('11')]);
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

    const groups = await listFavoriteGroups(db);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.categoryId).toBeNull();
    expect(groups[0]?.channels.map((c) => c.id)).toEqual([key('20')]);
  });

  it('nulstiller fravalgene, saa gruppen kommer hel tilbage', async () => {
    await addCategoryToFavorites(db, key('1'));
    await setFavorite(db, key('11'), false);
    await removeCategoryFromFavorites(db, key('1'));

    await addCategoryToFavorites(db, key('1'));

    const groups = await listFavoriteGroups(db);
    expect(groups[0]?.channels.map((c) => c.id)).toEqual([key('10'), key('11')]);
  });
});

describe('listFavoriteGroups', () => {
  it('er tom naar der ingen favoritter er', async () => {
    await expect(listFavoriteGroups(db)).resolves.toEqual([]);
  });

  it('samler de enkeltvise favoritter i deres egen gruppe oeverst', async () => {
    await setFavorite(db, key('20'), true);
    await addCategoryToFavorites(db, key('1'));

    const groups = await listFavoriteGroups(db);

    expect(groups.map((g) => g.categoryId)).toEqual([null, key('1')]);
    expect(groups[0]?.categoryName).toBe('Egne favoritter');
    expect(groups[1]?.categoryName).toBe('DENMARK HD & HEVC');
  });

  it('sorterer kategorierne efter navn', async () => {
    await addCategoryToFavorites(db, key('2'));
    await addCategoryToFavorites(db, key('1'));
    const groups = await listFavoriteGroups(db);
    expect(groups.map((g) => g.categoryName)).toEqual([
      'DENMARK HD & HEVC',
      'SWEDEN SPORT',
    ]);
  });

  it('viser stadig favoritter hvis kilde-kategorien er forsvundet fra panelet', async () => {
    await addCategoryToFavorites(db, key('1'));
    await replaceCategories(db, SOURCE, [{ id: '2', name: 'SWEDEN SPORT' }]);

    const groups = await listFavoriteGroups(db);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.categoryId).toBeNull();
    expect(groups[0]?.channels.map((c) => c.id)).toEqual([key('10'), key('11')]);
  });

  it('markerer kanalerne som favoritter', async () => {
    await addCategoryToFavorites(db, key('1'));
    const groups = await listFavoriteGroups(db);
    expect(groups[0]?.channels.every((c) => c.isFavorite)).toBe(true);
  });
});
