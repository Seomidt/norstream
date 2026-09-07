import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@norstream/core';
import { cleanVodTitle, findTmdbPoster, findTmdbTrailer, pickTmdbTrailer, searchTmdb } from './tmdb.js';

describe('cleanVodTitle', () => {
  it('tager praefiks, aarstal, klammer og kvalitetsord ud', () => {
    expect(cleanVodTitle('DK - Spider-Man: No Way Home (2021) [4K]')).toEqual({
      title: 'Spider-Man: No Way Home',
      year: 2021,
    });
    expect(cleanVodTitle('NF| The Crown S01 - MULTI')).toEqual({ title: 'The Crown', year: null });
    expect(cleanVodTitle('Dune: Part Two 2024 HEVC')).toEqual({ title: 'Dune: Part Two', year: 2024 });
    expect(cleanVodTitle('  Klovn  ')).toEqual({ title: 'Klovn', year: null });
  });

  it('lader en titel med tal i fred', () => {
    expect(cleanVodTitle('1917 (2019)')).toEqual({ title: '1917', year: 2019 });
    expect(cleanVodTitle('Ocean’s 11')).toEqual({ title: 'Ocean’s 11', year: null });
  });
});

function fakeFetch(answers: Array<[RegExp, unknown]>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const hit = answers.find(([pattern]) => pattern.test(url));
    const body = hit === undefined ? { results: [] } : hit[1];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as FetchLike & { calls: string[] };
  impl.calls = calls;
  return impl;
}

describe('findTmdbPoster', () => {
  it('soeger paa film med aarstal og bygger plakatens adresse', async () => {
    const fetchImpl = fakeFetch([[/search\/movie.*year=2021/, { results: [{ id: 1, poster_path: '/abc.jpg' }] }]]);
    const url = await findTmdbPoster(fetchImpl, 'KEY', 'movie', 'DK - Spider-Man (2021)');
    expect(url).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
    expect(fetchImpl.calls[0]).toContain('query=Spider-Man');
    expect(fetchImpl.calls[0]).toContain('api_key=KEY');
    expect(fetchImpl.calls[0]).toContain('language=da-DK');
  });

  it('soeger paa serier under tv', async () => {
    const fetchImpl = fakeFetch([[/search\/tv/, { results: [{ id: 2, poster_path: '/crown.jpg' }] }]]);
    expect(await findTmdbPoster(fetchImpl, 'KEY', 'series', 'The Crown S01')).toBe(
      'https://image.tmdb.org/t/p/w342/crown.jpg',
    );
  });

  it('proever uden aarstal naar aarstallet ikke rammer', async () => {
    const fetchImpl = fakeFetch([
      [/year=1999/, { results: [] }],
      [/search\/movie/, { results: [{ id: 3, poster_path: null }, { id: 4, poster_path: '/x.jpg' }] }],
    ]);
    expect(await findTmdbPoster(fetchImpl, 'KEY', 'movie', 'Matrix (1999)')).toBe(
      'https://image.tmdb.org/t/p/w342/x.jpg',
    );
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('giver null naar intet findes, og naar netvaerket kaster', async () => {
    expect(await findTmdbPoster(fakeFetch([]), 'KEY', 'movie', 'Ukendt film')).toBeNull();
    const broken = (async () => {
      throw new Error('Network request failed');
    }) as unknown as FetchLike;
    expect(await findTmdbPoster(broken, 'KEY', 'movie', 'Dune')).toBeNull();
    expect(await findTmdbPoster(fakeFetch([]), 'KEY', 'movie', '(2021)')).toBeNull();
  });
});

describe('pickTmdbTrailer', () => {
  it('vaelger en officiel trailer paa YouTube, nyeste foerst, og aldrig en teaser', () => {
    const picked = pickTmdbTrailer([
      { key: 't1', site: 'YouTube', type: 'Teaser', official: true, published_at: '2024-05-01' },
      { key: 'old', site: 'YouTube', type: 'Trailer', official: true, published_at: '2024-01-01', name: 'Trailer 1' },
      { key: 'new', site: 'YouTube', type: 'Trailer', official: true, published_at: '2024-03-01', name: 'Trailer 2' },
      { key: 'fan', site: 'YouTube', type: 'Trailer', official: false, published_at: '2024-06-01' },
      { key: 'v', site: 'Vimeo', type: 'Trailer', official: true, published_at: '2024-07-01' },
    ]);
    expect(picked).toEqual({ youtubeId: 'new', name: 'Trailer 2' });
  });

  it('giver null naar der kun er teasere og klip', () => {
    expect(pickTmdbTrailer([{ key: 'x', site: 'YouTube', type: 'Teaser' }, { key: 'y', site: 'YouTube', type: 'Clip' }])).toBeNull();
    expect(pickTmdbTrailer([])).toBeNull();
  });
});

describe('findTmdbTrailer', () => {
  it('finder titlen, henter dens videoer og vaelger traileren', async () => {
    const fetchImpl = fakeFetch([
      [/search\/movie/, { results: [{ id: 42, poster_path: '/p.jpg' }] }],
      [/movie\/42\/videos/, { results: [{ key: 'abc', site: 'YouTube', type: 'Trailer', official: true, name: 'Official Trailer' }] }],
    ]);
    expect(await findTmdbTrailer(fetchImpl, 'KEY', 'movie', 'Dune (2021)')).toEqual({
      youtubeId: 'abc',
      name: 'Official Trailer',
    });
    expect(fetchImpl.calls[1]).toContain('/movie/42/videos');
  });

  it('bruger tv-endepunktet for serier', async () => {
    const fetchImpl = fakeFetch([
      [/search\/tv/, { results: [{ id: 7 }] }],
      [/tv\/7\/videos/, { results: [{ key: 'crown', site: 'YouTube', type: 'Trailer' }] }],
    ]);
    expect((await findTmdbTrailer(fetchImpl, 'KEY', 'series', 'The Crown'))?.youtubeId).toBe('crown');
  });

  it('giver null naar titlen ikke findes', async () => {
    expect(await findTmdbTrailer(fakeFetch([]), 'KEY', 'movie', 'Ukendt')).toBeNull();
  });
});

describe('searchTmdb', () => {
  it('tager karakteren med, afrundet, og kun naar nogen har stemt', async () => {
    const fetchImpl = fakeFetch([[/search\/movie/, { results: [{ id: 9, poster_path: '/d.jpg', vote_average: 7.86, vote_count: 120 }] }]]);
    expect(await searchTmdb(fetchImpl, 'KEY', 'movie', 'Dune')).toEqual({
      id: 9,
      posterUrl: 'https://image.tmdb.org/t/p/w342/d.jpg',
      rating: 7.9,
    });
    const unrated = fakeFetch([[/search\/movie/, { results: [{ id: 9, poster_path: '/d.jpg', vote_average: 0, vote_count: 0 }] }]]);
    expect((await searchTmdb(unrated, 'KEY', 'movie', 'Dune'))?.rating).toBeNull();
  });
});
