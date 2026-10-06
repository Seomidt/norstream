import { describe, expect, it } from 'vitest';
import { findAppleTrailers, matchSearch, normalizeTitle, pickAppleTrailers } from './appleTrailer.js';
import type { GetJson } from './appleTrailer.js';

const at = (year: number) => Date.UTC(year, 5, 1);

// Som Apples soegesvar (maalt 27. sep. 2026): upraecist — "Dune Part Two" gav andre film.
const SEARCH = {
  data: {
    canvas: {
      shelves: [
        { id: 'uts.col.search.TR', items: [{ id: 'umc.cmc.show', type: 'Show', title: 'Foundation', releaseDate: at(2021) }] },
        {
          id: 'uts.col.search.MV',
          items: [
            { id: 'umc.cmc.zero', type: 'Movie', title: 'Zero Dark Thirty', releaseDate: at(2012) },
            { id: 'umc.cmc.opp', type: 'Movie', title: 'Oppenheimer', releaseDate: at(2023) },
            { id: 'umc.cmc.ar', type: 'Movie', title: 'Another Round', releaseDate: at(2020) },
          ],
        },
      ],
    },
  },
};

const trailer = (id: string, title: string, duration: number, type = 'Trailer') => ({
  id,
  title,
  localizedType: type,
  type: 'Preview',
  playables: [{ duration, assets: { hlsUrl: `https://play-edge.itunes.apple.com/hls/${id}/playlist.m3u8` } }],
});

const PAGE = {
  data: {
    canvas: {
      shelves: [
        {
          items: [
            trailer('umc.cmc.teaser', 'Oppenheimer Teaser', 45),
            trailer('umc.cmc.t1', 'Oppenheimer Trailer', 180),
            trailer('umc.cmc.clip', 'Oppenheimer Clip', 120, 'Clip'),
            trailer('umc.cmc.t2', 'Oppenheimer Trailer 2', 150),
          ],
        },
      ],
    },
  },
};

describe('normalizeTitle', () => {
  it('ser bort fra store bogstaver, tegn og "the"', () => {
    expect(normalizeTitle('The Batman')).toBe(normalizeTitle('batman'));
    expect(normalizeTitle('Dune: Part Two')).toBe(normalizeTitle('Dune Part Two'));
    expect(normalizeTitle('Amélie')).toBe('amelie');
  });
});

describe('matchSearch', () => {
  it('tager kun den film hvor titel og aar passer', () => {
    expect(matchSearch(SEARCH, 'movie', ['Oppenheimer'], 2023)?.id).toBe('umc.cmc.opp');
    expect(matchSearch(SEARCH, 'movie', ['Druk', 'Another Round'], 2020)?.id).toBe('umc.cmc.ar');
  });

  it('bruger aldrig en film med andet navn, selv om soegningen gav den (Dune -> Zero Dark Thirty)', () => {
    expect(matchSearch(SEARCH, 'movie', ['Dune: Part Two'], 2024)).toBeNull();
  });

  it('afviser forkert aar (genindspilninger) og forkert slags', () => {
    expect(matchSearch(SEARCH, 'movie', ['Oppenheimer'], 1980)).toBeNull();
    expect(matchSearch(SEARCH, 'series', ['Oppenheimer'], 2023)).toBeNull();
    expect(matchSearch(SEARCH, 'series', ['Foundation'], 2021)?.id).toBe('umc.cmc.show');
  });
});

describe('pickAppleTrailers', () => {
  it('kun trailere mellem 1 og 6 minutter, i Apples raekkefoelge', () => {
    expect(pickAppleTrailers(PAGE).map((t) => t.id)).toEqual(['umc.cmc.t1', 'umc.cmc.t2']);
    expect(pickAppleTrailers(PAGE)[0]).toMatchObject({ name: 'Oppenheimer Trailer', seconds: 180 });
  });

  it('giver en tom liste for noget der ikke er en side', () => {
    expect(pickAppleTrailers(null)).toEqual([]);
    expect(pickAppleTrailers({ data: {} })).toEqual([]);
  });

  it('gentager ikke samme trailer gennem movieClips naar hylden allerede findes', () => {
    const both = { data: { ...PAGE.data, playables: { film: { itunesMediaApiData: { movieClips: [
      { title: 'Official Trailer', durationInMilliseconds: 150000, hlsUrl: 'https://apple.example/duplicate.m3u8' },
    ] } } } } };
    expect(pickAppleTrailers(both)).toHaveLength(2);
    expect(pickAppleTrailers(both).some((video) => video.id.startsWith('clip-'))).toBe(false);
  });

  it('finder movieClips uden Trailer-hylde og bruger varigheden i millisekunder', () => {
    expect(pickAppleTrailers({ data: { playables: { film: { itunesMediaApiData: { movieClips: [
      { title: 'Official Trailer', durationInMilliseconds: 150000, hlsUrl: 'https://apple.example/trailer.m3u8' },
      { title: 'Behind the scenes', durationInMilliseconds: 120000, hlsUrl: 'https://apple.example/clip.m3u8' },
    ] } } } } })).toEqual([{ id: 'clip-0', name: 'Official Trailer', seconds: 150, url: 'https://apple.example/trailer.m3u8' }]);
  });

  it('vaelger et spilbart asset selv naar det foerste mangler HLS', () => {
    const item = trailer('umc.cmc.t', 'Trailer', 150);
    item.playables.unshift({ duration: 150, assets: { hlsUrl: '' } });
    expect(pickAppleTrailers({ data: { canvas: { shelves: [{ items: [item] }] } } })).toHaveLength(1);
  });
});

describe('findAppleTrailers', () => {
  it('soeger, matcher og henter filmsiden', async () => {
    const asked: string[] = [];
    const getJson: GetJson = async (url) => {
      asked.push(url);
      return url.includes('/search?') ? SEARCH : PAGE;
    };
    const found = await findAppleTrailers(getJson, 'movie', ['Oppenheimer'], 2023);
    expect(found[0]?.id).toBe('umc.cmc.t1');
    expect(asked[0]).toContain('searchTerm=Oppenheimer');
    expect(asked[0]).toContain('pfm=appletv');
    expect(asked[0]).toContain('sf=143458');
    expect(asked[0]).toContain('locale=da-DK');
    expect(asked[1]).toContain('/movies/umc.cmc.opp?');
  });

  it('proever den naeste titel, og giver op uden at gaette', async () => {
    const getJson: GetJson = async (url) => (url.includes('/search?') ? SEARCH : PAGE);
    expect(await findAppleTrailers(getJson, 'movie', ['Dune: Part Two', 'Dune Part Two'], 2024)).toEqual([]);
    expect(await findAppleTrailers(async () => null, 'movie', ['Oppenheimer'], 2023)).toEqual([]);
  });
  it('proever USA naar Danmark ikke har et praecist match', async () => {
    const asked: string[] = [];
    const found = await findAppleTrailers(async (url) => {
      asked.push(url);
      return url.includes('sf=143458') ? null : url.includes('/search?') ? SEARCH : PAGE;
    }, 'movie', ['Oppenheimer'], 2023);
    expect(found).toHaveLength(2);
    expect(asked.some((url) => url.includes('sf=143441'))).toBe(true);
  });

});
