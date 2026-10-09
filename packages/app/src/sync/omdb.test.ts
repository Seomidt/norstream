import { describe, expect, it, vi } from 'vitest';
import { omdbMetadata } from './omdb.js';
import type { TmdbFetch } from './tmdb.js';
const fetcher = (patch: Record<string, unknown> = {}): TmdbFetch => vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ Response: 'True', imdbID: 'tt1234567', Type: 'movie', Genre: 'Comedy, Romance', Year: '2024', ...patch }), text: async () => '' }));
describe('OMDb reserve', () => {
  it('henter genre og aar ved et bekraeftet IMDb-id', async () => {
    expect(await omdbMetadata(fetcher(), 'key', 'tt1234567', 'movie', 2024)).toEqual({ genres: ['komedie', 'romantik'], year: 2024 });
  });
  it('afviser andre id, aar, typer og ikke-fundne resultater', async () => {
    for (const patch of [{ imdbID: 'tt9999999' }, { Year: '2023' }, { Type: 'series' }, { Response: 'False' }]) {
      expect(await omdbMetadata(fetcher(patch), 'key', 'tt1234567', 'movie', 2024)).toBeNull();
    }
    const f = fetcher();
    expect(await omdbMetadata(f, 'key', 'invalid', 'movie', 2024)).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
});
