import { describe, expect, it } from 'vitest';
import type { TmdbFetch } from './tmdb.js';
import {
  discoverTitles,
  interleave,
  justWatchLink,
  listTmdbProviders,
  listTmdbProvidersWithUk,
  providerShelf,
  serviceSearchUrl,
  toTmdbTitle,
  trendingTitles,
} from './tmdbHome.js';

function fakeFetch(answers: Array<[RegExp, unknown]>): TmdbFetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const hit = answers.find(([pattern]) => pattern.test(url));
    const body = hit === undefined ? { results: [] } : hit[1];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as TmdbFetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}

describe('listTmdbProviders', () => {
  it('slaar film og serier sammen, vigtigste foerst i landet', async () => {
    const fetchImpl = fakeFetch([
      [
        /watch\/providers\/movie/,
        {
          results: [
            { provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg', display_priorities: { DK: 1 } },
            { provider_id: 76, provider_name: 'Viaplay', logo_path: '/v.jpg', display_priorities: { DK: 3 } },
          ],
        },
      ],
      [
        /watch\/providers\/tv/,
        {
          results: [
            { provider_id: 76, provider_name: 'Viaplay', logo_path: '/v.jpg', display_priorities: { DK: 2 } },
            { provider_id: 383, provider_name: 'TV 2 Play', logo_path: null, display_priority: 4 },
          ],
        },
      ],
    ]);
    const providers = await listTmdbProviders(fetchImpl, 'KEY');
    expect(providers.map((p) => p.name)).toEqual(['Netflix', 'Viaplay', 'TV 2 Play']);
    expect(providers[0]?.logoUrl).toBe('https://image.tmdb.org/t/p/w92/n.jpg');
    expect(providers[0]?.region).toBe('DK');
    expect(providers[2]?.logoUrl).toBeNull();
    expect(fetchImpl.calls[0]).toContain('watch_region=DK');
    expect(fetchImpl.calls[0]).toContain('api_key=KEY');
  });
});

describe('toTmdbTitle', () => {
  it('laeser film og serier med hver deres felter', () => {
    expect(
      toTmdbTitle({ id: 1, title: 'Dune', release_date: '2021-10-22', poster_path: '/d.jpg', vote_average: 7.77, vote_count: 9 }, 'movie'),
    ).toEqual({ id: 1, kind: 'movie', title: 'Dune', year: 2021, posterUrl: 'https://image.tmdb.org/t/p/w342/d.jpg', rating: 7.8, overview: '' });
    expect(toTmdbTitle({ id: 2, name: 'The Crown', first_air_date: '2016-11-04', overview: 'Om…' }, 'series')).toMatchObject({
      kind: 'series',
      title: 'The Crown',
      year: 2016,
      posterUrl: null,
      rating: null,
      overview: 'Om…',
    });
    expect(toTmdbTitle({ id: 3 }, 'movie')).toBeNull();
  });
});

describe('discoverTitles og providerShelf', () => {
  it('spoerger paa tjeneste, land og abonnement, og fletter film og serier', async () => {
    const fetchImpl = fakeFetch([
      [/discover\/movie/, { results: [{ id: 1, title: 'F1' }, { id: 2, title: 'F2' }, { id: 3, title: 'F3' }] }],
      [/discover\/tv/, { results: [{ id: 9, name: 'S1' }] }],
    ]);
    const movies = await discoverTitles(fetchImpl, 'KEY', 8, 'movie');
    expect(movies).toHaveLength(3);
    expect(fetchImpl.calls[0]).toContain('with_watch_providers=8');
    expect(fetchImpl.calls[0]).toContain('watch_region=DK');
    expect(fetchImpl.calls[0]).toContain('watch_monetization_types=flatrate');

    const shelf = await providerShelf(fetchImpl, 'KEY', 8, 3);
    expect(shelf.map((t) => t.title)).toEqual(['F1', 'S1', 'F2']);
  });

  it('interleave fletter to lister og tager resten med', () => {
    expect(interleave<number | string>([1, 2, 3], ['a'])).toEqual([1, 'a', 2, 3]);
    expect(interleave([], [])).toEqual([]);
  });
});

describe('trendingTitles', () => {
  it('tager film og serier med, ikke personer', async () => {
    const fetchImpl = fakeFetch([
      [
        /trending\/all\/week/,
        {
          results: [
            { id: 1, media_type: 'movie', title: 'Film' },
            { id: 2, media_type: 'person', name: 'Skuespiller' },
            { id: 3, media_type: 'tv', name: 'Serie' },
          ],
        },
      ],
    ]);
    const titles = await trendingTitles(fetchImpl, 'KEY');
    expect(titles.map((t) => `${t.kind}:${t.title}`)).toEqual(['movie:Film', 'series:Serie']);
  });
});

describe('justWatchLink', () => {
  it('finder landets adresse under titlens udbydere', async () => {
    const fetchImpl = fakeFetch([[/movie\/5\/watch\/providers/, { results: { DK: { link: 'https://www.themoviedb.org/movie/5/watch?locale=DK' } } }]]);
    const title = { id: 5, kind: 'movie' as const, title: 'X', year: null, posterUrl: null, rating: null, overview: '' };
    expect(await justWatchLink(fetchImpl, 'KEY', title)).toContain('locale=DK');
    expect(await justWatchLink(fakeFetch([]), 'KEY', title)).toBeNull();
  });
});

describe('serviceSearchUrl', () => {
  it('kender de store tjenester og giver null for resten', () => {
    expect(serviceSearchUrl('Netflix', 'Dune: Part Two')).toBe('https://www.netflix.com/search?q=Dune%3A%20Part%20Two');
    expect(serviceSearchUrl('Disney Plus', 'Loki')).toContain('disneyplus.com');
    expect(serviceSearchUrl('Amazon Prime Video', 'Reacher')).toContain('primevideo.com');
    expect(serviceSearchUrl('Viaplay', 'Broen')).toContain('viaplay.dk');
    expect(serviceSearchUrl('Max', 'Succession')).toContain('play.max.com');
    expect(serviceSearchUrl('Apple TV Plus', 'Severance')).toContain('tv.apple.com');
    expect(serviceSearchUrl('TV 2 Play', 'Badehotellet')).toBe('https://play.tv2.dk/soeg?q=Badehotellet');
    expect(serviceSearchUrl('BBC iPlayer', 'Doctor Who')).toContain('bbc.co.uk/iplayer');
    expect(serviceSearchUrl('Blockbuster', 'X')).toBeNull();
  });
});

describe('listTmdbProvidersWithUk', () => {
  it('saetter de britiske efter de danske, uden dem der allerede er der', async () => {
    const fetchImpl = fakeFetch([
      [/watch_region=DK/, { results: [{ provider_id: 8, provider_name: 'Netflix', display_priorities: { DK: 1 } }] }],
      [
        /watch_region=GB/,
        {
          results: [
            { provider_id: 8, provider_name: 'Netflix', display_priorities: { GB: 1 } },
            { provider_id: 38, provider_name: 'BBC iPlayer', display_priorities: { GB: 2 } },
          ],
        },
      ],
    ]);
    const providers = await listTmdbProvidersWithUk(fetchImpl, 'KEY');
    expect(providers.map((p) => `${p.name}:${p.region}`)).toEqual(['Netflix:DK', 'BBC iPlayer:GB']);
  });
});
