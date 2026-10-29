import { describe, expect, it } from 'vitest';
import { IcyScanner, coverFromItunes, extractStreamTitle, parseNowPlaying } from './icy.js';

describe('parseNowPlaying', () => {
  it('tager kunstner - titel', () => {
    expect(parseNowPlaying('Medina - Kun for mig', 'The Voice')).toEqual({ artist: 'Medina', track: 'Kun for mig' });
    expect(parseNowPlaying(' / Dua Lipa – Houdini ', 'Nova')).toEqual({ artist: 'Dua Lipa', track: 'Houdini' });
  });
  it('afviser det der ikke er en sang', () => {
    expect(parseNowPlaying('', 'x')).toBeNull();
    expect(parseNowPlaying('Nyheder og vejr - www.dr.dk', 'DR P4')).toBeNull();
    expect(parseNowPlaying('The Voice - The Voice', 'The Voice')).toBeNull();
    expect(parseNowPlaying('PartyFM - Danmarks festradio', 'PartyFM')).toBeNull();
    expect(parseNowPlaying('Programbeskrivelse uden bindestreg', 'x')).toBeNull();
  });
});

describe('extractStreamTitle', () => {
  it('laeser titlen ud af blokken', () => {
    expect(extractStreamTitle("StreamTitle='Medina - Kun for mig';StreamUrl='';")).toBe('Medina - Kun for mig');
    expect(extractStreamTitle("StreamTitle='';")).toBe('');
    expect(extractStreamTitle('StreamUrl=;')).toBeNull();
  });
});

describe('IcyScanner', () => {
  const encode = (text: string): number[] => [...text].map((c) => c.charCodeAt(0));
  it('springer lyden over og laeser blokken, ogsaa delt over flere stykker', () => {
    const metaint = 32;
    const meta = "StreamTitle='A - B';";
    const padded = meta + '\0'.repeat(32 - meta.length);
    const stream = [...new Array<number>(metaint).fill(1), 2, ...encode(padded), ...new Array<number>(10).fill(1)];
    const scanner = new IcyScanner(metaint);
    const first = scanner.push(Uint8Array.from(stream.slice(0, 40)));
    expect(first).toBeNull();
    const second = scanner.push(Uint8Array.from(stream.slice(40)));
    expect(second).toBe(meta);
  });
  it('springer tomme blokke over', () => {
    const metaint = 8;
    const meta = "StreamTitle='X - Y';";
    const stream = [...new Array<number>(8).fill(1), 0, ...new Array<number>(8).fill(1), 2, ...encode(meta + '\0'.repeat(32 - meta.length))];
    const scanner = new IcyScanner(metaint);
    expect(scanner.push(Uint8Array.from(stream))).toBe("StreamTitle='X - Y';");
  });
});

describe('coverFromItunes', () => {
  it('giver 600 px-coveret', () => {
    expect(coverFromItunes(JSON.stringify({ results: [{ artworkUrl100: 'https://x/100x100bb.jpg' }] }))).toBe('https://x/600x600bb.jpg');
    expect(coverFromItunes('{"results":[]}')).toBeNull();
    expect(coverFromItunes('nope')).toBeNull();
  });
});
