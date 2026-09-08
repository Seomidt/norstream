import { describe, expect, it } from 'vitest';
import { comparable, findAppleTrailer, pickAppleTrailer } from './appleTrailers.js';
import type { AppleFetch } from './appleTrailers.js';

function fakeFetch(answers: Array<[RegExp, unknown]>): AppleFetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const hit = answers.find(([pattern]) => pattern.test(url));
    const body = hit === undefined ? { results: [] } : hit[1];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as AppleFetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const DUNE_2021 = { trackName: 'Dune', releaseDate: '2021-10-21T07:00:00Z', previewUrl: 'https://video-ssl.itunes.apple.com/dune2021.m4v' };
const DUNE_1984 = { trackName: 'Dune', releaseDate: '1984-12-14T08:00:00Z', previewUrl: 'https://video-ssl.itunes.apple.com/dune1984.m4v' };
const DUNE_TWO = { trackName: 'Dune: Part Two', releaseDate: '2024-03-01T08:00:00Z', previewUrl: 'https://video-ssl.itunes.apple.com/dune2.m4v' };

describe('pickAppleTrailer', () => {
  it('tager den med samme titel og rigtigt aarstal', () => {
    expect(pickAppleTrailer([DUNE_1984, DUNE_2021, DUNE_TWO], 'Dune', 2021)?.url).toContain('dune2021');
    expect(pickAppleTrailer([DUNE_1984, DUNE_2021], 'Dune', 1984)?.url).toContain('dune1984');
    expect(pickAppleTrailer([DUNE_2021, DUNE_TWO], 'Dune - Part Two', 2024)?.url).toContain('dune2.m4v');
  });

  it('noejes med en titel der begynder rigtigt, naar den praecise mangler', () => {
    expect(pickAppleTrailer([DUNE_TWO], 'Dune', null)?.url).toContain('dune2.m4v');
    // Men ikke naar aarstallet er langt vaek.
    expect(pickAppleTrailer([DUNE_TWO], 'Dune', 2021)).toBeNull();
  });

  it('giver null uden preview, og for noget helt andet', () => {
    expect(pickAppleTrailer([{ trackName: 'Dune', releaseDate: '2021-01-01' }], 'Dune', 2021)).toBeNull();
    expect(pickAppleTrailer([DUNE_2021], 'Klovn', null)).toBeNull();
    expect(comparable('Fast & Furious 7')).toBe('fast and furious 7');
  });
});

describe('findAppleTrailer', () => {
  it('spoerger den danske butik foerst og den amerikanske bagefter', async () => {
    const fetchImpl = fakeFetch([
      [/country=dk/, { results: [] }],
      [/country=us/, { results: [DUNE_2021] }],
    ]);
    const found = await findAppleTrailer(fetchImpl, 'Dune', 2021);
    expect(found).toEqual({ url: 'https://video-ssl.itunes.apple.com/dune2021.m4v', name: 'Dune', year: 2021, store: 'us' });
    expect(fetchImpl.calls).toHaveLength(2);
    expect(fetchImpl.calls[0]).toContain('term=Dune');
    expect(fetchImpl.calls[0]).toContain('media=movie');
  });

  it('stopper ved det foerste fund, og giver null naar nettet kaster', async () => {
    const fetchImpl = fakeFetch([[/country=dk/, { results: [DUNE_2021] }]]);
    expect((await findAppleTrailer(fetchImpl, 'Dune', 2021))?.store).toBe('dk');
    expect(fetchImpl.calls).toHaveLength(1);
    const broken = (async () => {
      throw new Error('Network request failed');
    }) as unknown as AppleFetch;
    expect(await findAppleTrailer(broken, 'Dune', 2021)).toBeNull();
    expect(await findAppleTrailer(fetchImpl, '  ', null)).toBeNull();
  });
});
