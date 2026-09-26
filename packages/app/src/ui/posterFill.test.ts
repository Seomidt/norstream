import { beforeEach, describe, expect, it } from 'vitest';
import type { SqlDatabase } from '../storage/types.js';
import type { TmdbFetch } from '../sync/tmdb.js';
import {
  ERROR_PAUSE_MS,
  ensurePoster,
  forgetPosterMisses,
  foundPoster,
  initPosterFill,
  resetPosterFillForTests,
  setPosterApiKey,
  whenPosterQueueIdle,
} from './posterFill.js';

/** Kun tabellen vod_posters, i hukommelsen. */
function fakeDb() {
  const rows = new Map<string, { url: string | null; tried_ms: number }>();
  const db = {
    rows,
    async getFirstAsync(_sql: string, params: unknown[]) {
      return rows.get(params[0] as string) ?? null;
    },
    async runAsync(sql: string, params: unknown[] = []) {
      if (sql.startsWith('DELETE')) {
        for (const [key, row] of rows) if (row.url === null) rows.delete(key);
        return;
      }
      rows.set(params[0] as string, { url: params[1] as string | null, tried_ms: params[3] as number });
    },
  };
  return db as unknown as SqlDatabase & { rows: typeof rows };
}

const okFetch: TmdbFetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => (url.includes('Dune') ? { results: [{ id: 1, poster_path: '/dune.jpg' }] } : { results: [] }),
  text: async () => '',
});

const failingFetch: TmdbFetch = async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => '' });

const dune = { key: 'm1', kind: 'movie' as const, name: 'Dune' };
const unknown = { key: 'm2', kind: 'movie' as const, name: 'Ukendt' };

describe('posterFill', () => {
  beforeEach(() => {
    resetPosterFillForTests();
  });

  it('husker et fund og et nej', async () => {
    const db = fakeDb();
    await initPosterFill(db, okFetch);
    setPosterApiKey('KEY');
    ensurePoster(dune);
    ensurePoster(unknown);
    await whenPosterQueueIdle();
    expect(foundPoster('m1')).toBe('https://image.tmdb.org/t/p/w342/dune.jpg');
    expect(foundPoster('m2')).toBeNull();
    expect(db.rows.get('m2')?.url).toBeNull();
  });

  it('gemmer ikke et nej naar TMDB svarer med en fejl, og holder en pause', async () => {
    const db = fakeDb();
    await initPosterFill(db, failingFetch);
    setPosterApiKey('FORKERT');
    ensurePoster(dune);
    await whenPosterQueueIdle();
    expect(db.rows.has('m1')).toBe(false);
    // Ingen nye opslag lige efter fejlen: ellers gav en forkert noegle ét kald per plakat paa skaermen.
    ensurePoster(unknown);
    await whenPosterQueueIdle();
    expect(db.rows.has('m2')).toBe(false);
    expect(ERROR_PAUSE_MS).toBeGreaterThan(0);
  });

  it('glemmer de gamle nej naar noeglen skiftes', async () => {
    const db = fakeDb();
    await initPosterFill(db, okFetch);
    setPosterApiKey('KEY');
    ensurePoster(unknown);
    await whenPosterQueueIdle();
    expect(db.rows.get('m2')?.url).toBeNull();
    setPosterApiKey('NY');
    await Promise.resolve();
    expect(db.rows.has('m2')).toBe(false);
    await forgetPosterMisses();
  });
});
