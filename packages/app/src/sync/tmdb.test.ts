import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@norstream/core';
import { cleanVodTitle, findTmdbPoster } from './tmdb.js';

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
    const fetchImpl = fakeFetch([[/search\/movie.*year=2021/, { results: [{ poster_path: '/abc.jpg' }] }]]);
    const url = await findTmdbPoster(fetchImpl, 'KEY', 'movie', 'DK - Spider-Man (2021)');
    expect(url).toBe('https://image.tmdb.org/t/p/w342/abc.jpg');
    expect(fetchImpl.calls[0]).toContain('query=Spider-Man');
    expect(fetchImpl.calls[0]).toContain('api_key=KEY');
    expect(fetchImpl.calls[0]).toContain('language=da-DK');
  });

  it('soeger paa serier under tv', async () => {
    const fetchImpl = fakeFetch([[/search\/tv/, { results: [{ poster_path: '/crown.jpg' }] }]]);
    expect(await findTmdbPoster(fetchImpl, 'KEY', 'series', 'The Crown S01')).toBe(
      'https://image.tmdb.org/t/p/w342/crown.jpg',
    );
  });

  it('proever uden aarstal naar aarstallet ikke rammer', async () => {
    const fetchImpl = fakeFetch([
      [/year=1999/, { results: [] }],
      [/search\/movie/, { results: [{ poster_path: null }, { poster_path: '/x.jpg' }] }],
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
