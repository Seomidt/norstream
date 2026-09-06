import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '@norstream/core';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { registryLogoFor, syncLogoRegistry } from './syncLogoRegistry.js';

const CHANNELS = `id,name,alt_names,network,owners,country,categories,is_nsfw,launched,closed,replaced_by,website
DR1.dk,DR1,DR Et,,,DK,general,FALSE,,,,
TV2.dk,TV 2,,,,DK,general,FALSE,,,,
TV2.no,TV 2,,,,NO,general,FALSE,,,,
Stor.dk,Stor Kanal,,,,DK,general,FALSE,,,,
Unik.dk,Helt Unik,,,,DK,general,FALSE,,,,
`;

const LOGOS = `channel,feed,in_use,tags,width,height,format,url
DR1.dk,,TRUE,,320,320,PNG,https://logo.example/dr1.png
TV2.dk,,TRUE,,320,320,PNG,https://logo.example/tv2dk.png
TV2.no,,TRUE,,320,320,PNG,https://logo.example/tv2no.png
Stor.dk,,TRUE,,2000,2000,PNG,https://logo.example/stor-kaempe.png
Stor.dk,,FALSE,,320,320,PNG,https://logo.example/stor-ubrugt.png
Unik.dk,,TRUE,,200,200,PNG,https://logo.example/unik.png
`;

function registry(channels = CHANNELS, logos = LOGOS): FetchLike {
  return vi.fn(async (url: string) => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => (url.includes('logos.csv') ? logos : channels),
  })) as unknown as FetchLike;
}

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('syncLogoRegistry', () => {
  it('finder logoet paa et panelnavn med praefiks og kvalitetsmaerke', async () => {
    await syncLogoRegistry(db, registry());
    expect(await registryLogoFor(db, 'DNK| DR1 HD', 'DK')).toBe('https://logo.example/dr1.png');
  });

  it('finder ogsaa paa et alternativt navn', async () => {
    await syncLogoRegistry(db, registry());
    expect(await registryLogoFor(db, 'DR Et HEVC', 'DK')).toBe('https://logo.example/dr1.png');
  });

  it('lader landet afgoere naar navnet gaar igen', async () => {
    await syncLogoRegistry(db, registry());
    expect(await registryLogoFor(db, 'TV 2 HD', 'DK')).toBe('https://logo.example/tv2dk.png');
    expect(await registryLogoFor(db, 'TV 2 HD', 'NO')).toBe('https://logo.example/tv2no.png');
  });

  it('giver op frem for at gaette naar landet er ukendt', async () => {
    // Et forkert logo paa en kanal der ser rigtig ud, opdager man aldrig.
    await syncLogoRegistry(db, registry());
    expect(await registryLogoFor(db, 'TV 2 HD', null)).toBeNull();
  });

  it('finder et entydigt navn ogsaa uden land', async () => {
    // De fleste af panelets kanaler har intet land vi kan udlede.
    await syncLogoRegistry(db, registry());
    expect(await registryLogoFor(db, 'Helt Unik HD', null)).toBe(
      'https://logo.example/unik.png',
    );
  });

  it('springer logoer over der er for store til en firkant paa 44 px', async () => {
    await syncLogoRegistry(db, registry());
    // Det ubrugte paa 320 px er ogsaa fravalgt; saa er der intet tilbage.
    expect(await registryLogoFor(db, 'Stor Kanal', 'DK')).toBeNull();
  });

  it('erstatter registret ved naeste hentning', async () => {
    await syncLogoRegistry(db, registry());
    await syncLogoRegistry(
      db,
      registry(
        `id,name,alt_names,network,owners,country,categories,is_nsfw,launched,closed,replaced_by,website
DR1.dk,DR1,,,,DK,general,FALSE,,,,
`,
        `channel,feed,in_use,tags,width,height,format,url
DR1.dk,,TRUE,,320,320,PNG,https://logo.example/ny.png
`,
      ),
    );
    expect(await registryLogoFor(db, 'DR1', 'DK')).toBe('https://logo.example/ny.png');
    expect(await registryLogoFor(db, 'TV 2', 'DK')).toBeNull();
  });

  it('kaster naar registret ikke kan hentes', async () => {
    const dead = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as
      unknown as FetchLike;
    await expect(syncLogoRegistry(db, dead)).rejects.toThrow('500');
  });
});
