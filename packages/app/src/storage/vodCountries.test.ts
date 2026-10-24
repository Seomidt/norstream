import { expect, it } from 'vitest';
import { vodCountries } from './vodCountries.js';
it('finder US og UK efter katalogpraefiks og skilletegn', () => {
  for (const name of ['MOVIES | US', 'VOD US ACTION', 'FILMS - USA']) expect(vodCountries(name).map(c => c.code)).toEqual(['US']);
  for (const name of ['SERIES | UK', 'MOVIES UK ACTION', 'TV - GB']) expect(vodCountries(name).map(c => c.code)).toEqual(['GB']);
});
it('bevarer begge lande i en faelles USA/UK-kategori', () => {
  expect(vodCountries('MOVIES | US/UK').map(c => c.code)).toEqual(['US', 'GB']);
});
it('gaetter ikke sprog eller en filmtitel til et produktionsland', () => {
  expect(vodCountries('ENGLISH MOVIES')).toEqual([]);
  expect(vodCountries('THE LAST OF US')).toEqual([]);
  expect(vodCountries('DK | US COLLECTION').map(c => c.code)).toEqual(['DK']);
});
