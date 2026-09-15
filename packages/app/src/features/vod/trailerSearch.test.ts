import { describe, expect, it } from 'vitest';
import type { FetchLike } from '@norstream/core';
import {
  findLongerTrailer,
  parseIsoDuration,
  pickTrailer,
  trailerQuery,
  youtubeSearchUrl,
} from './trailerSearch.js';

describe('parseIsoDuration', () => {
  it('laeser YouTubes varigheder', () => {
    expect(parseIsoDuration('PT8S')).toBe(8);
    expect(parseIsoDuration('PT1M30S')).toBe(90);
    expect(parseIsoDuration('PT2M')).toBe(120);
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('P1DT1S')).toBe(86_401);
  });

  it('giver nul for noget der ikke er en varighed', () => {
    expect(parseIsoDuration('')).toBe(0);
    expect(parseIsoDuration('90')).toBe(0);
  });
});

describe('trailerQuery', () => {
  it('soeger paa titel, aar og ordet trailer', () => {
    expect(trailerQuery('Spider-Man: No Way Home', 2021)).toBe('Spider-Man: No Way Home 2021 trailer');
    expect(trailerQuery('  Dune  ', null)).toBe('Dune trailer');
  });

  it('bygger YouTubes soegeside med adressen kodet', () => {
    expect(youtubeSearchUrl('Dune', 2021)).toBe(
      'https://m.youtube.com/results?search_query=Dune%202021%20trailer',
    );
  });
});

describe('pickTrailer', () => {
  const teaser = { id: 't', title: 'Official Teaser', seconds: 8 };
  const shortTrailer = { id: 's', title: 'Trailer', seconds: 40 };
  const longTeaser = { id: 'lt', title: 'Teaser Trailer', seconds: 95 };
  const trailer = { id: 'ok', title: 'Official Trailer', seconds: 150 };
  const clip = { id: 'c', title: 'Behind the scenes', seconds: 300 };

  it('kasserer dem der er for korte og den vi kom fra', () => {
    expect(pickTrailer([teaser, shortTrailer], 60, null)).toBeNull();
    expect(pickTrailer([trailer], 60, 'ok')).toBeNull();
  });

  it('foretraekker en der kalder sig trailer, saa alt andet, saa teasere', () => {
    expect(pickTrailer([clip, longTeaser, trailer], 60, null)).toBe(trailer);
    expect(pickTrailer([longTeaser, clip], 60, null)).toBe(clip);
    expect(pickTrailer([longTeaser], 60, null)).toBe(longTeaser);
  });

  it('bevarer soegningens raekkefoelge inden for samme gruppe', () => {
    const second = { id: 'ok2', title: 'Official Trailer 2', seconds: 140 };
    expect(pickTrailer([trailer, second], 60, null)).toBe(trailer);
    expect(pickTrailer([second, trailer], 60, null)).toBe(second);
  });
});

function fakeFetch(answers: Record<string, unknown>, status = 200): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const match = Object.keys(answers).find((prefix) => url.startsWith(prefix));
    const body = match === undefined ? {} : answers[match];
    return {
      ok: status === 200,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  }) as FetchLike & { calls: string[] };
  impl.calls = calls;
  return impl;
}

describe('findLongerTrailer', () => {
  it('soeger, slaar varigheden op og vaelger en lang nok', async () => {
    const fetchImpl = fakeFetch({
      'https://www.googleapis.com/youtube/v3/search': {
        items: [
          { id: { videoId: 'aaa' }, snippet: { title: 'Official Teaser' } },
          { id: { videoId: 'bbb' }, snippet: { title: 'Official Trailer' } },
        ],
      },
      'https://www.googleapis.com/youtube/v3/videos': {
        items: [
          { id: 'bbb', contentDetails: { duration: 'PT2M31S' } },
          { id: 'aaa', contentDetails: { duration: 'PT8S' } },
        ],
      },
    });

    const found = await findLongerTrailer(fetchImpl, 'KEY', 'Spider-Man', 2021, 'aaa');

    expect(found).toEqual({ id: 'bbb', title: 'Official Trailer', seconds: 151 });
    expect(fetchImpl.calls[0]).toContain('q=Spider-Man%202021%20trailer');
    expect(fetchImpl.calls[0]).toContain('videoEmbeddable=true');
    expect(fetchImpl.calls[0]).toContain('key=KEY');
    expect(fetchImpl.calls[1]).toContain('id=aaa%2Cbbb'.replace('%2C', ','));
  });

  it('giver null naar API-svaret er en fejl, uden at kaste', async () => {
    const fetchImpl = fakeFetch({}, 403);
    await expect(findLongerTrailer(fetchImpl, 'KEY', 'Dune', null, null)).resolves.toBeNull();
  });

  it('giver null naar soegningen intet finder', async () => {
    const fetchImpl = fakeFetch({ 'https://www.googleapis.com/youtube/v3/search': { items: [] } });
    await expect(findLongerTrailer(fetchImpl, 'KEY', 'Dune', null, null)).resolves.toBeNull();
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('giver null naar netvaerket kaster', async () => {
    const fetchImpl = (async () => {
      throw new Error('Network request failed');
    }) as unknown as FetchLike;
    await expect(findLongerTrailer(fetchImpl, 'KEY', 'Dune', null, null)).resolves.toBeNull();
  });
});
