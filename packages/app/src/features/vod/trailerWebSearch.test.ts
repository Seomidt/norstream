import { describe, expect, it } from 'vitest';
import { parseClock, parseYoutubeSearch, rankYoutubeTrailers, searchYoutubeTrailers } from './trailerSearch.js';

function page(videos: Array<{ id: string; title: string; length?: string }>): string {
  const contents = videos.map((video) => ({
    videoRenderer: {
      videoId: video.id,
      title: { runs: [{ text: video.title }] },
      ...(video.length === undefined ? {} : { lengthText: { simpleText: video.length } }),
    },
  }));
  const data = { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents } }] } } } } };
  return `<html><script>var ytInitialData = ${JSON.stringify(data)};</script></html>`;
}

describe('parseClock', () => {
  it('laeser minutter og timer', () => {
    expect(parseClock('2:31')).toBe(151);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('')).toBe(0);
    expect(parseClock('LIVE')).toBe(0);
  });
});

describe('parseYoutubeSearch', () => {
  it('finder videoerne i YouTubes raekkefoelge', () => {
    const found = parseYoutubeSearch(
      page([
        { id: 'aaaaaaaaaaa', title: 'Tuner Official Trailer', length: '2:10' },
        { id: 'bbbbbbbbbbb', title: 'Tuner review', length: '12:00' },
      ]),
    );
    expect(found).toEqual([
      { id: 'aaaaaaaaaaa', title: 'Tuner Official Trailer', seconds: 130 },
      { id: 'bbbbbbbbbbb', title: 'Tuner review', seconds: 720 },
    ]);
  });

  it('giver tomt ved en side uden data', () => {
    expect(parseYoutubeSearch('<html>samtykke</html>')).toEqual([]);
  });

  it('laeser window-varianten og flere scriptsaetninger uden at stoppe ved klammer i titlen', () => {
    const html = page([{ id: 'aaaaaaaaaaa', title: 'Tuner {Official} Trailer', length: '2:00' }])
      .replace('var ytInitialData', 'window["ytInitialData"]').replace(';</script>', '; window.next = {};</script>');
    expect(parseYoutubeSearch(html)[0]?.title).toBe('Tuner {Official} Trailer');
  });
});

describe('rankYoutubeTrailers', () => {
  it('tager rigtige trailere med filmens navn, og dropper anmeldelser og for lange/korte', () => {
    const ranked = rankYoutubeTrailers(
      [
        { id: 'review', title: 'Tuner - Review', seconds: 300 },
        { id: 'short', title: 'Tuner trailer', seconds: 20 },
        { id: 'other', title: 'Some other movie trailer', seconds: 150 },
        { id: 'clip', title: 'Tuner clip', seconds: 120 },
        { id: 'good', title: 'TUNER | Official Trailer', seconds: 140 },
        { id: 'long', title: 'Tuner full movie', seconds: 5400 },
      ],
      'Tuner',
    );
    expect(ranked.map((candidate) => candidate.id)).toEqual(['good', 'clip']);
  });
});

describe('searchYoutubeTrailers', () => {
  it('soeger paa titel og aar, med samtykke-cookie, og giver de bedste', async () => {
    let askedUrl = '';
    let askedHeaders: Record<string, string> = {};
    const found = await searchYoutubeTrailers(
      async (url, headers) => {
        askedUrl = url;
        askedHeaders = headers;
        return page([{ id: 'ccccccccccc', title: 'Tuner (2026) Trailer', length: '2:00' }]);
      },
      'Tuner',
      2026,
    );
    expect(askedUrl).toContain('search_query=Tuner%202026%20trailer');
    expect(askedHeaders.Cookie).toContain('SOCS=CAI');
    expect(found.map((candidate) => candidate.id)).toEqual(['ccccccccccc']);
  });

  it('giver tomt naar siden ikke kan hentes', async () => {
    expect(await searchYoutubeTrailers(async () => null, 'Tuner', null)).toEqual([]);
    expect(
      await searchYoutubeTrailers(async () => {
        throw new Error('net');
      }, 'Tuner', null),
    ).toEqual([]);
  });
});


describe('danske titler og reserveopslag', () => {
  it('finder Nordisk Films Vores loefte selv naar panelet kalder den Vores loefter', () => {
    const official = { id: '-711Ef0I7Jc', title: 'Vores løfte | Trailer', seconds: 117, channel: 'Nordisk Film' };
    expect(rankYoutubeTrailers([official], 'Vores løfter')).toEqual([official]);
    expect(rankYoutubeTrailers([official], 'Vores loefte')).toEqual([official]);
    expect(rankYoutubeTrailers([official], 'Vores andre løfter')).toEqual([]);
  });

  it('foretraekker distributoeren og afviser andre film, efterfoelgere og nyindspilninger', () => {
    const candidates = [
      { id: 'copy', title: 'Vores løfte trailer', seconds: 117, channel: 'Trailer Fans' },
      { id: 'official', title: 'Vores løfte | Trailer', seconds: 117, channel: 'Nordisk Film' },
      { id: 'wrong', title: 'Vores kærlighed | Trailer', seconds: 130, channel: 'Nordisk Film' },
      { id: 'sequel', title: 'Vores løfte 2 Trailer', seconds: 130 },
      { id: 'remake', title: 'Vores løfte (1996) Trailer', seconds: 130 },
      { id: 'reaction', title: 'Vores løfte trailer reaction', seconds: 130 },
    ];
    expect(rankYoutubeTrailers(candidates, 'Vores løfter', 5, 2026).map((v) => v.id)).toEqual(['official', 'copy']);
    expect(rankYoutubeTrailers([{ id: 'wrong', title: 'Aliens trailer', seconds: 120 }], 'Alien')).toEqual([]);
  });

  it('proever uden aar og derefter en forsigtig boejningsvariant', async () => {
    const queries: string[] = [];
    const found = await searchYoutubeTrailers(async (url) => {
      const query = new URL(url).searchParams.get('search_query')!;
      queries.push(query);
      return query === 'Vores løfte trailer' ? page([{ id: '-711Ef0I7Jc', title: 'Vores løfte | Trailer', length: '1:57' }]) : page([]);
    }, 'Vores løfter', 2026);
    expect(queries).toEqual(['Vores løfter 2026 trailer', 'Vores løfter trailer', 'Vores løfte trailer']);
    expect(found[0]?.id).toBe('-711Ef0I7Jc');
  });

  it('laeser mobilens headline og varigheden i thumbnail-overlay', () => {
    const data = { videoWithContextRenderer: { videoId: '-711Ef0I7Jc', headline: { runs: [{ text: 'Vores løfte | Trailer' }] },
      shortBylineText: { runs: [{ text: 'Nordisk Film' }] }, thumbnailOverlays: [{ thumbnailOverlayTimeStatusRenderer: { text: { simpleText: '1:57' } } }] } };
    expect(parseYoutubeSearch(`var ytInitialData = ${JSON.stringify(data)};`)).toEqual([{ id: '-711Ef0I7Jc', title: 'Vores løfte | Trailer', seconds: 117, channel: 'Nordisk Film' }]);
  });

  it('kasserer ikke en rigtig trailer bare fordi soegesiden skjuler varigheden', () => {
    const unknown = { id: 'a', title: 'Vores løfte | Trailer', seconds: 0 };
    expect(rankYoutubeTrailers([unknown], 'Vores løfte')).toEqual([unknown]);
    expect(rankYoutubeTrailers([{ ...unknown, title: 'Vores løfte interview' }], 'Vores løfte')).toEqual([]);
  });
});


it('bevarer mere komplet metadata naar YouTube gentager samme video', () => {
  const data = { contents: [
    { videoRenderer: { videoId: '-711Ef0I7Jc', title: { simpleText: 'Vores løfte | Trailer' } } },
    { videoRenderer: { videoId: '-711Ef0I7Jc', title: { simpleText: 'Vores løfte | Trailer' }, lengthText: { simpleText: '1:57' }, ownerText: { runs: [{ text: 'Nordisk Film' }] } } },
  ] };
  expect(parseYoutubeSearch(`var ytInitialData = ${JSON.stringify(data)};`)).toEqual([{ id: '-711Ef0I7Jc', title: 'Vores løfte | Trailer', seconds: 117, channel: 'Nordisk Film' }]);
});


it('forveksler ikke filmtitler med negative descriptor-ord eller skriftlige efterfoelgere', () => {
  const trailer = { id: 'ok', title: 'The NeverEnding Story Official Trailer', seconds: 150 };
  expect(rankYoutubeTrailers([trailer], 'The NeverEnding Story')).toEqual([trailer]);
  expect(rankYoutubeTrailers([{ ...trailer, title: 'The NeverEnding Story trailer reaction' }], 'The NeverEnding Story')).toEqual([]);
  expect(rankYoutubeTrailers([{ ...trailer, title: 'Dune Part Two Official Trailer' }], 'Dune')).toEqual([]);
});
