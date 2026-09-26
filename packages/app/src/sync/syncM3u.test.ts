import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, Source } from '@norstream/core';
import { listCategories, listChannels } from '../storage/channels.js';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { syncM3u } from './syncM3u.js';

const LIST = `#EXTM3U
#EXTINF:-1 tvg-id="dr1.dk" tvg-logo="http://logo/dr1.png" group-title="Danmark",DR1
http://liste.example/dr1.m3u8
#EXTINF:-1 tvg-id="tv2.dk" group-title="Danmark",TV 2
http://liste.example/tv2.m3u8
#EXTINF:-1 group-title="Sport",Eurosport
http://liste.example/euro.m3u8
`;

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: 'm1',
    kind: 'm3u',
    name: 'Sport',
    url: 'http://liste.example/liste.m3u',
    username: null,
    xmltvUrl: null,
    enabled: true,
    sortOrder: 0,
    ...overrides,
  };
}

function serving(body: string, ok = true, status = 200): FetchLike {
  return vi.fn(async () => ({ ok, status, json: async () => ({}), text: async () => body })) as
    unknown as FetchLike;
}

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

describe('syncM3u', () => {
  it('skriver kanalerne ind med kildens noegle og deres egen adresse', async () => {
    const result = await syncM3u(db, source(), serving(LIST));

    expect(result.channels).toBe(3);
    const channels = await listChannels(db);
    expect(channels.map((c) => c.name)).toEqual(['DR1', 'TV 2', 'Eurosport']);
    // M3U-kanaler har ingen API at bygge en adresse med; deres egen skal med.
    expect(channels[0]?.streamUrl).toBe('http://liste.example/dr1.m3u8');
    expect(channels[0]?.sourceId).toBe('m1');
    expect(channels[0]?.id).toBe('m1:dr1.dk');
  });

  it('udleder kategorierne af grupperne, som listen ikke har en liste over', async () => {
    await syncM3u(db, source(), serving(LIST));
    const categories = await listCategories(db);
    expect(categories.map((c) => c.name).sort()).toEqual(['Danmark', 'Sport']);
  });

  it('kaster naar listen ikke kan hentes, saa kalderen kan sige det', async () => {
    await expect(syncM3u(db, source(), serving('', false, 404))).rejects.toThrow('404');
    // Og der maa ikke ligge en halv liste tilbage.
    expect(await listChannels(db)).toHaveLength(0);
  });

  it('rører ikke en anden kildes kanaler', async () => {
    await syncM3u(db, source(), serving(LIST));
    await syncM3u(db, source({ id: 'm2', name: 'Anden' }), serving(LIST));

    const channels = await listChannels(db);
    expect(channels).toHaveLength(6);
    // Samme tvg-id i to lister er to forskellige kanaler.
    expect(channels.filter((c) => c.id === 'm1:dr1.dk')).toHaveLength(1);
    expect(channels.filter((c) => c.id === 'm2:dr1.dk')).toHaveLength(1);
  });

  it('erstatter kildens egne kanaler ved naeste hentning', async () => {
    await syncM3u(db, source(), serving(LIST));
    await syncM3u(
      db,
      source(),
      serving(`#EXTM3U
#EXTINF:-1 tvg-id="dr1.dk" group-title="Danmark",DR1
http://liste.example/dr1.m3u8
`),
    );
    expect(await listChannels(db)).toHaveLength(1);
  });
});
