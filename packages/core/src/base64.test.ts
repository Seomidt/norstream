import { describe, expect, it } from 'vitest';
import { decodeBase64Utf8 } from './base64.js';

describe('decodeBase64Utf8', () => {
  it('afkoder ren ASCII', () => {
    expect(decodeBase64Utf8('SGVqIHZlcmRlbg==')).toBe('Hej verden');
  });

  it('afkoder danske tegn korrekt', () => {
    // Den egentlige grund til at vi ikke bruger atob: den ville give latin1.
    expect(decodeBase64Utf8('w6bDuMOl')).toBe('æøå');
  });

  it('afkoder en realistisk programtitel med tankestreg og ampersand', () => {
    expect(decodeBase64Utf8('VFYgQXZpc2VuIHDDpSBEUjEg4oCUIG55aGVkZXIgJiBzcG9ydA==')).toBe(
      'TV Avisen på DR1 — nyheder & sport',
    );
  });

  it('afkoder tegn uden for BMP som surrogatpar', () => {
    expect(decodeBase64Utf8('8J+Tug==')).toBe('📺');
  });

  it('afkoder en tom streng til en tom streng, ikke til null', () => {
    expect(decodeBase64Utf8('')).toBe('');
  });

  it('ignorerer whitespace, som paneler ofte indsætter i lange felter', () => {
    expect(decodeBase64Utf8('SGVq\nIHZl \tcmRl\r\nbg==')).toBe('Hej verden');
  });

  it('accepterer manglende padding', () => {
    expect(decodeBase64Utf8('SGVqIHZlcmRlbg')).toBe('Hej verden');
  });

  it('accepterer URL-varianten af alfabetet', () => {
    expect(decodeBase64Utf8('8J-OrCDDmA==')).toBe('🎬 Ø');
    expect(decodeBase64Utf8('ICA_')).toBe('  ?');
  });

  it('afviser tegn uden for alfabetet', () => {
    expect(decodeBase64Utf8('SGVq!IHZlcmRlbg==')).toBeNull();
  });

  it('afviser et enkelt tilbagevaerende base64-ciffer', () => {
    // 5 cifre koder 30 bit: tre hele bytes og et ciffer der ikke kan bruges.
    expect(decodeBase64Utf8('SGVqI')).toBeNull();
  });

  it('afviser data efter padding', () => {
    expect(decodeBase64Utf8('SGVq=IHZlcmRlbg==')).toBeNull();
  });

  it('afviser en afkortet multibyte-sekvens', () => {
    // 0xC3 alene: foerste byte i et to-byte tegn, uden sin fortsaettelse.
    expect(decodeBase64Utf8('ww==')).toBeNull();
  });

  it('afviser overlange sekvenser', () => {
    // 0xC0 0x80 koder U+0000 paa to bytes. Gyldig bit-manipulation,
    // ugyldig UTF-8 — og en klassisk vej uden om filtre.
    expect(decodeBase64Utf8('wIA=')).toBeNull();
    // 0xE0 0x80 0x80 er den samme fejl paa tre bytes.
    expect(decodeBase64Utf8('4ICA')).toBeNull();
  });

  it('afviser loese surrogater', () => {
    // 0xED 0xA0 0x80 er U+D800, som kun maa optraede som halvdel af et par.
    expect(decodeBase64Utf8('7aCA')).toBeNull();
  });

  it('kaster aldrig, uanset hvor beskadiget inputtet er', () => {
    for (const input of ['=', '==', '=A', ' ', 'A', '////', '@@@@', 'ÿþ']) {
      expect(() => decodeBase64Utf8(input)).not.toThrow();
    }
  });
});
