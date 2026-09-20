import { describe, expect, it } from 'vitest';
import { parseNewsHeadlines } from './news.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>DR Nyheder</title>
  <item><title>Regeringen fremlægger nyt udspil</title><link>a</link></item>
  <item><title><![CDATA[Politiet advarer om svindel & bedrag]]></title></item>
  <item><title>FCK vinder 2-1 over Brøndby</title></item>
</channel></rss>`;

describe('parseNewsHeadlines', () => {
  it('tager titlen i hvert item og springer kanaltitlen over', () => {
    expect(parseNewsHeadlines(RSS)).toEqual([
      'Regeringen fremlægger nyt udspil',
      'Politiet advarer om svindel & bedrag',
      'FCK vinder 2-1 over Brøndby',
    ]);
  });

  it('afkoder entiteter og pakker CDATA ud', () => {
    const xml = '<rss><item><title>Torden &amp; hagl over &lt;Jylland&gt;</title></item></rss>';
    expect(parseNewsHeadlines(xml)).toEqual(['Torden & hagl over <Jylland>']);
  });

  it('laeser ogsaa Atom-stroemme (entry/title)', () => {
    const atom = '<feed><title>Kanal</title><entry><title>En overskrift</title></entry></feed>';
    expect(parseNewsHeadlines(atom)).toEqual(['En overskrift']);
  });

  it('luger tomme og ens overskrifter fra', () => {
    const xml =
      '<rss><item><title>Samme</title></item><item><title>   </title></item><item><title>Samme</title></item></rss>';
    expect(parseNewsHeadlines(xml)).toEqual(['Samme']);
  });

  it('giver en tom liste ved tom eller ugyldig stroem', () => {
    expect(parseNewsHeadlines('')).toEqual([]);
    expect(parseNewsHeadlines('<html><body>ingen items</body></html>')).toEqual([]);
    // @ts-expect-error bevidst forkert type
    expect(parseNewsHeadlines(null)).toEqual([]);
  });

  it('skaerer listen til et rimeligt antal', () => {
    const items = Array.from({ length: 30 }, (_, i) => `<item><title>Nr ${i}</title></item>`).join('');
    expect(parseNewsHeadlines(`<rss>${items}</rss>`)).toHaveLength(15);
  });
});
