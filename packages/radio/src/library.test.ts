import { describe, expect, it } from 'vitest';
import { withAllCountries } from './countries.js';

const station = (id: string) => ({ id, name: id, url: `http://x/${id}`, logoUrl: null, logoUrls: [], country: 'DK' });

describe('withAllCountries', () => {
  it('beholder de hentede stationer og tilfoejer de andre lande tomme, Norden foerst', () => {
    const cached = [{ code: 'DE', name: 'Tyskland', flag: '🇩🇪', stations: [station('a'), station('b')] }];
    const known = [
      { code: 'US', name: 'USA', flag: '🇺🇸', stations: 400 },
      { code: 'DE', name: 'Tyskland', flag: '🇩🇪', stations: 300 },
      { code: 'DK', name: 'Danmark', flag: '🇩🇰', stations: 232 },
    ];
    const result = withAllCountries(cached, known);
    expect(result.map((c) => c.code)).toEqual(['DK', 'US', 'DE']);
    expect(result.find((c) => c.code === 'DE')?.stations).toHaveLength(2);
    expect(result.find((c) => c.code === 'DK')?.stations).toEqual([]);
  });

  it('uden kendte lande er det kun de hentede', () => {
    const cached = [{ code: 'SE', name: 'Sverige', flag: '🇸🇪', stations: [station('s')] }];
    expect(withAllCountries(cached, []).map((c) => c.code)).toEqual(['SE']);
  });
});
