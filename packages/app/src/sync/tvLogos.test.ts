import { describe, expect, it } from 'vitest';
import { parseTvLogoPaths } from './tvLogos.js';

describe('parseTvLogoPaths', () => {
  it('laeser land og navn ud af filnavnet', () => {
    const [entry] = parseTvLogoPaths(['nordic/denmark/tv2-echo-dk']);
    expect(entry).toEqual({
      key: 'TV2ECHO',
      country: 'DK',
      url: 'https://raw.githubusercontent.com/tv-logo/tv-logos/main/countries/nordic/denmark/tv2-echo-dk.png',
    });
  });

  // Bindestregerne er ordmellemrum i et filnavn. Blev de laest som en del af
  // navnet, ville `canal-9-dk` aldrig moede panelets `CANAL 9 HD`.
  it('regner bindestreger som mellemrum', () => {
    expect(parseTvLogoPaths(['nordic/denmark/canal-9-dk'])[0]?.key).toBe('CANAL9');
  });

  it('giver de internationale stjerne-landet', () => {
    // `int` hoerer ikke til ét land, og det er praecis den noegle appen slaar
    // op paa naar den ikke kan udlede et land af kategorien.
    expect(parseTvLogoPaths(['international/cnn-int'])[0]?.country).toBe('*');
  });

  it('moeder registrets skrivemaade for plus', () => {
    // Arkivet skriver `tv3-plus`, iptv-org skriver `TV3+`. Begge skal ende
    // paa samme noegle, ellers faar den ene kilde aldrig lov at hjaelpe.
    expect(parseTvLogoPaths(['nordic/denmark/tv3-plus-dk'])[0]?.key).toBe('TV3PLUS');
  });

  it('springer filnavne uden landeendelse over', () => {
    expect(parseTvLogoPaths(['nordic/denmark/0_all_logos_mosaic'])).toEqual([]);
  });
});
