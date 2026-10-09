import { describe, expect, it } from 'vitest';
import {
  cueAt,
  downloadSubtitle,
  imdbNumber,
  login,
  osHeaders,
  parseSrt,
  rankSubtitles,
  searchSubtitles,
  searchUrl,
} from './openSubtitles.js';
import type { OsHttp } from './openSubtitles.js';

const SESSION = { apiKey: ' KEY ' };

describe('imdbNumber', () => {
  it('laeser tt-numre og rene tal', () => {
    expect(imdbNumber('tt0133093')).toBe(133093);
    expect(imdbNumber('15239678')).toBe(15239678);
    expect(imdbNumber('nope')).toBeNull();
    expect(imdbNumber(null)).toBeNull();
  });
});

describe('searchUrl', () => {
  it('film paa IMDb-nummer, parametre i alfabetisk orden', () => {
    expect(searchUrl(SESSION, { kind: 'movie', imdbId: 'tt15239678', title: 'Dune: Part Two', language: 'da' })).toBe(
      'https://api.opensubtitles.com/api/v1/subtitles?imdb_id=15239678&languages=da&type=movie',
    );
  });

  it('afsnit paa seriens nummer + saeson og afsnit', () => {
    expect(
      searchUrl(SESSION, { kind: 'episode', imdbId: 'tt11280740', title: 'Severance', season: 2, episode: 3, language: 'da' }),
    ).toBe(
      'https://api.opensubtitles.com/api/v1/subtitles?episode_number=3&languages=da&parent_imdb_id=11280740&season_number=2&type=episode',
    );
  });

  it('uden numre: titel og aar; TMDB naar IMDb mangler', () => {
    expect(searchUrl(SESSION, { kind: 'movie', title: 'Druk', year: 2020, language: 'da' })).toBe(
      'https://api.opensubtitles.com/api/v1/subtitles?languages=da&query=druk&type=movie&year=2020',
    );
    expect(searchUrl(SESSION, { kind: 'movie', tmdbId: 693134, title: 'x', language: 'da' })).toContain('tmdb_id=693134');
  });

  it('bruger login-vaerten naar den findes', () => {
    expect(searchUrl({ apiKey: 'k', baseUrl: 'vip-api.opensubtitles.com' }, { kind: 'movie', title: 'x', language: 'da' })).toMatch(
      /^https:\/\/vip-api\.opensubtitles\.com\/api\/v1\/subtitles\?/,
    );
  });
});

describe('osHeaders', () => {
  it('noegle, appnavn og token', () => {
    expect(osHeaders({ apiKey: ' k ', token: 't' })).toMatchObject({ 'Api-Key': 'k', 'User-Agent': 'NorStream v1', Authorization: 'Bearer t' });
    expect(osHeaders({ apiKey: 'k' }).Authorization).toBeUndefined();
  });
});

const sub = (fileId: number, downloads: number, extra: Record<string, unknown> = {}) => ({
  attributes: { language: 'da', download_count: downloads, release: `r${fileId}`, files: [{ file_id: fileId }], ...extra },
});

describe('rankSubtitles', () => {
  it('menneske-oversat foer maskine-oversat, saa flest hentninger; andre sprog fra', () => {
    const ranked = rankSubtitles(
      { data: [sub(1, 50), sub(2, 900, { ai_translated: true }), sub(3, 400), sub(4, 999, { language: 'sv' }), { attributes: {} }] },
      'da',
    );
    expect(ranked.map((c) => c.fileId)).toEqual([3, 1, 2]);
    expect(ranked[2]?.machine).toBe(true);
  });
});

describe('searchSubtitles / downloadSubtitle / login', () => {
  it('soeger og henter filen fra linket', async () => {
    const calls: string[] = [];
    const http: OsHttp = async (method, url, _headers, body) => {
      calls.push(`${method} ${url} ${body ?? ''}`);
      if (url.includes('/subtitles?')) return { status: 200, json: { data: [sub(7, 10)] } };
      return { status: 200, json: { link: 'https://dl.opensubtitles.com/x.srt', remaining: 4 } };
    };
    const found = await searchSubtitles(http, SESSION, { kind: 'movie', imdbId: 'tt1', title: 'x', language: 'da' });
    const file = await downloadSubtitle(http, async () => '1\n00:00:01,000 --> 00:00:02,000\nHej\n', SESSION, found[0]!.fileId);
    expect(file).toEqual({ text: '1\n00:00:01,000 --> 00:00:02,000\nHej\n', remaining: 4 });
    expect(calls[1]).toContain('"file_id":7');
    expect(calls[1]).toContain('"sub_format":"srt"');
  });

  it('forstaaelige fejl — uden noeglen i teksten', async () => {
    const denied: OsHttp = async () => ({ status: 401, json: null });
    await expect(searchSubtitles(denied, { apiKey: 'HEMMELIG' }, { kind: 'movie', title: 'x', language: 'da' })).rejects.toThrow(
      /afviste nøglen/,
    );
    const quota: OsHttp = async () => ({ status: 406, json: null });
    await expect(downloadSubtitle(quota, async () => null, SESSION, 1)).rejects.toThrow(/antal hentninger/);
    await expect(
      downloadSubtitle(async () => ({ status: 200, json: { link: 'https://x' } }), async () => null, SESSION, 1),
    ).rejects.toThrow(/kunne ikke hentes/);
  });

  it('login giver token og evt. vaert', async () => {
    const http: OsHttp = async () => ({ status: 200, json: { token: 'tok', base_url: 'vip-api.opensubtitles.com' } });
    expect(await login(http, 'k', 'u', 'p')).toEqual({ token: 'tok', baseUrl: 'vip-api.opensubtitles.com' });
  });
});

describe('parseSrt / cueAt', () => {
  const SRT = '﻿1\r\n00:00:01,000 --> 00:00:03,500\r\n<i>Hej med dig</i>\r\n\r\n2\r\n00:00:04,000 --> 00:00:06,000 X1:0\r\n{\\an8}Linje et\r\nLinje to\r\n\r\n3\r\nnoget forkert\r\n\r\n4\r\n00:01:00.5 --> 00:01:02,000\r\nSidst\r\n';

  it('laeser tider og tekst, fjerner formatering', () => {
    const cues = parseSrt(SRT);
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: 'Hej med dig' },
      { start: 4, end: 6, text: 'Linje et\nLinje to' },
      { start: 60.5, end: 62, text: 'Sidst' },
    ]);
  });

  it('finder replikken til tiden, og intet mellem replikker', () => {
    const cues = parseSrt(SRT);
    expect(cueAt(cues, 0.5)).toBeNull();
    expect(cueAt(cues, 2)).toBe('Hej med dig');
    expect(cueAt(cues, 3.7)).toBeNull();
    expect(cueAt(cues, 5.99)).toBe('Linje et\nLinje to');
    expect(cueAt(cues, 61)).toBe('Sidst');
    expect(cueAt(cues, 99)).toBeNull();
    expect(cueAt([], 1)).toBeNull();
  });
});
