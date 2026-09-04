import { describe, expect, it } from 'vitest';
import { decodeXmlEntities } from './entities.js';

describe('decodeXmlEntities', () => {
  it('afkoder de fem navngivne entiteter', () => {
    expect(decodeXmlEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe(
      'a & b <c> "d" \'e\'',
    );
  });

  it('afkoder decimale talreferencer', () => {
    expect(decodeXmlEntities('Bl&#229;vand')).toBe('Blåvand');
  });

  it('afkoder hexadecimale talreferencer', () => {
    expect(decodeXmlEntities('Bl&#xE5;vand')).toBe('Blåvand');
  });

  it('lader ukendte entiteter stå urørt', () => {
    expect(decodeXmlEntities('100&nbsp;kr')).toBe('100&nbsp;kr');
  });

  it('afkoder &amp; sidst, så &amp;lt; bliver til &lt;', () => {
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;');
  });

  it('lader decimale talreferencer uden for Unicode-området stå urørt', () => {
    expect(decodeXmlEntities('&#99999999;')).toBe('&#99999999;');
  });

  it('lader hexadecimale talreferencer uden for Unicode-området stå urørt', () => {
    expect(decodeXmlEntities('&#xFFFFFF0;')).toBe('&#xFFFFFF0;');
  });

  it('afkoder grænsepunktet 0x10FFFF korrekt', () => {
    expect(decodeXmlEntities('&#x10FFFF;')).toBe(String.fromCodePoint(0x10ffff));
  });
});
