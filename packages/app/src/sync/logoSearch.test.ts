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
  it('soeger paa sproget, foretraekker en kanal og tager logoet fra P154', async () => {
    const fetchImpl = fakeFetch([
      [/wbsearchentities.*language=da/, SEARCH_DA],
      [
        /wbgetentities/,
        {
          entities: {
            Q1: { claims: {} },
            Q2: { claims: { P154: [{ rank: 'normal', mainsnak: { datavalue: { value: 'TV 2 Fri logo.svg' } } }] } },
            Q3: { claims: {} },
          },
        },
      ],
    ]);
    expect(await findWikidataLogo(fetchImpl, 'TV 2 Fri', 'da')).toEqual({
      url: 'https://commons.wikimedia.org/wiki/Special:FilePath/TV_2_Fri_logo.svg?width=400',
      fallbackUrl: null,
      label: 'TV 2 Fri',
      source: 'wikidata',
    });
    expect(fetchImpl.calls).toHaveLength(2);
    expect(fetchImpl.calls[0]).toContain('search=TV%202%20Fri');
  });

  it('tager ogsaa et opslag hvis beskrivelse ikke ligner en kanal, naar det har et logo', async () => {
    // Bredere: en kanal med en tynd/fremmed beskrivelse blev foer smidt vaek.
    const fetchImpl = fakeFetch([
      [/wbsearchentities/, { search: [{ id: 'Q7', label: 'MinFlix', description: 'streamingtjeneste' }] }],
      [/wbgetentities/, { entities: { Q7: { claims: { P154: [{ mainsnak: { datavalue: { value: 'MinFlix.png' } } }] } } } }],
    ]);
    const found = await findWikidataLogo(fetchImpl, 'MinFlix', 'da');
    expect(found?.url).toContain('MinFlix.png?width=400');
    expect(found?.label).toBe('MinFlix');
  });

  it('proever engelsk naar det egne sprog intet giver', async () => {
    const fetchImpl = fakeFetch([
      [/language=da/, { search: [] }],
      [/language=en/, { search: [{ id: 'Q9', label: 'DR P3', description: 'Danish radio station' }] }],
      [/wbgetentities/, { entities: { Q9: { claims: { P154: [{ mainsnak: { datavalue: { value: 'P3.png' } } }] } } } }],
    ]);
    const found = await findWikidataLogo(fetchImpl, 'DR P3', 'da');
    expect(found?.url).toContain('P3.png?width=400');
    // En PNG kan ogsaa hentes som den er, hvis den er for lille til at skaleres.
    expect(found?.fallbackUrl).toBe('https://commons.wikimedia.org/wiki/Special:FilePath/P3.png');
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
    const hits = await findLogoCandidates(
      { name: 'DNK| TV 2 Fri HD', country: 'DK', google: { key: 'K', cx: 'C' } },
      fetchImpl,
    );
    expect(hits.map((hit) => hit.source)).toEqual(['wikidata', 'google']);
    expect(fetchImpl.calls[0]).toMatch(/search=TV%202%20Fri$/);
    expect(fetchImpl.calls[0]).toContain('language=da');
  });

  it('spoerger ikke Google uden noegle, og slet ikke naar navnet er tomt', async () => {
    const fetchImpl = fakeFetch([]);
    expect(await findLogoCandidates({ name: 'DNK| HD', country: 'DK' }, fetchImpl)).toEqual([]);
    expect(fetchImpl.calls).toHaveLength(0);
    await findLogoCandidates({ name: 'DR1', country: 'DK', google: null }, fetchImpl);
    expect(fetchImpl.calls.every((url) => !url.includes('customsearch'))).toBe(true);
  });
});
