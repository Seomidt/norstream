import { describe, expect, it } from 'vitest';
import { parentVodLevel } from './vodNavigation.js';

describe('Film og Serier: Tilbage', () => {
  for (const kind of ['movie', 'series'] as const) {
    it(`${kind}: udvalg gaar tilbage til lande og derefter katalogets forside`, () => {
      const countries = parentVodLevel({ name: 'filter', kind });
      expect(countries).toEqual({ name: 'countries', kind });
      const home = parentVodLevel(countries!);
      expect(home).toEqual({ name: 'home' });
      expect(parentVodLevel(home!)).toBeNull();
    });
    it(`${kind}: titler bevarer deres land paa vejen tilbage`, () => {
      const country = { key: 'DK', name: 'Danmark', flag: '🇩🇰', categoryCount: 1, channelCount: 4 };
      const categories = parentVodLevel({ name: 'items', kind, country, category: { id: 'test', name: 'Test', kind, itemCount: 4, countryKey: 'DK', country: null } });
      expect(categories).toEqual({ name: 'categories', kind, country });
      expect(parentVodLevel(categories!)).toEqual({ name: 'countries', kind });
    });
  }
  it('biografens foraelder er katalogets forside', () => {
    expect(parentVodLevel({ name: 'cinema' })).toEqual({ name: 'home' });
  });
});
