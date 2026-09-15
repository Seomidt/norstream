import { channelKey } from '@norstream/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Channel } from '@norstream/core';
import { migrate } from './schema.js';
import { addSource } from './sources.js';
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

/** Alt i disse tests kommer fra én kilde; noeglen er kilde + kanalens eget id. */
const SOURCE = 'src1';
const key = (streamId: string): string => channelKey(SOURCE, streamId);

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
    await replaceCategories(db, SOURCE, [
      { id: '2', name: 'Sport' },
      { id: '1', name: 'Danmark' },
    ]);
    expect(await listCategories(db)).toEqual([
      { id: key('1'), name: 'Danmark' },
      { id: key('2'), name: 'Sport' },
    ]);
  });

  it('fjerner kategorier der ikke laengere findes', async () => {
    await replaceCategories(db, SOURCE, [{ id: '1', name: 'Danmark' }]);
    await replaceCategories(db, SOURCE, [{ id: '2', name: 'Sport' }]);
    expect(await listCategories(db)).toEqual([{ id: key('2'), name: 'Sport' }]);
  });
});

describe('replaceChannels', () => {
  it('bevarer panelets raekkefoelge', async () => {
    await replaceChannels(db, SOURCE, [
      channel({ id: 'b', name: 'TV 2' }),
      channel({ id: 'a', name: 'DR1' }),
    ]);
    expect((await listChannels(db)).map((c) => c.id)).toEqual([key('b'), key('a')]);
  });

  it('bevarer favoritter paa tvaers af resynkronisering', async () => {
    await replaceChannels(db, SOURCE, [channel({ id: 'a', name: 'DR1' })]);
    await setFavorite(db, key('a'), true);
    await replaceChannels(db, SOURCE, [
      channel({ id: 'a', name: 'DR1 HD' }),
      channel({ id: 'b', name: 'TV 2' }),
    ]);
    const a = await getChannel(db, key('a'));
    expect(a?.isFavorite).toBe(true);
    expect(a?.name).toBe('DR1 HD');
    expect((await getChannel(db, key('b')))?.isFavorite).toBe(false);
  });

  it('fjerner kanaler panelet ikke laengere har', async () => {
    await replaceChannels(db, SOURCE, [
      channel({ id: 'a', name: 'DR1' }),
      channel({ id: 'b', name: 'TV 2' }),
    ]);
    await replaceChannels(db, SOURCE, [channel({ id: 'a', name: 'DR1' })]);
    expect((await listChannels(db)).map((c) => c.id)).toEqual([key('a')]);
  });

  it('toemmer tabellen naar panelet ikke har nogen kanaler', async () => {
    await replaceChannels(db, SOURCE, [channel({ id: 'a', name: 'DR1' })]);
    await replaceChannels(db, SOURCE, []);
    expect(await listChannels(db)).toEqual([]);
  });

  it('bevarer arkiv-felterne', async () => {
    await replaceChannels(db, SOURCE, [
      channel({ id: 'a', name: 'DR1', hasArchive: true, archiveDays: 7 }),
    ]);
    const a = await getChannel(db, key('a'));
    expect(a?.hasArchive).toBe(true);
    expect(a?.archiveDays).toBe(7);
  });
});

describe('listChannels', () => {
  beforeEach(async () => {
    await replaceChannels(db, SOURCE, [
      channel({ id: 'a', name: 'DR1', categoryId: '1' }),
      channel({ id: 'b', name: 'TV 2 Sport', categoryId: '2' }),
      channel({ id: 'c', name: 'Kanal 5', categoryId: '1' }),
    ]);
  });

  it('filtrerer paa kategori', async () => {
    expect((await listChannels(db, { categoryId: key('1') })).map((c) => c.id)).toEqual([key('a'), key('c')]);
  });

  it('soeger uafhaengigt af store og smaa bogstaver', async () => {
    expect((await listChannels(db, { search: 'sport' })).map((c) => c.id)).toEqual([key('b')]);
  });

  it('kombinerer kategori og soegning', async () => {
    expect(
      (await listChannels(db, { categoryId: key('1'), search: 'dr' })).map((c) => c.id),
    ).toEqual([key('a')]);
  });

  it('filtrerer paa favoritter', async () => {
    await setFavorite(db, key('c'), true);
    expect(
      (await listChannels(db, { favouritesOnly: true })).map((c) => c.id),
    ).toEqual([key('c')]);
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
    await replaceChannels(db, SOURCE, [channel({ id: 'a', name: 'DR1' })]);
    await setFavorite(db, key('a'), true);
    expect((await getChannel(db, key('a')))?.isFavorite).toBe(true);
    await setFavorite(db, key('a'), false);
    expect((await getChannel(db, key('a')))?.isFavorite).toBe(false);
  });

  it('giver null for en ukendt kanal', async () => {
    expect(await getChannel(db, key('findes-ikke'))).toBeNull();
  });

  it('slaar til for en ukendt kanal uden at fejle', async () => {
    await expect(setFavorite(db, key('ukendt-kanal'), true)).resolves.not.toThrow();
  });
});

describe('favoritter overlever synkronisering', () => {
  it('bevarer favoritter naar panelet har ingen kanaler', async () => {
    await replaceChannels(db, SOURCE, [channel({ id: 'a', name: 'DR1' })]);
    await setFavorite(db, key('a'), true);
    await replaceChannels(db, SOURCE, []);
    expect(await listChannels(db)).toHaveLength(0);
    await replaceChannels(db, SOURCE, [channel({ id: 'a', name: 'DR1' })]);
    expect((await getChannel(db, key('a')))?.isFavorite).toBe(true);
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
    await expect(replaceChannels(db, SOURCE, largeChannelList)).resolves.not.toThrow();
    const all = await listChannels(db);
    expect(all).toHaveLength(1200);
  });
});

describe('search escaping', () => {
  beforeEach(async () => {
    await replaceChannels(db, SOURCE, [
      channel({ id: 'a', name: 'DR1' }),
      channel({ id: 'b', name: 'TV 2 Sport' }),
      channel({ id: 'c', name: 'Kanal 5' }),
    ]);
  });

  it('behandler understreg i soegningen som tekst, ikke som joker', async () => {
    expect(await listChannels(db, { search: '_' })).toHaveLength(0);
  });
});

describe('logoer fra det aabne register', () => {
  it('bruger registrets logo naar udbyderen ikke har et', async () => {
    await db.runAsync("INSERT INTO sources VALUES ('src1','xtream','P','http://p:8080',NULL,NULL,1,0,0)");
    await db.runAsync("INSERT INTO registry_logos VALUES ('DR1:DK','DK','https://logo/dr1.png')");
    await replaceCategories(db, SOURCE, [{ id: '1', name: 'DENMARK HD' }]);
    await replaceChannels(
      db,
      SOURCE,
      [channel({ id: 'a', name: 'DNK| DR1 HD', categoryId: '1' })],
      undefined,
      new Map([['1', 'DK']]),
    );

    const [stored] = await listChannels(db);
    expect(stored?.logoUrls).toEqual(['https://logo/dr1.png']);
  });

  it('lader udbyderens eget logo staa foerst', async () => {
    // Registret er en reserve, ikke en erstatning: udbyderens eget logo er
    // det rigtige for netop den kanal, naar det kan hentes.
    await db.runAsync("INSERT INTO sources VALUES ('src1','xtream','P','http://p:8080',NULL,NULL,1,0,0)");
    await db.runAsync("INSERT INTO registry_logos VALUES ('DR1:DK','DK','https://logo/dr1.png')");
    await replaceCategories(db, SOURCE, [{ id: '1', name: 'DENMARK HD' }]);
    await replaceChannels(
      db,
      SOURCE,
      [
        channel({
          id: 'a',
          name: 'DNK| DR1 HD',
          categoryId: '1',
          logoUrl: 'http://103.176.90.95/images/1.png',
        }),
      ],
      undefined,
      new Map([['1', 'DK']]),
    );

    const [stored] = await listChannels(db);
    expect(stored?.logoUrls).toEqual([
      // Udbyderens egen adresse.
      'http://103.176.90.95/images/1.png',
      // Den samme sti paa panelets vaert, som ofte kan naas naar den anden ikke kan.
      'http://p:8080/images/1.png',
      // Og til sidst registrets.
      'https://logo/dr1.png',
    ]);
  });

  it('tager ikke et logo fra et andet land', async () => {
    await db.runAsync("INSERT INTO sources VALUES ('src1','xtream','P','http://p:8080',NULL,NULL,1,0,0)");
    await db.runAsync("INSERT INTO registry_logos VALUES ('TV2:NO','NO','https://logo/tv2no.png')");
    await replaceCategories(db, SOURCE, [{ id: '1', name: 'DENMARK HD' }]);
    await replaceChannels(
      db,
      SOURCE,
      [channel({ id: 'a', name: 'DNK| TV 2 HD', categoryId: '1' })],
      undefined,
      new Map([['1', 'DK']]),
    );

    expect((await listChannels(db))[0]?.logoUrls).toEqual([]);
  });
});

describe('landet paa kanalen', () => {
  // Kategorier som `SPORT 1080P` blander lande. Uden landet slaas logoet kun
  // op paa navne der er entydige i hele verden — og det er de faerreste.
  it('tages fra kanalens eget praefiks naar kategorien intet siger', async () => {
    const db = createTestDatabase();
    await migrate(db);
    const source = await addSource(db, { kind: 'xtream', name: 'P', url: 'http://p' });
    await replaceCategories(db, source.id, [{ id: '9', name: 'SPORT 1080P' }]);
    await replaceChannels(
      db,
      source.id,
      [
        { id: '1', name: 'DNK| TV3 SPORT HD', number: 1, logoUrl: null, categoryId: '9', epgChannelId: null, hasArchive: false, archiveDays: 0 },
        { id: '2', name: 'SWE| V SPORT 1', number: 2, logoUrl: null, categoryId: '9', epgChannelId: null, hasArchive: false, archiveDays: 0 },
      ],
      undefined,
      new Map(),
    );
    const rows = await db.getAllAsync<{ name: string; country: string }>(
      'SELECT name, country FROM channels ORDER BY name',
    );
    expect(rows).toEqual([
      { name: 'DNK| TV3 SPORT HD', country: 'DK' },
      { name: 'SWE| V SPORT 1', country: 'SE' },
    ]);
  });
});

