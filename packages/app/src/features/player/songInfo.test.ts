import { describe, expect, it } from 'vitest';
import { parseItunes, parseWikiSummary, pickWikiTitle } from './songInfo.js';

describe('parseItunes', () => {
  it('tager album, aar og genre fra det foerste svar', () => {
    const body = JSON.stringify({ results: [{ collectionName: 'G.I. Blues', releaseDate: '1960-10-01T07:00:00Z', primaryGenreName: 'Rock' }] });
    expect(parseItunes(body)).toEqual({ album: 'G.I. Blues', year: 1960, genre: 'Rock' });
    expect(parseItunes('{"results":[]}')).toEqual({ album: null, year: null, genre: null });
    expect(parseItunes('x')).toEqual({ album: null, year: null, genre: null });
  });
});

describe('pickWikiTitle', () => {
  it('tager den foerste artikel med det soegte i titlen', () => {
    const body = JSON.stringify({ query: { search: [{ title: 'Elvis Presley' }, { title: 'G.I. Blues (song)' }] } });
    expect(pickWikiTitle(body, 'G.I. Blues')).toBe('G.I. Blues (song)');
    expect(pickWikiTitle(body, 'Houdini')).toBeNull();
  });
});

describe('parseWikiSummary', () => {
  it('korter til et par saetninger og afviser flertydige sider', () => {
    const long = 'Første sætning om sangen. '.repeat(40);
    const out = parseWikiSummary(JSON.stringify({ extract: long }));
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(421);
    expect(out!.endsWith('.')).toBe(true);
    expect(parseWikiSummary(JSON.stringify({ type: 'disambiguation', extract: 'x' }))).toBeNull();
    expect(parseWikiSummary(JSON.stringify({ extract: '  ' }))).toBeNull();
  });
});
