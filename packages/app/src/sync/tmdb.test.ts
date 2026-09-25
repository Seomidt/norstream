import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@norstream/core';
import { TmdbRequestError, cleanVodTitle, findTmdbPoster, findTmdbTrailer, pickTmdbTrailer, searchTmdb, tmdbAuth } from './tmdb.js';

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

function fakeFetch(answers: Array<[RegExp, unknown]>): FetchLike & { calls: string[]; headers: Array<Record<string, string> | undefined> } {
  const calls: string[] = [];
  const headersSeen: Array<Record<string, string> | undefined> = [];
  const impl = (async (url: string, headers?: Record<string, string>) => {
    calls.push(url);
    headersSeen.push(headers);
    const hit = answers.find(([pattern]) => pattern.test(url));
    const body = hit === undefined ? { results: [] } : hit[1];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as FetchLike & { calls: string[]; headers: Array<Record<string, string> | undefined> };
  impl.calls = calls;
  impl.headers = headersSeen;
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

  it('tager teaseren foer klippet naar der ingen trailer er, og null uden videoer', () => {
    // Foer gav den null her, og saa endte man paa YouTubes soegeside. En
    // teaser er bedre end ingenting.
    expect(pickTmdbTrailer([{ key: 'x', site: 'YouTube', type: 'Teaser' }, { key: 'y', site: 'YouTube', type: 'Clip' }])?.youtubeId).toBe('x');
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

describe('searchTmdb naar TMDB svarer med en fejl', () => {
  const failing = (status: number) =>
    (async () => ({ ok: false, status, json: async () => ({}), text: async () => '' })) as FetchLike;

  it('kaster en fejl i stedet for at sige at titlen ikke findes', async () => {
    await expect(searchTmdb(failing(401), 'FORKERT', 'movie', 'Dune')).rejects.toBeInstanceOf(TmdbRequestError);
    await expect(searchTmdb(failing(429), 'KEY', 'movie', 'Dune')).rejects.toMatchObject({ status: 429 });
    const down = (async () => {
      throw new Error('netvaerk');
    }) as FetchLike;
    await expect(searchTmdb(down, 'KEY', 'movie', 'Dune')).rejects.toMatchObject({ status: null });
  });

  it('plakat- og traileropslag giver bare null, saa skaermene tegner uden', async () => {
    expect(await findTmdbPoster(failing(401), 'FORKERT', 'movie', 'Dune')).toBeNull();
    expect(await findTmdbTrailer(failing(500), 'KEY', 'movie', 'Dune')).toBeNull();
  });
});

describe('tmdbAuth', () => {
  it('sender en v3-noegle i adressen og et laesetoken som hoved', async () => {
    expect(tmdbAuth('abc123')).toEqual({ query: '&api_key=abc123' });
    expect(tmdbAuth(' eyJhbGciOi.xxx ')).toEqual({
      query: '',
      headers: { Authorization: 'Bearer eyJhbGciOi.xxx' },
    });

    const fetchImpl = fakeFetch([[/search\/movie/, { results: [{ id: 1, poster_path: '/a.jpg' }] }]]);
    await searchTmdb(fetchImpl, 'eyJtoken', 'movie', 'Dune');
    expect(fetchImpl.calls[0]).not.toContain('api_key');
    expect(fetchImpl.headers[0]).toEqual({ Authorization: 'Bearer eyJtoken' });
  });
});

describe('pickTmdbTrailer og kvalitet', () => {
  it('vaelger traileren i hoejest oploesning, ogsaa foran en officiel i lav kvalitet', () => {
    const picked = pickTmdbTrailer([
      { key: 'lav', site: 'YouTube', type: 'Trailer', official: true, size: 480, published_at: '2024-05-01' },
      { key: 'hd', site: 'YouTube', type: 'Trailer', official: false, size: 1080, published_at: '2024-01-01' },
    ]);
    expect(picked?.youtubeId).toBe('hd');
  });

  it('regner 4K og 1080p lige gode, saa afgoer officiel/nyest', () => {
    const picked = pickTmdbTrailer([
      { key: '4k', site: 'YouTube', type: 'Trailer', official: false, size: 2160 },
      { key: 'fhd', site: 'YouTube', type: 'Trailer', official: true, size: 1080 },
    ]);
    expect(picked?.youtubeId).toBe('fhd');
  });

  it('en rigtig trailer i lav kvalitet slaar stadig en teaser i HD', () => {
    const picked = pickTmdbTrailer([
      { key: 'teaser', site: 'YouTube', type: 'Teaser', size: 1080 },
      { key: 'trailer', site: 'YouTube', type: 'Trailer', size: 720 },
    ]);
    expect(picked?.youtubeId).toBe('trailer');
  });
});

describe('pickTmdbTrailer uden en rigtig trailer', () => {
  it('tager en teaser naar der ingen trailer er, og et klip som sidste udvej', () => {
    expect(pickTmdbTrailer([{ site: 'YouTube', type: 'Clip', key: 'c' }, { site: 'YouTube', type: 'Teaser', key: 't', name: 'Teaser' }])).toEqual({ youtubeId: 't', name: 'Teaser' });
    expect(pickTmdbTrailer([{ site: 'YouTube', type: 'Clip', key: 'c' }])?.youtubeId).toBe('c');
    expect(pickTmdbTrailer([{ site: 'Vimeo', type: 'Trailer', key: 'v' }])).toBeNull();
  });
});
