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
});
