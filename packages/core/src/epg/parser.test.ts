import { describe, expect, it } from 'vitest';
import { createXmltvParser } from './parser.js';
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
    // 2 MB uden et eneste komplet element må ikke akkumuleres.
    for (let i = 0; i < 200; i++) parser.write('<programme '.repeat(1000));
    expect(parser.bufferLength()).toBeLessThanOrEqual(1_048_576);
  });
});
