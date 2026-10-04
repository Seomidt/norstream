import { describe, expect, it } from 'vitest';
import { GENRES, genresFromTmdbIds, genresInText, packGenres, unpackGenres } from './genres.js';

describe('genresInText', () => {
  it('laeser genrer ud af panelets kategorinavne, dansk og engelsk', () => {
    expect(genresInText('DNK| Thriller')).toEqual(['thriller']);
    expect(genresInText('EN - ACTION & ADVENTURE')).toEqual(['action', 'eventyr']);
    expect(genresInText('DK | Komedie')).toEqual(['komedie']);
    expect(genresInText('Horror / Gyser')).toEqual(['gyser']);
    expect(genresInText('Sci-Fi')).toEqual(['scifi']);
    expect(genresInText('Børnefilm')).toEqual(['boern']);
  });

  it('korte ord kraever ordgraense: "war" rammer ikke "award"', () => {
    expect(genresInText('Award winners')).toEqual([]);
    expect(genresInText('War movies')).toEqual(['krig']);
    expect(genresInText('Krigsfilm')).toEqual(['krig']);
    expect(genresInText('Warner Bros')).toEqual([]);
  });

  it('panelets genrefelt med komma', () => {
    expect(genresInText('Action, Crime, Drama')).toEqual(['action', 'drama', 'krimi']);
    expect(genresInText(null)).toEqual([]);
    expect(genresInText('')).toEqual([]);
  });
});

describe('genresFromTmdbIds', () => {
  it('oversaetter film- og serie-id\'er uden gentagelser', () => {
    expect(genresFromTmdbIds([28, 53, 10759])).toEqual(['action', 'thriller']);
    expect(genresFromTmdbIds([99999])).toEqual([]);
    expect(genresFromTmdbIds(undefined)).toEqual([]);
  });

  it('alle TMDB-id\'er er unikke paa tvaers af listen', () => {
    const all = GENRES.flatMap((genre) => genre.tmdb);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('packGenres', () => {
  it('pakker med komma i begge ender og laeser tilbage', () => {
    expect(packGenres(['thriller', 'action', 'thriller'])).toBe(',thriller,action,');
    expect(packGenres([])).toBeNull();
    expect(unpackGenres(',thriller,action,')).toEqual(['thriller', 'action']);
    expect(unpackGenres(',ukendt,drama,')).toEqual(['drama']);
    expect(unpackGenres(null)).toEqual([]);
  });
});
