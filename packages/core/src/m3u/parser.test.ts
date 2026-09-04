import { describe, expect, it } from 'vitest';
import { parseM3u } from './parser.js';

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="dr1.dk" tvg-name="DR1" tvg-logo="http://logo/dr1.png" group-title="Danmark",DR1 HD
http://panel.example:8080/live/USER/PASS/1.ts
#EXTINF:-1 tvg-chno="2" group-title="Danmark",TV 2
http://panel.example:8080/live/USER/PASS/2.ts
`;

describe('parseM3u', () => {
  it('parser attributter og visningsnavn', () => {
    const entries = parseM3u(PLAYLIST);
    expect(entries).toHaveLength(2);
    expect(entries[0]?.channel).toEqual({
      id: 'dr1.dk',
      name: 'DR1 HD',
      number: null,
      logoUrl: 'http://logo/dr1.png',
      categoryId: 'Danmark',
      epgChannelId: 'dr1.dk',
      hasArchive: false,
      archiveDays: 0,
    });
    expect(entries[0]?.url).toBe('http://panel.example:8080/live/USER/PASS/1.ts');
  });

  it('læser kanalnummer fra tvg-chno', () => {
    expect(parseM3u(PLAYLIST)[1]?.channel.number).toBe(2);
  });

  it('genererer et stabilt id når tvg-id mangler', () => {
    expect(parseM3u(PLAYLIST)[1]?.channel.id).toBe('m3u-1');
  });

  it('sætter epgChannelId til null når tvg-id mangler', () => {
    expect(parseM3u(PLAYLIST)[1]?.channel.epgChannelId).toBeNull();
  });

  it('accepterer attributter i vilkårlig rækkefølge', () => {
    const text = '#EXTINF:-1 group-title="G" tvg-id="x",Navn\nhttp://a/1.ts';
    expect(parseM3u(text)[0]?.channel.categoryId).toBe('G');
  });

  it('springer poster uden URL-linje over', () => {
    const text = '#EXTM3U\n#EXTINF:-1,Kun header';
    expect(parseM3u(text)).toHaveLength(0);
  });

  it('ignorerer tomme linjer og kommentarer', () => {
    const text = '#EXTM3U\n\n# en kommentar\n#EXTINF:-1,A\n\nhttp://a/1.ts\n';
    expect(parseM3u(text)).toHaveLength(1);
  });

  it('håndterer komma i visningsnavnet', () => {
    const text = '#EXTINF:-1 tvg-id="x",Kanal, med komma\nhttp://a/1.ts';
    expect(parseM3u(text)[0]?.channel.name).toBe('Kanal, med komma');
  });

  it('returnerer tom liste for tom tekst', () => {
    expect(parseM3u('')).toEqual([]);
  });
});
