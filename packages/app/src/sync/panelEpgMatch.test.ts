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
  it.each(['Action', 'Hits', 'Family', 'Premiere'])(
    'matcher V Film %s og Viasat Film i begge retninger med korrekt land', (variant) => {
      for (const [panelName, feedName] of [
        [`V Film ${variant}`, `Viasat Film ${variant}`],
        [`Viasat Film ${variant}`, `V Film ${variant}`],
      ]) {
        const result = matchPanelEpg(
          [{ key: 'p:film', name: `DNK| ${panelName} FHD MULTI`, country: 'DK' }],
          [{ id: 'film.se', n: [feedName] }, { id: 'film.dk', n: [feedName] }],
        );
        expect([...result.entries()]).toEqual([['film.dk', ['p:film']]]);
      }
    },
  );

  it('tager ikke svenske programmer paa en dansk V Film via det gamle navn', () => {
    expect(matchPanelEpg(
      [{ key: 'p:film', name: 'DNK| V Film Hits HD', country: 'DK' }],
      [{ id: 'film.se', n: ['Viasat Film Hits'] }],
    ).size).toBe(0);
  });

  it('taeller ikke samme feed flere gange naar begge navne staar i filen', () => {
    const result = matchPanelEpg(
      [{ key: 'p:film', name: 'V Film Hits', country: '' }],
      [{ id: 'VFilmHits', n: ['V Film Hits', 'Viasat Film Hits'] }],
    );
    expect([...result.entries()]).toEqual([['VFilmHits', ['p:film']]]);
  });

  it('bevarer direkte EPG-id ogsaa naar et andet feed matcher det nye navn', () => {
    const result = matchPanelEpg(
      [{ key: 'p:series', name: 'DNK| V Series', country: 'DK', epgId: 'exact.dk' }],
      [{ id: 'new.dk', n: ['V Series'] }, { id: 'exact.dk', n: ['Viasat Series'] }],
    );
    expect([...result.entries()]).toEqual([['exact.dk', ['p:series']]]);
  });

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

  it('matcher direkte paa panelets EPG-id foer navnet', () => {
    const result = matchPanelEpg(
      [{ key: 'p:1', name: 'Helt andet navn', country: 'GB', epgId: 'bbcone.UK' }],
      [{ id: 'BBCOne.uk', n: ['BBC One'] }],
    );
    expect(result.get('BBCOne.uk')).toEqual(['p:1']);
  });

  it('bruger id uden endelse som navn', () => {
    // Ingen display-name i filen: id'et uden ".uk" er nok, for det rensede navn
    // ser bort fra mellemrum ("SkyNews" = "SKY NEWS").
    const result = matchPanelEpg([{ key: 'p:1', name: 'UK| SKY NEWS', country: 'GB' }], [{ id: 'SkyNews.uk', n: [] }]);
    expect(result.get('SkyNews.uk')).toEqual(['p:1']);
  });
});
