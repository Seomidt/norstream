import { describe, expect, it } from 'vitest';
import {
  durationMinutes,
  mapEpisodes,
  mapVodDetails,
  mapVodItems,
  youtubeId,
} from './vodMapping.js';

describe('mapVodItems', () => {
  it('laeser en film som panelet skriver den', () => {
    const [film] = mapVodItems(
      [
        {
          stream_id: 4711,
          name: 'Materialists',
          stream_icon: 'http://p/img/4711.jpg',
          rating: '7.3',
          added: '1725000000',
          category_id: '12',
          container_extension: 'mkv',
          releasedate: '2025-06-13',
        },
      ],
      'movie',
    );
    expect(film).toEqual({
      id: '4711',
      kind: 'movie',
      name: 'Materialists',
      posterUrl: 'http://p/img/4711.jpg',
      categoryId: '12',
      rating: 7.3,
      year: 2025,
      added: new Date(1725000000 * 1000),
      containerExtension: 'mkv',
    });
  });

  it('laeser en serie paa dens eget id og plakatfelt', () => {
    const [serie] = mapVodItems(
      [{ series_id: '99', name: 'Jane the Virgin', cover: 'http://p/c.jpg', releaseDate: '2014' }],
      'series',
    );
    expect(serie?.id).toBe('99');
    expect(serie?.kind).toBe('series');
    expect(serie?.posterUrl).toBe('http://p/c.jpg');
    expect(serie?.year).toBe(2014);
    // Serier har ingen filendelse; det har afsnittene.
    expect(serie?.containerExtension).toBeNull();
  });

  // Panelerne skriver 0 naar de ingen bedoemmelse har. En film med "0 af 10"
  // er ikke en daarlig film — det er en film uden bedoemmelse.
  it('regner nul som ingen bedoemmelse', () => {
    expect(mapVodItems([{ stream_id: 1, name: 'A', rating: 0 }], 'movie')[0]?.rating).toBeNull();
    expect(mapVodItems([{ stream_id: 1, name: 'A', rating: '' }], 'movie')[0]?.rating).toBeNull();
  });

  it('springer poster uden id eller navn over', () => {
    expect(mapVodItems([{ name: 'uden id' }, { stream_id: 1 }, 'vroevl', null], 'movie')).toEqual(
      [],
    );
  });

  it('giver en tom liste naar svaret ikke er en liste', () => {
    expect(mapVodItems({ error: 'x' }, 'movie')).toEqual([]);
  });
});

describe('youtubeId', () => {
  // Nogle paneler skriver id'et alene, andre hele adressen. Kun id'et gemmes,
  // saa knappen altid bygger den samme adresse.
  it('tager id-et som det staar', () => {
    expect(youtubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('tager id-et ud af de adresser panelerne skriver', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youtubeId('https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0')).toBe('dQw4w9WgXcQ');
  });

  it('giver null for tomt og for noget der ikke er et id', () => {
    expect(youtubeId('')).toBeNull();
    expect(youtubeId(null)).toBeNull();
    expect(youtubeId('ikke et id')).toBeNull();
  });
});

describe('durationMinutes', () => {
  it('tager minutterne naar panelet oplyser dem', () => {
    expect(durationMinutes({ episode_run_time: '116' })).toBe(116);
  });

  it('regner sekunder om', () => {
    expect(durationMinutes({ duration_secs: 5580 })).toBe(93);
  });

  it('laeser et klokkeslaet', () => {
    expect(durationMinutes({ duration: '01:32:00' })).toBe(92);
  });

  it('giver null naar intet af det er der', () => {
    expect(durationMinutes({})).toBeNull();
    expect(durationMinutes({ episode_run_time: '0', duration: 'vroevl' })).toBeNull();
  });
});

describe('mapVodDetails', () => {
  it('laeser det panelet ved om filmen', () => {
    const details = mapVodDetails({
      info: {
        plot: 'En matchmaker i New York …',
        genre: 'Romance, Drama',
        cast: 'Dakota Johnson, Chris Evans',
        director: 'Celine Song',
        episode_run_time: '116',
        youtube_trailer: 'https://youtu.be/dQw4w9WgXcQ',
        backdrop_path: ['http://p/bd.jpg', 'http://p/bd2.jpg'],
        rating: 7.3,
        releasedate: '2025-06-13',
      },
    });
    expect(details).toEqual({
      plot: 'En matchmaker i New York …',
      genre: 'Romance, Drama',
      cast: 'Dakota Johnson, Chris Evans',
      director: 'Celine Song',
      durationMinutes: 116,
      trailerId: 'dQw4w9WgXcQ',
      backdropUrl: 'http://p/bd.jpg',
      rating: 7.3,
      year: 2025,
    });
  });

  it('falder tilbage paa description og actors', () => {
    const details = mapVodDetails({ info: { description: 'Handling', actors: 'A, B' } });
    expect(details.plot).toBe('Handling');
    expect(details.cast).toBe('A, B');
  });

  it('giver null hele vejen naar svaret er tomt', () => {
    expect(mapVodDetails({}).plot).toBeNull();
    expect(mapVodDetails(null).trailerId).toBeNull();
  });
});

describe('mapEpisodes', () => {
  const body = {
    episodes: {
      '1': [
        { id: '1001', episode_num: 1, title: 'Pilot', container_extension: 'mkv', season: 1,
          info: { plot: 'Det begynder.', duration_secs: 2520, releasedate: '2014-10-13' } },
        { id: '1002', episode_num: 2, title: 'Chapter Two', container_extension: 'mkv', season: 1,
          info: {} },
      ],
      '2': [{ id: '2001', episode_num: 1, title: 'Chapter Twenty-Three', container_extension: 'mp4' }],
    },
  };

  it('laeser afsnittene med saeson og nummer', () => {
    const episodes = mapEpisodes(body, '99');
    expect(episodes.map((e) => [e.season, e.episode, e.title])).toEqual([
      [1, 1, 'Pilot'],
      [1, 2, 'Chapter Two'],
      [2, 1, 'Chapter Twenty-Three'],
    ]);
    expect(episodes[0]).toMatchObject({
      id: '1001',
      seriesId: '99',
      plot: 'Det begynder.',
      durationMinutes: 42,
      containerExtension: 'mkv',
      airDate: '2014-10-13',
    });
  });

  // Nogle paneler sender en liste af lister frem for et objekt med
  // saesonnummeret som noegle. Begge former skal laeses.
  it('laeser ogsaa en liste af lister', () => {
    const episodes = mapEpisodes(
      { episodes: [[{ id: 'a', episode_num: 1 }], [{ id: 'b', episode_num: 1 }]] },
      '7',
    );
    expect(episodes.map((e) => [e.season, e.id])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it('giver et navn til et afsnit uden titel', () => {
    expect(mapEpisodes({ episodes: { '1': [{ id: 'x', episode_num: 3 }] } }, '7')[0]?.title).toBe(
      'Afsnit 3',
    );
  });

  it('giver en tom liste uden afsnit', () => {
    expect(mapEpisodes({}, '7')).toEqual([]);
    expect(mapEpisodes(null, '7')).toEqual([]);
  });
});
