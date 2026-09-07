import { beforeEach, describe, expect, it } from 'vitest';
import { listChannels, replaceCategories, replaceChannels, setFavorite } from './channels.js';
import {
  clearLogoOverride,
  listChannelsWithoutArchiveLogo,
  searchRegistryLogos,
  setLogoOverride,
} from './logoOverrides.js';
import { migrate } from './schema.js';
import { addSource } from './sources.js';
import { createTestDatabase } from './testDb.js';
import type { SqlDatabase } from './types.js';

let db: SqlDatabase;
let sourceId: string;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  sourceId = (await addSource(db, { kind: 'xtream', name: 'P', url: 'http://p' })).id;
  await replaceCategories(db, sourceId, [{ id: '1', name: 'DANMARK' }]);
  await replaceChannels(
    db,
    sourceId,
    [
      { id: '1', name: 'DNK| DR1 HD', number: 1, logoUrl: 'http://dead/dr1.png', categoryId: '1', epgChannelId: null, hasArchive: false, archiveDays: 0 },
      { id: '2', name: 'DNK| CION HD', number: 2, logoUrl: 'http://dead/cion.png', categoryId: '1', epgChannelId: null, hasArchive: false, archiveDays: 0 },
    ],
    undefined,
    new Map([['1', 'DK']]),
  );
  await db.runAsync("INSERT INTO registry_logos (key, country, url) VALUES ('DR1:DK', 'DK', 'https://logo/dr1.png')");
  await db.runAsync("INSERT INTO registry_logos (key, country, url) VALUES ('DR1:*', 'DK', 'https://logo/dr1.png')");
  await db.runAsync("INSERT INTO registry_logos (key, country, url) VALUES ('DR2:DK', 'DK', 'https://logo/dr2.png')");
  await db.runAsync("INSERT INTO registry_logos (key, country, url) VALUES ('id:dr1.dk', 'DK', 'https://logo/dr1.png')");
});

describe('eget logo', () => {
  it('staar foerst i raekken, foer udbyderens og registrets', async () => {
    await setLogoOverride(db, `${sourceId}:1`, ' https://mit/dr1.png ');
    const dr1 = (await listChannels(db)).find((c) => c.name === 'DNK| DR1 HD');
    expect(dr1?.logoUrls[0]).toBe('https://mit/dr1.png');
    expect(dr1?.logoUrls).toContain('https://logo/dr1.png');
  });

  it('kan fjernes igen', async () => {
    await setLogoOverride(db, `${sourceId}:1`, 'https://mit/dr1.png');
    await clearLogoOverride(db, `${sourceId}:1`);
    const dr1 = (await listChannels(db)).find((c) => c.name === 'DNK| DR1 HD');
    expect(dr1?.logoUrls).not.toContain('https://mit/dr1.png');
  });
});

describe('searchRegistryLogos', () => {
  it('finder paa et navn skrevet som panelet skriver det', async () => {
    const hits = await searchRegistryLogos(db, 'dr 1 hd');
    expect(hits.map((h) => h.url)).toEqual(['https://logo/dr1.png']);
    expect(hits[0]).toMatchObject({ name: 'DR1', country: 'DK' });
  });

  // Samme fil ligger under flere noegler — land, stjerne, id. Den skal kun
  // vises én gang.
  it('viser hver adresse én gang', async () => {
    const hits = await searchRegistryLogos(db, 'DR');
    expect(hits.map((h) => h.url)).toEqual(['https://logo/dr1.png', 'https://logo/dr2.png']);
  });

  it('giver ingenting paa et tomt navn', async () => {
    expect(await searchRegistryLogos(db, '  ')).toEqual([]);
  });
});

describe('listChannelsWithoutArchiveLogo', () => {
  it('lister dem intet arkiv kender, favoritter foerst', async () => {
    await setFavorite(db, `${sourceId}:2`, true);
    const rows = await listChannelsWithoutArchiveLogo(db);
    // DR1 findes i registret; CION goer ikke.
    expect(rows.map((r) => r.name)).toEqual(['DNK| CION HD']);
    expect(rows[0]?.isFavorite).toBe(true);
  });

  it('tager en kanal ud af listen naar den har faaet et eget logo', async () => {
    await setLogoOverride(db, `${sourceId}:2`, 'https://mit/cion.png');
    expect(await listChannelsWithoutArchiveLogo(db)).toEqual([]);
  });

  it('kan soeges i', async () => {
    expect((await listChannelsWithoutArchiveLogo(db, { search: 'cion' })).length).toBe(1);
    expect((await listChannelsWithoutArchiveLogo(db, { search: 'zzz' })).length).toBe(0);
  });
});
