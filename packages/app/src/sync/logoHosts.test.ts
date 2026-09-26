import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLike, FetchLikeResponse } from '@norstream/core';
import { migrate } from '../storage/schema.js';
import { createTestDatabase } from '../storage/testDb.js';
import { deadLogoOrigins, listLogoHosts, recordLogoHostState } from '../storage/logoHosts.js';
import { addSource } from '../storage/sources.js';
import { replaceCategories, replaceChannels, listChannels } from '../storage/channels.js';
import type { SqlDatabase } from '../storage/types.js';
import { checkLogoHosts } from './logoHosts.js';

let db: SqlDatabase;
let sourceId: string;

const NOW = new Date('2026-09-06T18:00:00Z');

function response(status: number): FetchLikeResponse {
  return { ok: status < 400, status, text: async () => '', json: async () => ({}) } as FetchLikeResponse;
}

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
  sourceId = (
    await addSource(db, { kind: 'xtream', name: 'Panel', url: 'http://panel.example:8080' })
  ).id;
  await replaceCategories(db, sourceId, [{ id: '1', name: 'DANMARK' }]);
  await replaceChannels(db, sourceId, [
    {
      id: '101',
      name: 'DNK| DR1 HD',
      number: 1,
      // Panelet oplyser sine logoer paa en helt anden vaert end sin egen.
      logoUrl: 'http://103.176.90.95/images/978715.png',
      categoryId: '1',
      epgChannelId: null,
      hasArchive: true,
      archiveDays: 7,
    },
  ]);
});

describe('checkLogoHosts', () => {
  it('maerker en vaert der ikke svarer som uden for raekkevidde', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('103.176.90.95')) throw new Error('Host unreachable');
      return response(404);
    }) as unknown as FetchLike;

    const result = await checkLogoHosts(db, fetchImpl, NOW);
    expect(result.checked).toBe(true);
    expect(await deadLogoOrigins(db)).toEqual(new Set(['http://103.176.90.95']));
  });

  it('regner en 404 som en vaert der lever', async () => {
    const fetchImpl = vi.fn(async () => response(404)) as unknown as FetchLike;
    await checkLogoHosts(db, fetchImpl, NOW);
    // En 404 gaelder den ene fil. Vaerten svarede, og dens oevrige adresser
    // kan sagtens findes — de faar lov at blive proevet.
    expect(await deadLogoOrigins(db)).toEqual(new Set());
    expect((await listLogoHosts(db)).every((host) => host.state === 'ok')).toBe(true);
  });

  it('maaler hver vaert én gang, ikke hver kanal', async () => {
    const fetchImpl = vi.fn(async () => response(200)) as unknown as FetchLike;
    await checkLogoHosts(db, fetchImpl, NOW);
    // Én kandidat maales: billed-vaerten. Panelets egen springes over, og
    // ingen af dem maales per kanal.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('springer over saa laenge den forrige maaling er frisk', async () => {
    const fetchImpl = vi.fn(async () => response(200)) as unknown as FetchLike;
    await checkLogoHosts(db, fetchImpl, NOW);
    const again = await checkLogoHosts(db, fetchImpl, new Date(NOW.getTime() + 3600_000));
    expect(again.checked).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('maaler igen naar der er gaaet seks timer', async () => {
    const fetchImpl = vi.fn(async () => response(200)) as unknown as FetchLike;
    await checkLogoHosts(db, fetchImpl, NOW);
    const again = await checkLogoHosts(db, fetchImpl, new Date(NOW.getTime() + 7 * 3600_000));
    expect(again.checked).toBe(true);
  });
});

// Den her fejl slog baade kanaler og programoversigt ud paa brugerens
// telefon. Maalingen laa til sidst i hver synkronisering og sendte ogsaa et
// kald til panelets egen vaert — og panelet tillader én forbindelse ad gangen,
// saa maalingen tog den fra de kald der faktisk skulle bruge den. Bagefter
// noterede den panelet som uden for raekkevidde, fordi den selv havde tabt
// kapløbet.
describe('kildens egen vaert', () => {
  it('bliver ikke maalt', async () => {
    const fetchImpl = vi.fn(async () => response(200)) as unknown as FetchLike;
    const result = await checkLogoHosts(db, fetchImpl, NOW);

    const calls = (fetchImpl as unknown as { mock: { calls: string[][] } }).mock.calls;
    expect(calls.some((call) => call[0]?.includes('panel.example'))).toBe(false);
    expect(result.hosts.find((host) => host.origin.includes('panel.example'))?.state).toBe('ok');
  });

  it('kan ikke doemmes ude, heller ikke af en doem der allerede er gemt', async () => {
    // Som den ser ud paa en telefon der har koert den fejlbehaeftede udgave.
    await recordLogoHostState(db, {
      origin: 'http://panel.example:8080',
      state: 'unreachable',
      detail: 'kunne ikke nås',
    });
    expect(await deadLogoOrigins(db)).toEqual(new Set());

    // Og adressen paa panelets egen vaert staar stadig i kanalens raekke.
    const channel = (await listChannels(db))[0];
    expect(channel?.logoUrls).toContain('http://panel.example:8080/images/978715.png');
  });
});

describe('kanallisten', () => {
  it('springer den doede vaert over saa det naeste logo bliver proevet', async () => {
    const before = (await listChannels(db))[0];
    expect(before?.logoUrls[0]).toBe('http://103.176.90.95/images/978715.png');

    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('103.176.90.95')) throw new Error('Host unreachable');
      return response(200);
    }) as unknown as FetchLike;
    await checkLogoHosts(db, fetchImpl, NOW);

    // Hele pointen: uden det her staar den doede adresse foerst, og `Image`
    // venter paa et svar der aldrig kommer i stedet for at proeve den naeste.
    const after = (await listChannels(db))[0];
    expect(after?.logoUrls).toEqual(['http://panel.example:8080/images/978715.png']);
  });

  it('lader alle adresser staa naar vaerterne svarer', async () => {
    const fetchImpl = vi.fn(async () => response(200)) as unknown as FetchLike;
    await checkLogoHosts(db, fetchImpl, NOW);
    expect((await listChannels(db))[0]?.logoUrls).toHaveLength(2);
  });
});
