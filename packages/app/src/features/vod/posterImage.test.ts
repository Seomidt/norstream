import { expect, it } from 'vitest';
import { posterImageUri } from './posterImage.js';
it('originale TMDB-billeder hentes i kortstoerrelse med samme billedidentitet', () => {
  expect(posterImageUri('https://image.tmdb.org/t/p/original/bond.jpg')).toBe('https://image.tmdb.org/t/p/w342/bond.jpg');
  expect(posterImageUri('https://image.tmdb.org/t/p/w780/bond.jpg')).toBe('https://image.tmdb.org/t/p/w342/bond.jpg');
  expect(posterImageUri('https://provider.invalid/original/bond.jpg?token=test')).toBe('https://provider.invalid/original/bond.jpg?token=test');
});
