import { describe, expect, it } from 'vitest';
import { parseCsv, parseCsvRecords } from './csv.js';

describe('parseCsv', () => {
  it('laeser almindelige raekker', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('holder kommaer inde i citater samlet', () => {
    // Det er den fejl der ellers forskyder hver eneste kolonne efter feltet.
    expect(parseCsv('id,alt\nDR1.dk,"DR1, DR Et"\n')).toEqual([
      ['id', 'alt'],
      ['DR1.dk', 'DR1, DR Et'],
    ]);
  });

  it('forstaar dobbelte citater som ét', () => {
    expect(parseCsv('a\n"6""eren"\n')).toEqual([['a'], ['6"eren']]);
  });

  it('taaler linjeskift inde i et felt', () => {
    expect(parseCsv('a,b\n"to\nlinjer",x\n')).toEqual([
      ['a', 'b'],
      ['to\nlinjer', 'x'],
    ]);
  });

  it('taaler CRLF og en manglende sidste linjeskift', () => {
    expect(parseCsv('a,b\r\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('springer tomme linjer over', () => {
    expect(parseCsv('a\n\n1\n')).toEqual([['a'], ['1']]);
  });
});

describe('parseCsvRecords', () => {
  it('slaar op paa kolonnenavn', () => {
    const records = parseCsvRecords('channel,url\nDR1.dk,http://x/1.png\n');
    expect(records).toEqual([{ channel: 'DR1.dk', url: 'http://x/1.png' }]);
  });

  it('springer forskudte raekker over', () => {
    // En raekke med for faa felter ville ellers give kolonner der er rykket
    // én til venstre — og et logo-felt der i virkeligheden er et landenavn.
    const records = parseCsvRecords('a,b,c\n1,2\n3,4,5\n');
    expect(records).toEqual([{ a: '3', b: '4', c: '5' }]);
  });

  it('giver ingenting for tom tekst', () => {
    expect(parseCsvRecords('')).toEqual([]);
  });
});
