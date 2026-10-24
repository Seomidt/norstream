import { deriveCountry, deriveCountryLoose } from '@norstream/core';
import type { Country } from '@norstream/core';

/** Kategorier kan hedde MOVIES | UK eller vaere en faelles US/UK-gruppe.
 * Titler bruges aldrig til at gaette land; ENGLISH alene angiver et sprog. */
export function vodCountries(name: string): Country[] {
  const strict = deriveCountry(name);
  if (strict !== null && strict.code !== 'US' && strict.code !== 'GB') return [strict];
  const countries = new Map<string, Country>();
  const known = deriveCountryLoose(name);
  if (known !== null) countries.set(known.code, known);
  for (const segment of name.split(/[|:/()[\]_-]+/)) {
    const clean = segment.trim().replace(/^(?:(?:VOD|MOVIES?|FILMS?|SERIES|TV|VIP|FHD|UHD|HD|4K)\s+)+/i, '');
    const country = deriveCountry(clean);
    if (country?.code === 'US' || country?.code === 'GB') countries.set(country.code, country);
  }
  return [...countries.values()];
}
