import { beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from '@norstream/core';
import { getLogoOverride, markLogoSearched, recentlySearchedLogos } from '../../storage/logoOverrides.js';
import { migrate } from '../../storage/schema.js';
import { createTestDatabase } from '../../storage/testDb.js';
import type { SqlDatabase } from '../../storage/types.js';
import { autoSearchLogos } from './logoAutoSearch.js';
import type { AutoSearchProgress } from './logoAutoSearch.js';

let db: SqlDatabase;

beforeEach(async () => {
  db = createTestDatabase();
  await migrate(db);
});

/** Wikidata der kender én kanal: den der hedder Fri. */
const fetchImpl: FetchLike = async (url) => {
  let body: unknown = {};
  if (url.includes('wbsearchentities')) {
    body = url.includes('search=Fri')
      ? { search: [{ id: 'Q1', label: 'Fri', description: 'tv channel' }] }
      : { search: [] };
  } else if (url.includes('wbgetentities')) {
    body = { entities: { Q1: { claims: { P154: [{ mainsnak: { datavalue: { value: 'Fri.svg' } } }] } } } };
  }
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
};

const channels = [
  { id: 's:1', name: 'DNK| Fri HD', country: 'DK', isFavorite: false, hasOverride: false },
  { id: 's:2', name: 'DNK| Ukendt', country: 'DK', isFavorite: false, hasOverride: false },
  { id: 's:3', name: 'DNK| Eget', country: 'DK', isFavorite: false, hasOverride: true },
];

describe('autoSearchLogos', () => {
  it('gemmer det fundne som eget valg, husker det forgaeves, og lader eget valg vaere', async () => {
    const replaced: string[] = [];
    const progress: AutoSearchProgress[] = [];
    const handle = autoSearchLogos(
      {
        db,
        fetchImpl,
        google: null,
        replaceLogo: async (key, url) => {
          replaced.push(`${key} ${url}`);
          return true;
        },
        resetLogo: async () => undefined,
        now: () => 1_000,
      },
      channels,
      (p) => progress.push(p),
    );
    expect(await handle.result).toEqual({ found: 1, tried: 2, skipped: 0, withBids: 1 });
    expect(await getLogoOverride(db, 's:1')).toContain('Fri.svg');
    expect(await getLogoOverride(db, 's:2')).toBeNull();
    expect(await getLogoOverride(db, 's:3')).toBeNull();
    expect(replaced).toHaveLength(1);
    expect(await recentlySearchedLogos(db, ['s:1', 's:2'], 1_001)).toEqual(new Set(['s:2']));
    expect(progress.at(-1)).toMatchObject({ done: 2, total: 2, found: 1 });
  });

  it('tager valget tilbage naar adressen ikke gav et billede', async () => {
    const reset: string[] = [];
    const handle = autoSearchLogos(
      {
        db,
        fetchImpl,
        google: null,
        replaceLogo: async () => false,
        resetLogo: async (key) => {
          reset.push(key);
        },
      },
      channels.slice(0, 1),
      () => undefined,
    );
    expect((await handle.result).found).toBe(0);
    expect(await getLogoOverride(db, 's:1')).toBeNull();
    expect(reset).toEqual(['s:1']);
  });

  it('springer dem over der blev soegt for nylig', async () => {
    await markLogoSearched(db, 's:1', 500);
    const handle = autoSearchLogos(
      { db, fetchImpl, google: null, replaceLogo: async () => true, resetLogo: async () => undefined, now: () => 1_000 },
      channels,
      () => undefined,
    );
    expect(await handle.result).toEqual({ found: 0, tried: 1, skipped: 1, withBids: 0 });
  });

  it('kan standses undervejs', async () => {
    const handle = autoSearchLogos(
      { db, fetchImpl, google: null, replaceLogo: async () => true, resetLogo: async () => undefined },
      channels,
      () => handle.cancel(),
    );
    const result = await handle.result;
    expect(result.tried).toBeLessThan(2);
  });
});
