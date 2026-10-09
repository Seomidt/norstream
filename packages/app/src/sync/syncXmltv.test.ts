import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import type { FetchLike, Source } from '@norstream/core';
import { listChannels } from '../storage/channels.js';
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

/** Serverer en gzippet oversigt: teksten er volapyk, men arrayBuffer giver .gz-bytes. */
function servingGzip(body: string): FetchLike {
  const gz = gzipSync(Buffer.from(body, 'utf8'));
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => 'IKKE-UDPAKKET',
    arrayBuffer: async () => gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.byteLength),
    headers: { get: () => null },
  })) as unknown as FetchLike;
}

/** Serverer forskellige kroppe alt efter hvilken adresse der spoerges paa. */
function servingByUrl(map: Record<string, string>): FetchLike {
  return vi.fn(async (url: string) => {
    const body = map[url] ?? '';
    return {
      ok: body.length > 0,
      status: body.length > 0 ? 200 : 404,
      json: async () => ({}),
      text: async () => body,
      headers: { get: () => null },
    };
  }) as unknown as FetchLike;
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
    expect(result).toEqual({ programmes: 0, matched: 0, logos: 0 });
  });

  it('pakker en gzippet (.xml.gz) oversigt ud', async () => {
    const result = await syncXmltv(
      db,
      source({ xmltvUrl: 'http://liste.example/epg.xml.gz' }),
      servingGzip(XMLTV),
    );
    expect(result.programmes).toBe(1);
    const stored = await listProgrammes(
      db,
      'm1:dr1.dk',
      new Date('2026-09-06T17:00:00Z'),
      new Date('2026-09-06T20:00:00Z'),
    );
    expect(stored.map((p) => p.title)).toEqual(['TV Avisen']);
  });

  it('henter fra flere adresser i samme felt', async () => {
    const XMLTV2 = `<?xml version="1.0"?>
<tv><programme start="20260906200000 +0000" stop="20260906210000 +0000" channel="tv2.dk"><title>Nyhederne</title></programme></tv>`;
    const result = await syncXmltv(
      db,
      source({ xmltvUrl: 'http://a/1.xml, http://a/2.xml' }),
      servingByUrl({ 'http://a/1.xml': XMLTV, 'http://a/2.xml': XMLTV2 }),
    );
    // dr1 fra den ene fil + tv2 fra den anden; begge kanaler er i listen.
    expect(result.programmes).toBe(2);
    expect(result.matched).toBe(2);
  });

  it('lader de oevrige adresser koere selv om én fejler', async () => {
    const result = await syncXmltv(
      db,
      source({ xmltvUrl: 'http://a/nede.xml http://a/2.xml' }),
      servingByUrl({ 'http://a/2.xml': XMLTV }),
    );
    // Kun 'nede.xml' fejler (404); den anden fil giver stadig sit ene program.
    expect(result.programmes).toBe(1);
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

describe('naar kanalen ingen tvg-id har', () => {
  /** Sadan ser panelets kanaler ud: 87 % har intet epg_channel_id. */
  async function panelChannel(name: string, matchKey: string, id = 'p1:1'): Promise<void> {
    await db.runAsync(
      `INSERT INTO channels (id, source_id, stream_id, name, match_key, country)
       VALUES (?, 'p1', '1', ?, ?, 'DK')`,
      [id, name, matchKey],
    );
  }

  const PANEL = (): Source => source({ id: 'p1', kind: 'xtream' });

  it('matcher paa navnet naar XMLTV skriver DR1.dk', async () => {
    // Landeendelsen er ikke en del af kanalens navn.
    await panelChannel('DNK| DR1 HD', 'DR1');
    const result = await syncXmltv(db, PANEL(), serving(XMLTV));
    expect(result.matched).toBe(1);
    const stored = await listProgrammes(
      db,
      'p1:1',
      new Date('2026-09-06T17:00:00Z'),
      new Date('2026-09-06T20:00:00Z'),
    );
    expect(stored.map((p) => p.title)).toEqual(['TV Avisen']);
  });

  it('saetter EPG paa ALLE kvalitets-varianter med samme navn', async () => {
    // Panelet har baade DR1 HD og DR1 HEVC — samme kanal, samme EPG. Begge
    // skal have programmerne; foer droppede den navnet som "flertydigt", og saa
    // stod stort set hele panelet uden EPG fra filerne.
    await panelChannel('DNK| DR1 HD', 'DR1', 'p1:1');
    await panelChannel('DNK| DR1 HEVC', 'DR1', 'p1:2');
    const result = await syncXmltv(db, PANEL(), serving(XMLTV));
    expect(result.matched).toBe(2);
    for (const id of ['p1:1', 'p1:2']) {
      const stored = await listProgrammes(
        db,
        id,
        new Date('2026-09-06T17:00:00Z'),
        new Date('2026-09-06T20:00:00Z'),
      );
      expect(stored.map((p) => p.title)).toEqual(['TV Avisen']);
    }
  });

  it('haenger IKKE EPG paa et generisk navn delt af mange kanaler', async () => {
    // Ni kanaler hedder alle "SPORT" (normaliseret). Det er ikke samme kanal;
    // et program paa dem alle ville gange programtabellen op. Over loftet -> drop.
    for (let i = 1; i <= 9; i += 1) {
      await panelChannel(`DNK| SPORT ${i}`, 'SPORT', `p1:${i}`);
    }
    const xml = `<?xml version="1.0"?>
<tv>
  <programme start="20260906180000 +0000" stop="20260906190000 +0000" channel="sport.dk">
    <title>Kamp</title>
  </programme>
</tv>`;
    const result = await syncXmltv(db, PANEL(), serving(xml));
    expect(result.matched).toBe(0);
  });

  it('matcher paa feed-kanalens visningsnavn naar id er ukendt', async () => {
    // epgshare skriver tit et ordknudret id (`I2.dr1.dk`) men et paent
    // <display-name>DR1</display-name>. Programmet skal ramme paa navnet.
    await panelChannel('DNK| DR1 HD', 'DR1', 'p1:1');
    const xml = `<?xml version="1.0"?>
<tv>
  <channel id="I2.dr1.dk"><display-name>DR1</display-name></channel>
  <programme start="20260906180000 +0000" stop="20260906190000 +0000" channel="I2.dr1.dk">
    <title>TV Avisen</title>
  </programme>
</tv>`;
    const result = await syncXmltv(db, PANEL(), serving(xml));
    expect(result.matched).toBe(1);
    const stored = await listProgrammes(
      db,
      'p1:1',
      new Date('2026-09-06T17:00:00Z'),
      new Date('2026-09-06T20:00:00Z'),
    );
    expect(stored.map((p) => p.title)).toEqual(['TV Avisen']);
  });

  it('lader tvg-id vinde over navnet', async () => {
    await db.runAsync(
      `INSERT INTO channels (id, source_id, stream_id, name, match_key, epg_channel_id, country)
       VALUES ('p1:9', 'p1', '9', 'Noget andet', 'NOGETANDET', 'dr1.dk', 'DK')`,
    );
    await panelChannel('DNK| DR1 HD', 'DR1', 'p1:1');

    await syncXmltv(db, PANEL(), serving(XMLTV));

    const stored = await listProgrammes(
      db,
      'p1:9',
      new Date('2026-09-06T17:00:00Z'),
      new Date('2026-09-06T20:00:00Z'),
    );
    expect(stored).toHaveLength(1);
  });
});

describe('logoer fra filen', () => {
  // Det er her standarden har dem: <channel><icon>. En udbyder der leverer
  // en XMLTV-fil, leverer altsaa tit ogsaa logoerne.
  it('gemmer logoet for den kanal filen beskriver, og saetter det foerst', async () => {
    const xml =
      '<tv><channel id="dr1.dk"><icon src="https://xmltv/dr1.png"/></channel>' +
      '<channel id="andet.dk"><display-name>TV 2</display-name><icon src="https://xmltv/tv2.png"/></channel>' +
      '<programme start="20260906180000 +0000" stop="20260906190000 +0000" channel="dr1.dk"><title>N</title></programme></tv>';

    const result = await syncXmltv(db, source(), serving(xml));

    expect(result.logos).toBe(2);
    const channels = await listChannels(db);
    // Paa id for DR1, paa visningsnavnet for TV 2 — og foerst i raekken.
    expect(channels.find((c) => c.name === 'DR1')?.logoUrls[0]).toBe('https://xmltv/dr1.png');
    expect(channels.find((c) => c.name === 'TV 2')?.logoUrls[0]).toBe('https://xmltv/tv2.png');
  });

  it('giver ikke et logo til et navn der gaar igen paa flere kanaler', async () => {
    // Panelet har `DR1 HD` og `DR1 HEVC` som to raekker med samme
    // normaliserede navn. Et logo maa ikke lande paa en tilfaeldig af dem.
    const twins = `#EXTM3U
#EXTINF:-1 group-title="Danmark",DR1 HD
http://liste.example/a.m3u8
#EXTINF:-1 group-title="Danmark",DR1 HEVC
http://liste.example/b.m3u8
`;
    const twinSource = source({ id: 'm2', url: 'http://liste.example/twins.m3u' });
    await syncM3u(db, twinSource, serving(twins));
    const xml = '<tv><channel id="x"><display-name>DR1</display-name><icon src="https://xmltv/dr1.png"/></channel></tv>';

    const result = await syncXmltv(db, twinSource, serving(xml));

    expect(result.logos).toBe(0);
  });

  it('rydder filens gamle logoer naar den hentes igen', async () => {
    await syncXmltv(db, source(), serving('<tv><channel id="dr1.dk"><icon src="https://xmltv/gammel.png"/></channel></tv>'));
    await syncXmltv(db, source(), serving('<tv></tv>'));
    const dr1 = (await listChannels(db)).find((c) => c.name === 'DR1');
    expect(dr1?.logoUrls).not.toContain('https://xmltv/gammel.png');
  });
});
