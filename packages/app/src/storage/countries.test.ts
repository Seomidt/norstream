import { beforeEach, describe, expect, it } from 'vitest';
import { channelKey } from '@norstream/core';
import type { Category, Channel } from '@norstream/core';
import { replaceCategories, replaceChannels, listChannels } from './channels.js';
import {
  OTHER_COUNTRY_FLAG,
  OTHER_COUNTRY_KEY,
  hideCountry,
  listCategoriesInCountry,
  listCategorySummaries,
  listCountryGroups,
  listHiddenCountries,
  unhideCountry,
} from './countries.js';
import { migrate } from './schema.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

/** Alt i disse tests kommer fra én kilde; noeglen er kilde + kanalens eget id. */
const SOURCE = 'src1';
const key = (streamId: string): string => channelKey(SOURCE, streamId);


const CATEGORIES: Category[] = [
  { id: '1', name: 'DENMARK HD & HEVC' },
  { id: '2', name: 'DENMARK SPORT HD' },
  { id: '3', name: 'SWEDEN SPORT' },
  { id: '4', name: '4K UHD 3840P' },
];

function channel(id: string, categoryId: string, name = `Kanal ${id}`): Channel {
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
  channel('12', '2', 'DNK| TV3 SPORT'),
  channel('13', '3', 'SWE| SVT1'),
  channel('14', '4', 'RELAX 4K'),
];

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  await replaceCategories(db, SOURCE, CATEGORIES);
  await replaceChannels(db, SOURCE, CHANNELS);
});

describe('listCategorySummaries', () => {
  it('taeller kanaler per kategori og udleder landet', async () => {
    const summaries = await listCategorySummaries(db);
    const DK = { code: 'DK', name: 'Danmark', flag: '🇩🇰' };
    const SE = { code: 'SE', name: 'Sverige', flag: '🇸🇪' };
    expect(summaries).toEqual([
      {
        id: key('4'),
        name: '4K UHD 3840P',
        channelCount: 1,
        countryKey: OTHER_COUNTRY_KEY,
        country: null,
      },
      {
        id: key('1'),
        name: 'DENMARK HD & HEVC',
        channelCount: 2, countryKey: 'DK', country: DK },
      {
        id: key('2'),
        name: 'DENMARK SPORT HD',
        channelCount: 1, countryKey: 'DK', country: DK },
      {
        id: key('3'),
        name: 'SWEDEN SPORT',
        channelCount: 1, countryKey: 'SE', country: SE },
    ]);
  });

  it('giver nul for en kategori uden kanaler', async () => {
    await replaceChannels(db, SOURCE, []);
    const summaries = await listCategorySummaries(db);
    expect(summaries.every((s) => s.channelCount === 0)).toBe(true);
    expect(summaries).toHaveLength(4);
  });
});

describe('listCountryGroups', () => {
  it('grupperer kategorierne efter land og taeller kanaler', async () => {
    const groups = await listCountryGroups(db);
    expect(groups).toEqual([
      { key: 'DK', name: 'Danmark', flag: '🇩🇰', categoryCount: 2, channelCount: 3 },
      { key: 'SE', name: 'Sverige', flag: '🇸🇪', categoryCount: 1, channelCount: 1 },
      {
        key: OTHER_COUNTRY_KEY,
        name: 'Øvrige',
        flag: OTHER_COUNTRY_FLAG,
        categoryCount: 1,
        channelCount: 1,
      },
    ]);
  });

  it('holder Øvrige nederst uanset navnenes orden', async () => {
    // Ø sorterer sidst paa dansk i forvejen; testen skal ikke kunne bestaa
    // ved et tilfaelde, saa vi tilfoejer et land der sorterer efter Ø.
    await replaceCategories(db, SOURCE, [...CATEGORIES, { id: '5', name: 'AUSTRIA HD' }]);
    const groups = await listCountryGroups(db);
    expect(groups[groups.length - 1]?.key).toBe(OTHER_COUNTRY_KEY);
    expect(groups.map((g) => g.name)).toEqual(['Danmark', 'Sverige', 'Østrig', 'Øvrige']);
  });

  it('udelader skjulte lande fra oversigten', async () => {
    await hideCountry(db, 'SE');
    const groups = await listCountryGroups(db);
    expect(groups.map((g) => g.key)).toEqual(['DK', OTHER_COUNTRY_KEY]);
  });

  it('lader et skjult lands kanaler blive fundet via soegning', async () => {
    // Spec sec.5: skjulte lande forsvinder fra listen, ikke fra databasen.
    await hideCountry(db, 'SE');
    const found = await listChannels(db, { search: 'SVT1' });
    expect(found.map((c) => c.id)).toEqual([key('13')]);
  });

  it('viser et land igen efter unhide', async () => {
    await hideCountry(db, 'SE');
    await unhideCountry(db, 'SE');
    expect((await listCountryGroups(db)).map((g) => g.key)).toContain('SE');
  });

  it('kan skjule Øvrige som ethvert andet land', async () => {
    await hideCountry(db, OTHER_COUNTRY_KEY);
    expect((await listCountryGroups(db)).map((g) => g.key)).toEqual(['DK', 'SE']);
  });
});

describe('listHiddenCountries', () => {
  it('er tom fra start og taaler at skjule det samme land to gange', async () => {
    expect(await listHiddenCountries(db)).toEqual([]);
    await hideCountry(db, 'SE');
    await hideCountry(db, 'SE');
    expect(await listHiddenCountries(db)).toEqual(['SE']);
  });
});

describe('listCategoriesInCountry', () => {
  it('giver landets kategorier', async () => {
    const categories = await listCategoriesInCountry(db, 'DK');
    expect(categories.map((c) => c.name)).toEqual([
      'DENMARK HD & HEVC',
      'DENMARK SPORT HD',
    ]);
  });

  it('giver de uigenkendelige under Øvrige, saa ingen kategori forsvinder', async () => {
    const categories = await listCategoriesInCountry(db, OTHER_COUNTRY_KEY);
    expect(categories.map((c) => c.name)).toEqual(['4K UHD 3840P']);
  });

  it('viser ogsaa et skjult lands kategorier hvis man gaar direkte til det', async () => {
    // Skjulningen gaelder oversigten; den maa ikke laase data ude.
    await hideCountry(db, 'SE');
    expect(await listCategoriesInCountry(db, 'SE')).toHaveLength(1);
  });
});

describe('landet udledt af kanalnavnene', () => {
  it('finder landet naar kategorinavnet ikke rummer det', async () => {
    // Panelet doeber kategorien efter indhold, ikke efter land — men skriver
    // landet paa hver eneste kanal i den.
    await replaceCategories(db, SOURCE, [{ id: '9', name: 'SPORT 1080P' }]);
    await replaceChannels(db, SOURCE, [
      channel('90', '9', 'DNK| TV3 SPORT'),
      channel('91', '9', 'DNK| TV3 SPORT 2'),
    ]);

    const [summary] = await listCategorySummaries(db);
    expect(summary?.countryKey).toBe('DK');
    expect(summary?.country?.flag).toBe('🇩🇰');
  });

  it('lader flertallet afgoere det naar kanalerne ikke er enige', async () => {
    await replaceCategories(db, SOURCE, [{ id: '9', name: 'SPORT 1080P' }]);
    await replaceChannels(db, SOURCE, [
      channel('90', '9', 'SWE| SVT SPORT'),
      channel('91', '9', 'DNK| TV3 SPORT'),
      channel('92', '9', 'DNK| TV2 SPORT'),
    ]);

    expect((await listCategorySummaries(db))[0]?.countryKey).toBe('DK');
  });

  it('lader kategorinavnet vinde over kanalerne', async () => {
    // Kategorinavnet er panelets egen gruppering. En enkelt fejlmaerket kanal
    // maa ikke kunne flytte hele kategorien under et andet flag.
    await replaceCategories(db, SOURCE, [{ id: '9', name: 'SWEDEN SPORT' }]);
    await replaceChannels(db, SOURCE, [
      channel('90', '9', 'DNK| TV3 SPORT'),
      channel('91', '9', 'DNK| TV2 SPORT'),
    ]);

    expect((await listCategorySummaries(db))[0]?.countryKey).toBe('SE');
  });

  it('bliver i Øvrige naar hverken kategori eller kanaler siger noget', async () => {
    await replaceCategories(db, SOURCE, [{ id: '9', name: 'RELAX 1920P' }]);
    await replaceChannels(db, SOURCE, [channel('90', '9', 'Fireplace 4K')]);

    const [summary] = await listCategorySummaries(db);
    expect(summary?.countryKey).toBe(OTHER_COUNTRY_KEY);
    expect(summary?.country).toBeNull();
  });
});
