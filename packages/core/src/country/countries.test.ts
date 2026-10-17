import { describe, expect, it } from 'vitest';
import { countryFlag, deriveCountry, deriveCountryLoose } from './countries.js';

describe('countryFlag', () => {
  it('saetter flaget sammen af regional indicator-symboler', () => {
    expect(countryFlag('DK')).toBe('🇩🇰');
    expect(countryFlag('SE')).toBe('🇸🇪');
    expect(countryFlag('GB')).toBe('🇬🇧');
  });

  it('accepterer smaa bogstaver og mellemrum', () => {
    expect(countryFlag(' dk ')).toBe('🇩🇰');
  });

  it('giver en tom streng for noget der ikke er en landekode', () => {
    for (const value of ['', 'D', 'DKK', '12', 'Æ!']) {
      expect(countryFlag(value)).toBe('');
    }
  });
});

describe('deriveCountry', () => {
  it('genkender de kategorinavne der faktisk staar paa panelet', () => {
    expect(deriveCountry('DENMARK HD & HEVC')).toEqual({
      code: 'DK',
      name: 'Danmark',
      flag: '🇩🇰',
    });
    expect(deriveCountry('DENMARK SPORT HD')?.code).toBe('DK');
    expect(deriveCountry('DENMARK TV2 PLAY PPV')?.code).toBe('DK');
    expect(deriveCountry('SWEDEN SPORT')?.code).toBe('SE');
  });

  it('genkender kanalnavnenes trebogstavspraefiks', () => {
    expect(deriveCountry('DNK| DR1 HD')?.code).toBe('DK');
    expect(deriveCountry('SWE| SVT1')?.code).toBe('SE');
  });

  it('lader det laengste udtryk vinde', () => {
    // UNITED alene er ikke et land; UNITED KINGDOM og UNITED STATES er.
    expect(deriveCountry('UNITED KINGDOM SPORT')?.code).toBe('GB');
    expect(deriveCountry('UNITED STATES NEWS')?.code).toBe('US');
    expect(deriveCountry('UNITED ARAB EMIRATES')?.code).toBe('AE');
    expect(deriveCountry('UNITED SOMETHING')).toBeNull();
  });

  it('genkender flerordede lande', () => {
    expect(deriveCountry('SOUTH AFRICA SPORT')?.code).toBe('ZA');
    expect(deriveCountry('NEW ZEALAND HD')?.code).toBe('NZ');
    expect(deriveCountry('CZECH REPUBLIC')?.code).toBe('CZ');
    expect(deriveCountry('SAUDI ARABIA')?.code).toBe('SA');
  });

  it('springer eet indledende markoer-ord over', () => {
    expect(deriveCountry('VIP DENMARK SPORT')?.code).toBe('DK');
    expect(deriveCountry('HD SWEDEN')?.code).toBe('SE');
  });

  it('springer ikke to markoer-ord over', () => {
    // Graensen er sat med vilje: mere gaetteri koster forkert gruppering.
    expect(deriveCountry('VIP HD DENMARK')).toBeNull();
  });

  it('samler det uigenkendelige under null, saa kalderen viser Øvrige', () => {
    expect(deriveCountry('4K UHD 3840P')).toBeNull();
    expect(deriveCountry('4K RELAX 1920P')).toBeNull();
    expect(deriveCountry('SPORT PPV')).toBeNull();
    expect(deriveCountry('')).toBeNull();
    expect(deriveCountry('   ')).toBeNull();
    expect(deriveCountry('||| ###')).toBeNull();
  });

  it('matcher kun i begyndelsen, ikke midt i navnet', () => {
    // Ellers ville 'SPORT FROM DENMARK AND SWEDEN' gruppere vilkaarligt.
    expect(deriveCountry('SPORT FROM DENMARK')).toBeNull();
  });

  it('er ufoelsom over for store og smaa bogstaver og skilletegn', () => {
    expect(deriveCountry('denmark hd')?.code).toBe('DK');
    expect(deriveCountry('DENMARK|HD')?.code).toBe('DK');
    expect(deriveCountry('  DENMARK  ')?.code).toBe('DK');
  });

  it('giver dansk navn og et flag for hvert land det genkender', () => {
    const country = deriveCountry('GERMANY SPORT');
    expect(country).toEqual({ code: 'DE', name: 'Tyskland', flag: '🇩🇪' });
  });

  it('panelernes IS| er Israel, mens hele ordet Island er Island', () => {
    expect(deriveCountry('IS| CELLCOM TV BOXES')?.code).toBe('IL');
    expect(deriveCountry('IS| ISRAEL HD')?.code).toBe('IL');
    expect(deriveCountry('IS| HEBREW SDAROT 24/7')?.code).toBe('IL');
    expect(deriveCountry('ICELAND SPORT HD')?.code).toBe('IS');
    expect(deriveCountry('ISLAND HD')?.code).toBe('IS');
  });
});

describe('deriveCountryLoose', () => {
  it('finder landet naar det staar bagerst i navnet', () => {
    expect(deriveCountryLoose('SPORT | DENMARK')?.code).toBe('DK');
    expect(deriveCountryLoose('KIDS SWEDEN HD')?.code).toBe('SE');
  });

  it('finder trebogstavskoder midt i navnet', () => {
    expect(deriveCountryLoose('VIP DNK NEWS')?.code).toBe('DK');
    expect(deriveCountryLoose('SPORT NOR 4K')?.code).toBe('NO');
  });

  it('lader praefikset vinde over et land laengere inde', () => {
    // Ellers ville en blandingskategori skifte flag efter hvad der tilfaeldigvis
    // stod til sidst.
    expect(deriveCountryLoose('DENMARK SWEDEN MIX')?.code).toBe('DK');
  });

  it('tager ikke tobogstavskoder midt i navnet', () => {
    // "IT" og "IN" er for almindelige som ordstumper til at kunne bruges som
    // andet end praefiks — et tilfaeldigt sammenfald ville give et forkert flag.
    expect(deriveCountryLoose('SPORT IT NEWS')).toBeNull();
    expect(deriveCountryLoose('LIVE IN HD')).toBeNull();
  });

  it('opfoerer sig som deriveCountry naar landet staar forrest', () => {
    for (const name of ['DENMARK HD & HEVC', 'VIP SWEDEN', '4K UHD 3840P', '']) {
      expect(deriveCountryLoose(name)?.code ?? null).toBe(deriveCountry(name)?.code ?? null);
    }
  });

  it('giver stadig null for kategorier uden land', () => {
    expect(deriveCountryLoose('RELAX 1920P')).toBeNull();
    expect(deriveCountryLoose('4K UHD 3840P')).toBeNull();
  });
});
