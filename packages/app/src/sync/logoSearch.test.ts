import { describe, expect, it } from 'vitest';
import {
  commonsFileUrl,
  findGoogleLogos,
  findLogoCandidates,
  findWikidataLogo,
  looksLikeChannel,
  searchNameFor,
  wikidataLanguageFor,
} from './logoSearch.js';
import type { LogoSearchFetch } from './logoSearch.js';

describe('searchNameFor', () => {
  it('tager panelets praefiks, landekode, parenteser og kvalitetsord ud', () => {
    expect(searchNameFor('DNK| TV 2 Fri HD')).toBe('TV 2 Fri');
    expect(searchNameFor('DK: DR P3 (RADIO)')).toBe('DR P3');
    expect(searchNameFor('DK - TV3 Sport FHD [4K]')).toBe('TV3 Sport');
    expect(searchNameFor('  Kanal 5  ')).toBe('Kanal 5');
  });

  it('lader et navn der ligner en landekode staa naar det ikke er et land', () => {
    expect(searchNameFor('DR - P3')).toBe('DR - P3');
    expect(searchNameFor('TV2 - Zulu')).toBe('TV2 - Zulu');
  });
});

describe('wikidataLanguageFor', () => {
  it('vaelger sproget efter landet og engelsk ellers', () => {
    expect(wikidataLanguageFor('DK')).toBe('da');
    expect(wikidataLanguageFor('se')).toBe('sv');
    expect(wikidataLanguageFor('')).toBe('en');
    expect(wikidataLanguageFor('US')).toBe('en');
  });
});

describe('looksLikeChannel', () => {
  it('kender en kanal paa beskrivelsen', () => {
    expect(looksLikeChannel('dansk tv-kanal')).toBe(true);
    expect(looksLikeChannel('Danish television channel')).toBe(true);
    expect(looksLikeChannel('radiostation i Danmark')).toBe(true);
    expect(looksLikeChannel('Danish footballer')).toBe(false);
    expect(looksLikeChannel(undefined)).toBe(false);
  });
});

describe('commonsFileUrl', () => {
  it('bygger adressen paa en fil i den oenskede bredde', () => {
    expect(commonsFileUrl('TV 2 Fri logo.svg')).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/TV_2_Fri_logo.svg?width=400',
    );
    expect(commonsFileUrl('File:DR P3.png', 200)).toBe(
      'https://commons.wikimedia.org/wiki/Special:FilePath/DR_P3.png?width=200',
    );
  });
});

function fakeFetch(answers: Array<[RegExp, unknown]>): LogoSearchFetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    calls.push(url);
    const hit = answers.find(([pattern]) => pattern.test(url));
    const body = hit === undefined ? {} : hit[1];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  }) as LogoSearchFetch & { calls: string[] };
  impl.calls = calls;
  return impl;
}

const SEARCH_DA = {
  search: [
    { id: 'Q1', label: 'TV 2 Fri', description: 'dansk fodboldspiller' },
    { id: 'Q2', label: 'TV 2 Fri', description: 'dansk tv-kanal' },
    { id: 'Q3', label: 'TV 2 Fri Sport', description: 'dansk tv-kanal' },
  ],
};

describe('findWikidataLogo', () => {
  it('soeger paa sproget, sorterer ikke-kanaler fra og tager logoet fra P154', async () => {
    const fetchImpl = fakeFetch([
      [/wbsearchentities.*language=da/, SEARCH_DA],
      [
        /wbgetentities.*ids=Q2%7CQ3|wbgetentities.*ids=Q2\|Q3/,
        {
          entities: {
            Q2: { claims: { P154: [{ rank: 'normal', mainsnak: { datavalue: { value: 'TV 2 Fri logo.svg' } } }] } },
            Q3: { claims: {} },
          },
        },
      ],
    ]);
    expect(await findWikidataLogo(fetchImpl, 'TV 2 Fri', 'da')).toEqual({
      url: 'https://commons.wikimedia.org/wiki/Special:FilePath/TV_2_Fri_logo.svg?width=400',
      label: 'TV 2 Fri',
      source: 'wikidata',
    });
    expect(fetchImpl.calls).toHaveLength(2);
    expect(fetchImpl.calls[0]).toContain('search=TV%202%20Fri');
    // Q1 er en fodboldspiller og bedes der ikke om.
    expect(fetchImpl.calls[1]).not.toContain('Q1');
  });

  it('proever engelsk naar det egne sprog intet giver', async () => {
    const fetchImpl = fakeFetch([
      [/language=da/, { search: [] }],
      [/language=en/, { search: [{ id: 'Q9', label: 'DR P3', description: 'Danish radio station' }] }],
      [/wbgetentities/, { entities: { Q9: { claims: { P154: [{ mainsnak: { datavalue: { value: 'P3.png' } } }] } } } }],
    ]);
    expect((await findWikidataLogo(fetchImpl, 'DR P3', 'da'))?.url).toContain('P3.png');
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it('foretraekker et foretrukket logo og springer et forkastet over', async () => {
    const fetchImpl = fakeFetch([
      [/wbsearchentities/, { search: [{ id: 'Q5', label: 'X', description: 'tv channel' }] }],
      [
        /wbgetentities/,
        {
          entities: {
            Q5: {
              claims: {
                P154: [
                  { rank: 'deprecated', mainsnak: { datavalue: { value: 'Old.svg' } } },
                  { rank: 'normal', mainsnak: { datavalue: { value: 'Normal.svg' } } },
                  { rank: 'preferred', mainsnak: { datavalue: { value: 'New.svg' } } },
                ],
              },
            },
          },
        },
      ],
    ]);
    expect((await findWikidataLogo(fetchImpl, 'X', 'en'))?.url).toContain('New.svg');
  });

  it('giver null naar intet opslag har et logo, og naar netvaerket kaster', async () => {
    const fetchImpl = fakeFetch([[/wbsearchentities/, SEARCH_DA], [/wbgetentities/, { entities: { Q2: {}, Q3: {} } }]]);
    expect(await findWikidataLogo(fetchImpl, 'TV 2 Fri', 'da')).toBeNull();
    const broken = (async () => {
      throw new Error('Network request failed');
    }) as unknown as LogoSearchFetch;
    expect(await findWikidataLogo(broken, 'TV 2 Fri', 'da')).toBeNull();
    expect(await findWikidataLogo(fetchImpl, '   ', 'da')).toBeNull();
  });
});

describe('findGoogleLogos', () => {
  it('soeger paa "navn logo" med noegle og cx, og tager kun billeder telefonen kan tegne', async () => {
    const fetchImpl = fakeFetch([
      [
        /customsearch/,
        {
          items: [
            { link: 'https://a/logo.svg', mime: 'image/svg+xml', title: 'svg' },
            { link: 'https://a/logo.png', mime: 'image/png', title: 'TV 2 Fri logo' },
            { link: 'ftp://nej', mime: 'image/png' },
            { link: 'https://a/logo.jpg', mime: 'image/jpeg' },
          ],
        },
      ],
    ]);
    const hits = await findGoogleLogos(fetchImpl, { key: 'K', cx: 'CX' }, 'TV 2 Fri');
    expect(hits.map((hit) => hit.url)).toEqual(['https://a/logo.png', 'https://a/logo.jpg']);
    expect(hits[0]?.label).toBe('TV 2 Fri logo');
    expect(fetchImpl.calls[0]).toContain('key=K');
    expect(fetchImpl.calls[0]).toContain('cx=CX');
    expect(fetchImpl.calls[0]).toContain('searchType=image');
    expect(fetchImpl.calls[0]).toContain('q=TV%202%20Fri%20logo');
  });

  it('spoerger ikke uden noegle', async () => {
    const fetchImpl = fakeFetch([]);
    expect(await findGoogleLogos(fetchImpl, { key: '', cx: 'CX' }, 'TV 2 Fri')).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});

describe('findLogoCandidates', () => {
  it('renser navnet, tager Wikidata foerst og Google bagefter', async () => {
    const fetchImpl = fakeFetch([
      [/wbsearchentities/, { search: [{ id: 'Q2', label: 'TV 2 Fri', description: 'dansk tv-kanal' }] }],
      [/wbgetentities/, { entities: { Q2: { claims: { P154: [{ mainsnak: { datavalue: { value: 'Fri.svg' } } }] } } } }],
      [/customsearch/, { items: [{ link: 'https://g/fri.png', mime: 'image/png' }] }],
    ]);
    const hits = await findLogoCandidates(fetchImpl, {
      name: 'DNK| TV 2 Fri HD',
      country: 'DK',
      google: { key: 'K', cx: 'C' },
    });
    expect(hits.map((hit) => hit.source)).toEqual(['wikidata', 'google']);
    expect(fetchImpl.calls[0]).toMatch(/search=TV%202%20Fri$/);
    expect(fetchImpl.calls[0]).toContain('language=da');
  });

  it('spoerger ikke Google uden noegle, og slet ikke naar navnet er tomt', async () => {
    const fetchImpl = fakeFetch([]);
    expect(await findLogoCandidates(fetchImpl, { name: 'DNK| HD', country: 'DK' })).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(0);
    await findLogoCandidates(fetchImpl, { name: 'DR1', country: 'DK', google: null });
    expect(fetchImpl.calls.every((url) => !url.includes('customsearch'))).toBe(true);
  });
});
