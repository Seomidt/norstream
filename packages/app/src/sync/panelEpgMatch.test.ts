import { describe, expect, it } from 'vitest';
import { feedCountry, matchPanelEpg } from './panelEpgMatch.js';

describe('feedCountry', () => {
  it('laeser landet af id-endelsen', () => {
    expect(feedCountry({ id: 'BBCOne.uk', n: ['BBC One'] })).toBe('GB');
    expect(feedCountry({ id: 'CNN.us', n: ['CNN'] })).toBe('US');
    expect(feedCountry({ id: 'DR1.dk', n: ['DR1'] })).toBe('DK');
  });

  it('falder tilbage til et landepraefiks i navnet', () => {
    expect(feedCountry({ id: 'bbc-one', n: ['UK: BBC One'] })).toBe('GB');
  });

  it('siger intet naar det ikke kan afgoeres', () => {
    expect(feedCountry({ id: 'abc', n: ['Some Channel'] })).toBe('');
  });
});

describe('matchPanelEpg', () => {
  it('matcher en britisk panelkanal paa navn og land', () => {
    const result = matchPanelEpg(
      [{ key: 'p:1', name: 'UK| BBC ONE HD', country: 'GB' }],
      [
        { id: 'BBCOne.de', n: ['BBC One'] },
        { id: 'BBCOne.uk', n: ['BBC One'] },
      ],
    );
    // Den britiske, ikke den tyske med samme navn.
    expect([...result.entries()]).toEqual([['BBCOne.uk', ['p:1']]]);
  });

  it('giver flere kvalitets-varianter samme kanal i filen', () => {
    const result = matchPanelEpg(
      [
        { key: 'p:1', name: 'US| CNN HD', country: 'US' },
        { key: 'p:2', name: 'US| CNN FHD', country: 'US' },
      ],
      [{ id: 'CNN.us', n: ['CNN'] }],
    );
    expect(result.get('CNN.us')).toEqual(['p:1', 'p:2']);
  });

  it('gaetter ikke paa tvaers af lande', () => {
    // Appens kanal er dansk; filen har kun en svensk med samme navn.
    const result = matchPanelEpg([{ key: 'p:1', name: 'DNK| KANAL 5', country: 'DK' }], [{ id: 'Kanal5.se', n: ['Kanal 5'] }]);
    expect(result.size).toBe(0);
  });

  it('springer generiske navne over (mange i samme land)', () => {
    const feed = ['a', 'b', 'c', 'd'].map((suffix) => ({ id: `Sport${suffix}.uk`, n: ['Sport'] }));
    const result = matchPanelEpg([{ key: 'p:1', name: 'UK| SPORT', country: 'GB' }], feed);
    expect(result.size).toBe(0);
  });

  it('uden land hos appens kanal: kun et entydigt navn', () => {
    const one = matchPanelEpg([{ key: 'p:1', name: 'Unique Channel', country: '' }], [{ id: 'unique', n: ['Unique Channel'] }]);
    expect(one.get('unique')).toEqual(['p:1']);
    const two = matchPanelEpg(
      [{ key: 'p:1', name: 'News', country: '' }],
      [
        { id: 'News.uk', n: ['News'] },
        { id: 'News.us', n: ['News'] },
      ],
    );
    expect(two.size).toBe(0);
  });

  it('bruger id uden endelse som navn', () => {
    // Ingen display-name i filen: id'et uden ".uk" er nok, for det rensede navn
    // ser bort fra mellemrum ("SkyNews" = "SKY NEWS").
    const result = matchPanelEpg([{ key: 'p:1', name: 'UK| SKY NEWS', country: 'GB' }], [{ id: 'SkyNews.uk', n: [] }]);
    expect(result.get('SkyNews.uk')).toEqual(['p:1']);
  });
});
