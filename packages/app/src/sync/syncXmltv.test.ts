import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, Source } from '@norstream/core';
import { listProgrammes } from '../storage/programmes.js';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { syncM3u } from './syncM3u.js';
import { syncXmltv } from './syncXmltv.js';

const LIST = `#EXTM3U
#EXTINF:-1 tvg-id="dr1.dk" group-title="Danmark",DR1
http://liste.example/dr1.m3u8
#EXTINF:-1 tvg-id="tv2.dk" group-title="Danmark",TV 2
http://liste.example/tv2.m3u8
`;

const XMLTV = `<?xml version="1.0"?>
<tv>
  <programme start="20260906180000 +0000" stop="20260906190000 +0000" channel="dr1.dk">
    <title>TV Avisen</title>
    <desc>Nyheder</desc>
  </programme>
  <programme start="20260906190000 +0000" stop="20260906200000 +0000" channel="ukendt.dk">
    <title>Noget helt andet</title>
  </programme>
</tv>`;

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: 'm1',
    kind: 'm3u',
    name: 'Sport',
    url: 'http://liste.example/liste.m3u',
    username: null,
    xmltvUrl: 'http://liste.example/epg.xml',
    enabled: true,
    sortOrder: 0,
    ...overrides,
  };
}

function serving(
  body: string,
  options: { ok?: boolean; status?: number; length?: string } = {},
): FetchLike {
  const { ok = true, status = 200, length } = options;
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => ({}),
    text: async () => body,
    headers: { get: (key: string) => (key.toLowerCase() === 'content-length' ? length ?? null : null) },
  })) as unknown as FetchLike;
}

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  await syncM3u(db, source(), serving(LIST));
});

describe('syncXmltv', () => {
  it('gemmer programmerne under listens egne kanalnoegler', async () => {
    const result = await syncXmltv(db, source(), serving(XMLTV));

    expect(result.programmes).toBe(1);
    const stored = await listProgrammes(
      db,
      'm1:dr1.dk',
      new Date('2026-09-06T17:00:00Z'),
      new Date('2026-09-06T20:00:00Z'),
    );
    expect(stored.map((p) => p.title)).toEqual(['TV Avisen']);
  });

  it('kasserer programmer for kanaler listen ikke har', async () => {
    // En delt XMLTV-fil daekker tit langt flere kanaler end den enkelte liste.
    const result = await syncXmltv(db, source(), serving(XMLTV));
    expect(result.matched).toBe(1);
    const all = await db.getAllAsync('SELECT * FROM programmes');
    expect(all).toHaveLength(1);
  });

  it('gør ingenting naar kilden ingen XMLTV-adresse har', async () => {
    const result = await syncXmltv(db, source({ xmltvUrl: null }), serving(XMLTV));
    expect(result).toEqual({ programmes: 0, matched: 0 });
  });

  it('afviser en oversigt der er for stor til en telefon', async () => {
    // Brugerens eget panel leverer 98 MB. React Natives fetch giver ingen
    // stroem at laese i bidder, saa filen ville blive bygget i hukommelsen
    // foer den kunne parses.
    await expect(
      syncXmltv(db, source(), serving(XMLTV, { length: '98000000' })),
    ).rejects.toThrow('98 MB');
  });

  it('siger statuskoden naar adressen afviser', async () => {
    await expect(
      syncXmltv(db, source(), serving('', { ok: false, status: 404 })),
    ).rejects.toThrow('404');
  });
});
