import { beforeEach, describe, expect, it } from 'vitest';
import type { Category, Channel } from '@norstream/core';
import { replaceCategories, replaceChannels, listChannels } from './channels.js';
import {
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
  await replaceCategories(db, CATEGORIES);
  await replaceChannels(db, CHANNELS);
});

describe('listCategorySummaries', () => {
  it('taeller kanaler per kategori og udleder landet', async () => {
    const summaries = await listCategorySummaries(db);
    expect(summaries).toEqual([
      { id: '4', name: '4K UHD 3840P', channelCount: 1, countryKey: OTHER_COUNTRY_KEY },
      { id: '1', name: 'DENMARK HD & HEVC', channelCount: 2, countryKey: 'DK' },
      { id: '2', name: 'DENMARK SPORT HD', channelCount: 1, countryKey: 'DK' },
      { id: '3', name: 'SWEDEN SPORT', channelCount: 1, countryKey: 'SE' },
    ]);
  });

  it('giver nul for en kategori uden kanaler', async () => {
    await replaceChannels(db, []);
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
        flag: '',
        categoryCount: 1,
        channelCount: 1,
      },
    ]);
  });

  it('holder Øvrige nederst uanset navnenes orden', async () => {
    // Ø sorterer sidst paa dansk i forvejen; testen skal ikke kunne bestaa
    // ved et tilfaelde, saa vi tilfoejer et land der sorterer efter Ø.
    await replaceCategories(db, [...CATEGORIES, { id: '5', name: 'AUSTRIA HD' }]);
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
    expect(found.map((c) => c.id)).toEqual(['13']);
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
