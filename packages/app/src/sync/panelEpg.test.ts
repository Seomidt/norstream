import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Channel, XtreamCredentials } from '@norstream/core';
import { replaceCategories, replaceChannels, setFavorite } from '../storage/channels.js';
import { migrate } from '../storage/schema.js';
import { setPanelEpgEnabled } from '../storage/settings.js';
import { addSource } from '../storage/sources.js';
import { createTestDatabase } from '../storage/testDb.js';
import type { SqlDatabase } from '../storage/types.js';
import { syncPanelEpg } from './panelEpg.js';
import type { PanelEpgNative } from './panelEpg.js';

const NOW = new Date('2026-09-24T12:00:00.000Z');
const creds: XtreamCredentials = { baseUrl: 'http://panel.example:8080', username: 'USER', password: 'PASS' };

function ch(id: string, name: string, epgChannelId: string | null = null): Channel {
  return { id, name, number: null, logoUrl: null, categoryId: 'c1', epgChannelId, hasArchive: false, archiveDays: 0 };
}

function fakeNative(): PanelEpgNative & { calls: string[]; asked: string[][] } {
  const calls: string[] = [];
  const asked: string[][] = [];
  return {
    calls,
    asked,
    download: vi.fn(async () => {
      calls.push('download');
      return '/cache/panel-epg.xml';
    }),
    channels: vi.fn(async () => {
      calls.push('channels');
      return JSON.stringify([
        { id: 'BBCOne.uk', n: ['BBC One'] },
        { id: 'BBCOne.de', n: ['BBC One'] },
        { id: 'DR1.dk', n: ['DR1'] },
      ]);
    }),
    programmes: vi.fn(async (_path: string, idsJson: string) => {
      calls.push('programmes');
      asked.push(JSON.parse(idsJson) as string[]);
      return JSON.stringify([
        { c: 'BBCOne.uk', s: NOW.getTime(), e: NOW.getTime() + 3_600_000, t: 'BBC News', d: 'Nyheder' },
        { c: 'BBCOne.de', s: NOW.getTime(), e: NOW.getTime() + 3_600_000, t: 'Forkert land' },
      ]);
    }),
    remove: vi.fn(() => {
      calls.push('remove');
      return true;
    }),
  };
}

let db: SqlDatabase;
let sourceId: string;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  sourceId = (await addSource(db, { kind: 'xtream', name: 'Hakuna', url: 'http://panel.example:8080', username: 'USER' })).id;
  await replaceCategories(db, sourceId, [{ id: 'c1', name: 'Blandet' }]);
  await replaceChannels(db, sourceId, [
    // Britisk uden EPG-id: panelet giver den ingen EPG per kanal.
    ch('1', 'UK| BBC ONE HD'),
    // Dansk med EPG-id: klares af get_short_epg og skal ikke med her.
    ch('2', 'DNK| DR1 HD', 'DR1.dk'),
  ]);
  await setFavorite(db, `${sourceId}:1`, true);
  await setFavorite(db, `${sourceId}:2`, true);
});

async function programmesFor(key: string): Promise<{ title: string; description: string | null }[]> {
  return db.getAllAsync('SELECT title, description FROM programmes WHERE channel_id = ? ORDER BY start_ms', [key]);
}

describe('syncPanelEpg', () => {
  it('giver en britisk favorit programmer fra panelets fil — fra det rigtige land', async () => {
    const native = fakeNative();
    const result = await syncPanelEpg(db, sourceId, creds, { now: NOW, native });

    // BBC One paa navn+land; DR1 (favorit med EPG-id, men uden programmer
    // endnu) paa id'et — den tyske BBC One ikke.
    expect(result).toEqual({ matched: 2, programmes: 1 });
    expect(await programmesFor(`${sourceId}:1`)).toEqual([{ title: 'BBC News', description: 'Nyheder' }]);
    expect(native.asked[0]?.sort()).toEqual(['BBCOne.uk', 'DR1.dk']);
    // Filen ryddes altid op.
    expect(native.calls.at(-1)).toBe('remove');
  });

  it('tager sportskanaler uden programmer med, ogsaa naar de ikke er favoritter (v342)', async () => {
    await replaceCategories(db, sourceId, [{ id: 'c1', name: 'Blandet' }, { id: 'c2', name: 'UK| SPORTS' }]);
    await replaceChannels(db, sourceId, [
      ch('1', 'UK| BBC ONE HD'),
      ch('2', 'DNK| DR1 HD', 'DR1.dk'),
      { ...ch('3', 'UK| SKY SPORTS F1 HD'), categoryId: 'c2' },
    ]);
    await setFavorite(db, `${sourceId}:1`, true);
    const native = fakeNative();
    native.channels = vi.fn(async () =>
      JSON.stringify([
        { id: 'BBCOne.uk', n: ['BBC One'] },
        { id: 'SkySportsF1.uk', n: ['Sky Sports F1'] },
      ]),
    );
    native.programmes = vi.fn(async (_path: string, idsJson: string) => {
      native.asked.push(JSON.parse(idsJson) as string[]);
      return JSON.stringify([
        { c: 'BBCOne.uk', s: NOW.getTime(), e: NOW.getTime() + 3_600_000, t: 'BBC News' },
        { c: 'SkySportsF1.uk', s: NOW.getTime(), e: NOW.getTime() + 7_200_000, t: 'Formula 1: Singapore GP' },
      ]);
    });
    const result = await syncPanelEpg(db, sourceId, creds, { now: NOW, native });
    expect(result).toEqual({ matched: 2, programmes: 2 });
    expect(native.asked[0]?.sort()).toEqual(['BBCOne.uk', 'SkySportsF1.uk']);
    expect(await programmesFor(`${sourceId}:3`)).toEqual([{ title: 'Formula 1: Singapore GP', description: null }]);
  });

  it('daekker alle sportskanaler, ikke kun 150, og laeser programmerne i klumper (v352)', async () => {
    await replaceCategories(db, sourceId, [{ id: 'c1', name: 'Blandet' }, { id: 'c2', name: 'UK| SPORTS' }]);
    const count = 320;
    const channels = [ch('1', 'UK| BBC ONE HD')];
    for (let i = 0; i < count; i += 1) channels.push({ ...ch(String(100 + i), `UK| SPORT CHANNEL ${i} HD`), categoryId: 'c2' });
    await replaceChannels(db, sourceId, channels);
    await setFavorite(db, `${sourceId}:1`, true);
    const native = fakeNative();
    native.channels = vi.fn(async () =>
      JSON.stringify(Array.from({ length: count }, (_, i) => ({ id: `SportChannel${i}.uk`, n: [`Sport Channel ${i}`] }))),
    );
    native.programmes = vi.fn(async (_path: string, idsJson: string) => {
      const ids = JSON.parse(idsJson) as string[];
      native.asked.push(ids);
      return JSON.stringify(ids.map((id) => ({ c: id, s: NOW.getTime(), e: NOW.getTime() + 3_600_000, t: `Kamp paa ${id}` })));
    });
    const result = await syncPanelEpg(db, sourceId, creds, { now: NOW, native });
    expect(result).toEqual({ matched: count, programmes: count });
    // 320 feed-id'er i klumper af 300: to gennemloeb, ingen over 300.
    expect(native.asked.map((ids) => ids.length)).toEqual([300, 20]);
    // En kanal langt bag de 150 foerste faar ogsaa sine programmer.
    expect(await programmesFor(`${sourceId}:${100 + 310}`)).toEqual([{ title: 'Kamp paa SportChannel310.uk', description: null }]);
  });

  it('en favorit med EPG-id faar intet, naar filen intet har for den', async () => {
    await syncPanelEpg(db, sourceId, creds, { now: NOW, native: fakeNative() });
    expect(await programmesFor(`${sourceId}:2`)).toEqual([]);
  });

  it('tager ogsaa favoritter MED EPG-id, naar panelet intet gav for dem', async () => {
    // Panelet er spurgt om DR1 (epg_fetch), men der kom ingen programmer.
    await db.runAsync('INSERT INTO epg_fetch (stream_id, fetched_at) VALUES (?, ?)', [`${sourceId}:2`, NOW.getTime()]);
    const native = fakeNative();
    native.programmes = vi.fn(async (_path: string, idsJson: string) => {
      native.asked.push(JSON.parse(idsJson) as string[]);
      return JSON.stringify([{ c: 'DR1.dk', s: NOW.getTime(), e: NOW.getTime() + 3_600_000, t: 'TV Avisen' }]);
    });
    await syncPanelEpg(db, sourceId, creds, { now: NOW, native });

    // Matchet direkte paa id'et, ikke paa navnet.
    expect(native.asked[0]).toContain('DR1.dk');
    expect(await programmesFor(`${sourceId}:2`)).toEqual([{ title: 'TV Avisen', description: null }]);
  });

  it('lader favoritter med EPG-id vaere, naar de allerede har programmer', async () => {
    await db.runAsync('INSERT INTO epg_fetch (stream_id, fetched_at) VALUES (?, ?)', [`${sourceId}:2`, NOW.getTime()]);
    await db.runAsync('INSERT INTO programmes VALUES (?, ?, ?, ?, NULL)', [
      `${sourceId}:2`,
      NOW.getTime(),
      NOW.getTime() + 3_600_000,
      'Fra panelet',
    ]);
    const native = fakeNative();
    await syncPanelEpg(db, sourceId, creds, { now: NOW, native });
    expect(native.asked).toEqual([['BBCOne.uk']]);
  });

  it('henter hoejst én gang i doegnet, og Hent hoejst én gang i timen', async () => {
    await syncPanelEpg(db, sourceId, creds, { now: NOW, native: fakeNative() });

    const soon = new Date(NOW.getTime() + 30 * 60_000);
    expect(await syncPanelEpg(db, sourceId, creds, { now: soon, native: fakeNative() })).toBeNull();
    expect(await syncPanelEpg(db, sourceId, creds, { now: soon, force: true, native: fakeNative() })).toBeNull();

    const later = new Date(NOW.getTime() + 2 * 60 * 60_000);
    expect(await syncPanelEpg(db, sourceId, creds, { now: later, native: fakeNative() })).toBeNull();
    expect(await syncPanelEpg(db, sourceId, creds, { now: later, force: true, native: fakeNative() })).not.toBeNull();
  });

  it('goer intet naar det er slaaet fra, eller modulet mangler', async () => {
    expect(await syncPanelEpg(db, sourceId, creds, { now: NOW, native: null })).toBeNull();
    await setPanelEpgEnabled(db, false);
    const native = fakeNative();
    expect(await syncPanelEpg(db, sourceId, creds, { now: NOW, native })).toBeNull();
    expect(native.calls).toEqual([]);
  });

  it('proever igen om en time efter en fejl, ikke om et doegn', async () => {
    const failing = fakeNative();
    failing.download = vi.fn(async () => {
      throw new Error('Panelet svarede HTTP 503');
    });
    await expect(syncPanelEpg(db, sourceId, creds, { now: NOW, native: failing })).rejects.toThrow('503');

    const inTwoHours = new Date(NOW.getTime() + 2 * 60 * 60_000);
    expect(await syncPanelEpg(db, sourceId, creds, { now: inTwoHours, native: fakeNative() })).not.toBeNull();
  });
});
