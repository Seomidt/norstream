import { describe, expect, it } from 'vitest';
import { continueEpisodeFor, latestEpisode, nextEpisode } from './episodes.js';

const ep = (season: number, episode: number, extra: Partial<{ positionSeconds: number | null; watched: boolean }> = {}) => ({
  key: `s${season}e${episode}`,
  season,
  episode,
  positionSeconds: null,
  watched: false,
  ...extra,
});

describe('nextEpisode', () => {
  it('finder det naeste, ogsaa over et saesonskift, og null efter det sidste', () => {
    const episodes = [ep(2, 1), ep(1, 2), ep(1, 1)];
    expect(nextEpisode(episodes, 's1e1')?.key).toBe('s1e2');
    expect(nextEpisode(episodes, 's1e2')?.key).toBe('s2e1');
    expect(nextEpisode(episodes, 's2e1')).toBeNull();
    expect(nextEpisode(episodes, 'ukendt')).toBeNull();
  });
});

describe('continueEpisodeFor', () => {
  it('peger paa det afsnit man var i gang med', () => {
    const episodes = [ep(1, 1, { watched: true }), ep(1, 2, { positionSeconds: 600 }), ep(1, 3)];
    expect(continueEpisodeFor(episodes)?.key).toBe('s1e2');
  });

  it('peger paa det naeste usete efter det sidste sete', () => {
    const episodes = [ep(1, 1, { watched: true }), ep(1, 2, { watched: true }), ep(1, 3), ep(1, 4)];
    expect(continueEpisodeFor(episodes)?.key).toBe('s1e3');
  });

  it('springer et set afsnit over selv om det har fremdrift', () => {
    const episodes = [ep(1, 1, { watched: true, positionSeconds: 2000 }), ep(1, 2)];
    expect(continueEpisodeFor(episodes)?.key).toBe('s1e2');
  });

  it('giver null naar man ikke er begyndt, eller alt er set', () => {
    expect(continueEpisodeFor([ep(1, 1), ep(1, 2)])).toBeNull();
    expect(continueEpisodeFor([ep(1, 1, { watched: true })])).toBeNull();
  });
});

describe('latestEpisode', () => {
  it('er sidste afsnit i sidste saeson, uanset raekkefoelgen den kommer i', () => {
    const list = [ep(2, 1), ep(1, 20), ep(2, 20), ep(1, 1)];
    expect(latestEpisode(list)?.key).toBe('s2e20');
  });

  it('er null for en serie uden afsnit', () => {
    expect(latestEpisode([])).toBeNull();
  });
});
