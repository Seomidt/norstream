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
    expect(ranked.map((candidate) => candidate.id)).toEqual(['good', 'clip', 'other']);
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
