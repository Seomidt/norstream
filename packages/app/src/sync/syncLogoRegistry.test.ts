import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike } from '@norstream/core';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { listChannels, replaceCategories, replaceChannels } from '../storage/channels.js';
import { addSource } from '../storage/sources.js';
import { registryLogoFor, syncLogoRegistry } from './syncLogoRegistry.js';

const CHANNELS = `id,name,alt_names,network,owners,country,categories,is_nsfw,launched,closed,replaced_by,website
DR1.dk,DR1,DR Et,,,DK,general,FALSE,,,,
TV2.dk,TV 2,,,,DK,general,FALSE,,,,
TV2.no,TV 2,,,,NO,general,FALSE,,,,
Stor.dk,Stor Kanal,,,,DK,general,FALSE,,,,
Unik.dk,Helt Unik,,,,DK,general,FALSE,,,,
Valg.dk,Flere Valg,,,,DK,general,FALSE,,,,
`;

const LOGOS = `channel,feed,in_use,tags,width,height,format,url
DR1.dk,,TRUE,,320,320,PNG,https://logo.example/dr1.png
TV2.dk,,TRUE,,320,320,PNG,https://logo.example/tv2dk.png
TV2.no,,TRUE,,320,320,PNG,https://logo.example/tv2no.png
Stor.dk,,TRUE,,960,960,PNG,https://logo.example/stor-960.png
Stor.dk,,FALSE,,320,320,PNG,https://logo.example/stor-ubrugt.png
Unik.dk,,TRUE,,200,200,PNG,https://logo.example/unik.png
Valg.dk,,TRUE,,2000,2000,PNG,https://logo.example/valg-2000.png
Valg.dk,,TRUE,,480,480,PNG,https://logo.example/valg-480.png
Valg.dk,,TRUE,,,,PNG,https://logo.example/valg-ukendt.png
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

  // Den her regel var vendt om: logoer bredere end 600 px blev **kasseret**,
  // og det kostede 2.828 kanaler deres eneste logo — ni procent af alle dem
  // registret har et til. Blandt dem 6'eren, Canal 9, Kanal 4, Kanal 5, TLC og
  // TV 2 Fri, som alle kun har ét, og det er 960 px bredt.
  it('tager et stort logo naar det er det eneste der er', async () => {
    await syncLogoRegistry(db, registry());
    expect(await registryLogoFor(db, 'Stor Kanal', 'DK')).toBe(
      'https://logo.example/stor-960.png',
    );
  });

  it('vaelger det smalleste naar der er flere', async () => {
    // Baandbredden var en rigtig bekymring — de bredeste i registret er
    // 16.784 px. Svaret er at vaelge det mindste, ikke at smide kanalen vaek.
    await syncLogoRegistry(db, registry());
    expect(await registryLogoFor(db, 'Flere Valg', 'DK')).toBe(
      'https://logo.example/valg-480.png',
    );
  });

  it('bruger stadig ikke et logo der er markeret ude af brug', async () => {
    await syncLogoRegistry(db, registry());
    expect(await registryLogoFor(db, 'Stor Kanal', 'DK')).not.toContain('ubrugt');
  });

  // Registrets `id` **er** XMLTV-id'et: `DR1.dk` er det samme som en
  // M3U-listes tvg-id og et panels epg_channel_id. Oplyser kilden det, er der
  // ikke noget at gaette paa.
  it('slaar op paa XMLTV-id foer navnet', async () => {
    await syncLogoRegistry(db, registry());
    expect(await registryLogoFor(db, 'Noget Helt Andet', null, 'DR1.dk')).toBe(
      'https://logo.example/dr1.png',
    );
  });

  it('er ligeglad med store og smaa bogstaver i id-et', async () => {
    await syncLogoRegistry(db, registry());
    expect(await registryLogoFor(db, 'Noget Helt Andet', null, ' TV2.DK ')).toBe(
      'https://logo.example/tv2dk.png',
    );
  });

  it('falder tilbage paa navnet naar id-et ikke kendes', async () => {
    await syncLogoRegistry(db, registry());
    expect(await registryLogoFor(db, 'DNK| DR1 HD', 'DK', 'findes.ikke')).toBe(
      'https://logo.example/dr1.png',
    );
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
    // Et navn ingen af de to kilder har — ellers maaler den her det andet
    // arkiv frem for at maale at registret blev erstattet.
    expect(await registryLogoFor(db, 'Helt Unik', 'DK')).toBeNull();
  });

  it('kaster naar registret ikke kan hentes', async () => {
    const dead = vi.fn(async () => ({ ok: false, status: 500, text: async () => '', json: async () => ({}) })) as
      unknown as FetchLike;
    await expect(syncLogoRegistry(db, dead)).rejects.toThrow('500');
  });
});

// `registryLogoFor` og SQL-sammenkoblingen i `listChannels` slaar det samme op
// ad hver sin vej. Gaar de fra hinanden, viser indstillingernes taeller ét og
// listen noget andet — og saa er der ingen at tro paa.
describe('kanallisten faar det samme som opslaget', () => {
  it('bruger XMLTV-id-et naar kanalen har et', async () => {
    await syncLogoRegistry(db, registry());
    const source = await addSource(db, {
      kind: 'xtream',
      name: 'P',
      url: 'http://panel.example:8080',
    });
    await replaceCategories(db, source.id, [{ id: '1', name: 'DANMARK' }]);
    await replaceChannels(
      db,
      source.id,
      [
        {
          id: '1',
          // Navnet ligner ingenting i registret; id-et er det der binder.
          name: 'DNK| KANAL UDEN GENKENDELIGT NAVN',
          number: 1,
          logoUrl: null,
          categoryId: '1',
          epgChannelId: 'DR1.dk',
          hasArchive: false,
          archiveDays: 0,
        },
      ],
      undefined,
      new Map([['1', 'DK']]),
    );

    const channel = (await listChannels(db))[0];
    expect(channel?.logoUrls).toEqual(['https://logo.example/dr1.png']);
  });

  it('falder tilbage paa navn og land uden id', async () => {
    await syncLogoRegistry(db, registry());
    const source = await addSource(db, {
      kind: 'xtream',
      name: 'P',
      url: 'http://panel.example:8080',
    });
    await replaceCategories(db, source.id, [{ id: '1', name: 'DANMARK' }]);
    await replaceChannels(
      db,
      source.id,
      [
        {
          id: '1',
          name: 'DNK| TV 2 HD',
          number: 1,
          logoUrl: null,
          categoryId: '1',
          epgChannelId: null,
          hasArchive: false,
          archiveDays: 0,
        },
      ],
      undefined,
      new Map([['1', 'DK']]),
    );

    // Det danske, ikke det norske. Begge hedder TV 2.
    expect((await listChannels(db))[0]?.logoUrls).toEqual(['https://logo.example/tv2dk.png']);
  });
});
