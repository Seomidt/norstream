import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SqlDatabase } from '../storage/types.js';
import type { TmdbFetch } from '../sync/tmdb.js';
import {
  ERROR_PAUSE_MS,
  subscribePoster,
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
  const rows = new Map<string, { url: string | null; tried_ms: number; metadata_version?: number }>();
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
      rows.set(params[0] as string, { url: params[1] as string | null, tried_ms: params[3] as number, metadata_version: 1 });
    },
  };
  return db as unknown as SqlDatabase & { rows: typeof rows };
}

const okFetch: TmdbFetch = async (url) => ({
  ok: true,
  status: 200,
  json: async () => (url.includes('Dune') ? { results: [{ id: 1, title: 'Dune', poster_path: '/dune.jpg' }] } : { results: [] }),
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

it('bruger katalogets aarstal til cover-opslaget', async () => {
  resetPosterFillForTests();
  const fetcher = vi.fn<TmdbFetch>(async () => ({ ok: true, status: 200, json: async () => ({ results: [{ id: 1, title: 'Dune', release_date: '2021-10-01', poster_path: '/dune.jpg' }] }), text: async () => '' }));
  await initPosterFill(fakeDb(), fetcher); setPosterApiKey('KEY');
  ensurePoster({ ...dune, year: 2021 }); await whenPosterQueueIdle();
  expect(fetcher.mock.calls[0]?.[0]).toContain('year=2021');
  expect(foundPoster(dune.key)).toContain('dune.jpg');
});

it('proever igen naar det gemte cover fejler', async () => {
  resetPosterFillForTests(); const db = fakeDb();
  await initPosterFill(db, okFetch); setPosterApiKey('KEY');
  db.rows.set(dune.key, { url: 'https://broken.test/old.jpg', tried_ms: Date.now(), metadata_version: 1 });
  ensurePoster(dune, 'https://broken.test/old.jpg'); await whenPosterQueueIdle();
  expect(foundPoster(dune.key)).toBe('https://image.tmdb.org/t/p/w342/dune.jpg');
});

it('et kendt nej giver ikke et nyt databaseopslag ved hvert genbesoeg', async () => {
  resetPosterFillForTests(); const db = fakeDb();
  await initPosterFill(db, okFetch); setPosterApiKey('KEY');
  const read = vi.spyOn(db, 'getFirstAsync');
  ensurePoster(unknown); await whenPosterQueueIdle();
  const count = read.mock.calls.length;
  ensurePoster(unknown); await whenPosterQueueIdle();
  expect(read).toHaveBeenCalledTimes(count);
});

it('kort uden for skaermen fjernes fra koeen inden netkaldet', async () => {
  resetPosterFillForTests();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = vi.fn<TmdbFetch>(async (url) => { await gate; return okFetch(url); });
  await initPosterFill(fakeDb(), fetcher); setPosterApiKey('KEY');
  ensurePoster({ ...dune, key: 'first' }); ensurePoster({ ...dune, key: 'second' });
  const unsubscribe = subscribePoster('offscreen', () => {});
  ensurePoster({ ...dune, key: 'offscreen' }); unsubscribe();
  release(); await whenPosterQueueIdle();
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(foundPoster('offscreen')).toBeNull();
});

it('en TMDB-fejl stopper ogsaa den allerede ventende koe', async () => {
  resetPosterFillForTests(); const fetcher = vi.fn(failingFetch);
  await initPosterFill(fakeDb(), fetcher); setPosterApiKey('KEY');
  for (let i = 0; i < 20; i++) ensurePoster({ ...dune, key: `queued-${i}` });
  await whenPosterQueueIdle();
  expect(fetcher.mock.calls.length).toBeLessThanOrEqual(2);
});
