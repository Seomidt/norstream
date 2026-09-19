import { describe, expect, it } from 'vitest';
import { createXmltvParser } from './parser.js';
import type { XmltvChannel } from './parser.js';
import type { Programme } from '../models.js';

const XML = `<?xml version="1.0"?>
<tv>
  <channel id="dr1.dk"><display-name>DR1</display-name></channel>
  <programme start="20260904200000 +0000" stop="20260904210000 +0000" channel="dr1.dk">
    <title>TV Avisen</title>
    <desc>Nyheder &amp; vejr</desc>
  </programme>
  <programme start="20260904210000 +0000" stop="20260904220000 +0000" channel="dr1.dk">
    <title>Sporten</title>
  </programme>
</tv>`;

function collect(chunks: string[]): Programme[] {
  const out: Programme[] = [];
  const parser = createXmltvParser((p) => out.push(p));
  for (const chunk of chunks) parser.write(chunk);
  parser.end();
  return out;
}

describe('createXmltvParser', () => {
  it('udtrækker programmer fra ét samlet dokument', () => {
    const result = collect([XML]);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      channelId: 'dr1.dk',
      title: 'TV Avisen',
      description: 'Nyheder & vejr',
    });
    expect(result[0]?.start.toISOString()).toBe('2026-09-04T20:00:00.000Z');
    expect(result[0]?.stop.toISOString()).toBe('2026-09-04T21:00:00.000Z');
  });

  it('sætter description til null når desc mangler', () => {
    expect(collect([XML])[1]?.description).toBeNull();
  });

  it('giver samme resultat når dokumentet deles midt i et element', () => {
    const cut = Math.floor(XML.length / 2);
    const split = collect([XML.slice(0, cut), XML.slice(cut)]);
    expect(split).toHaveLength(2);
    expect(split.map((p) => p.title)).toEqual(['TV Avisen', 'Sporten']);
  });

  it('giver samme resultat ved tegn-for-tegn-fodring', () => {
    const perChar = collect([...XML]);
    expect(perChar.map((p) => p.title)).toEqual(['TV Avisen', 'Sporten']);
  });

  it('springer programmer med ugyldigt tidsstempel over', () => {
    const bad = `<tv><programme start="vrøvl" stop="20260904210000" channel="a">
      <title>Ugyldig</title></programme></tv>`;
    expect(collect([bad])).toHaveLength(0);
  });

  it('springer programmer uden kanal-id over', () => {
    const bad = `<tv><programme start="20260904200000" stop="20260904210000">
      <title>Ingen kanal</title></programme></tv>`;
    expect(collect([bad])).toHaveLength(0);
  });

  it('springer programmer uden titel over', () => {
    const bad = `<tv><programme start="20260904200000" stop="20260904210000"
      channel="a"></programme></tv>`;
    expect(collect([bad])).toHaveLength(0);
  });

  it('holder bufferen afgrænset ved malformet input uden lukketag', () => {
    const parser = createXmltvParser(() => {});
    // 8 MB uden et eneste komplet element må ikke akkumuleres.
    for (let i = 0; i < 800; i++) parser.write('<programme '.repeat(1000));
    expect(parser.bufferLength()).toBeLessThanOrEqual(4_194_304);
  });

  it('holder bufferen afgrænset når det seneste elementstart selv ligger langt fra bufferens slutning', () => {
    const parser = createXmltvParser(() => {});
    // Ét kæmpe write-kald: et tidligt <programme uden lukketag, efterfulgt
    // af endnu et <programme uden lukketag langt inde i en stor tekstblok.
    // En enkelt trimning til det seneste elementstart er ikke nok her, fordi
    // den efterlader ~9 MB — grænsen skal genanvendes på den trimmede buffer.
    const chunk =
      '<programme start="a">' +
      'x'.repeat(6_000_000) +
      '<programme start="b">' +
      'x'.repeat(3_000_000);
    parser.write(chunk);
    expect(parser.bufferLength()).toBeLessThanOrEqual(4_194_304);
  });

  it('anker attributnavnet, så "pdc-start" ikke matches som "start"', () => {
    const xml =
      '<tv><programme pdc-start="19990101000000" start="20260904200000" ' +
      'stop="20260904210000" channel="dr1.dk"><title>Test</title></programme></tv>';
    const result = collect([xml]);
    expect(result).toHaveLength(1);
    expect(result[0]?.start.toISOString()).toBe('2026-09-04T20:00:00.000Z');
  });

  it('anker attributnavnet, så "vps-start" ikke matches som "start"', () => {
    const xml =
      '<tv><programme vps-start="19990101000000" start="20260904200000" ' +
      'stop="20260904210000" channel="dr1.dk"><title>Test</title></programme></tv>';
    const result = collect([xml]);
    expect(result).toHaveLength(1);
    expect(result[0]?.start.toISOString()).toBe('2026-09-04T20:00:00.000Z');
  });

  it('afkoder XML-entiteter i attributværdier, fx channel="a&amp;b"', () => {
    const xml =
      '<tv><programme start="20260904200000" stop="20260904210000" ' +
      'channel="a&amp;b"><title>Test</title></programme></tv>';
    const result = collect([xml]);
    expect(result).toHaveLength(1);
    expect(result[0]?.channelId).toBe('a&b');
  });
});

describe('kanaler med logo', () => {
  // Det er her logoet staar i standarden. En udbyder der leverer en
  // XMLTV-fil, leverer altsaa tit ogsaa logoerne — og de havde ingen anden
  // vej ind i appen.
  it('laeser id, logo og navne ud af et channel-element', () => {
    const channels: XmltvChannel[] = [];
    const parser = createXmltvParser(
      () => undefined,
      (channel) => channels.push(channel),
    );
    parser.write(
      '<tv><channel id="DR1.dk"><display-name>DR1</display-name><display-name>DR 1</display-name>' +
        '<icon src="https://logo/dr1.png" width="200"/></channel>' +
        '<channel id="TV2.dk"><display-name>TV 2</display-name></channel>' +
        '<programme start="20260907190000 +0200" stop="20260907200000 +0200" channel="DR1.dk">' +
        '<title>Nyheder</title></programme></tv>',
    );
    parser.end();
    expect(channels).toEqual([
      { id: 'DR1.dk', iconUrl: 'https://logo/dr1.png', displayNames: ['DR1', 'DR 1'] },
      { id: 'TV2.dk', iconUrl: null, displayNames: ['TV 2'] },
    ]);
  });

  it('forveksler ikke programmets channel-attribut med et channel-element', () => {
    const channels: XmltvChannel[] = [];
    const programmes: string[] = [];
    const parser = createXmltvParser(
      (programme) => programmes.push(programme.title),
      (channel) => channels.push(channel),
    );
    parser.write(
      '<programme start="20260907190000 +0200" stop="20260907200000 +0200" channel="DR1.dk">' +
        '<title>Nyheder</title></programme>',
    );
    parser.end();
    expect(channels).toEqual([]);
    expect(programmes).toEqual(['Nyheder']);
  });

  it('laeser kanaler delt over to bidder', () => {
    const channels: XmltvChannel[] = [];
    const parser = createXmltvParser(() => undefined, (channel) => channels.push(channel));
    parser.write('<channel id="DR1.dk"><icon src="htt');
    parser.write('ps://logo/dr1.png"/></channel>');
    parser.end();
    expect(channels[0]?.iconUrl).toBe('https://logo/dr1.png');
  });

  it('kraever ikke at nogen lytter efter kanaler', () => {
    const titles: string[] = [];
    const parser = createXmltvParser((programme) => titles.push(programme.title));
    parser.write(
      '<channel id="DR1.dk"><icon src="x"/></channel>' +
        '<programme start="20260907190000 +0200" stop="20260907200000 +0200" channel="DR1.dk">' +
        '<title>Nyheder</title></programme>',
    );
    parser.end();
    expect(titles).toEqual(['Nyheder']);
  });
});
