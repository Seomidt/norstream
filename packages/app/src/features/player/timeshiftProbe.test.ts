import { describe, expect, it } from 'vitest';
import type { Programme } from '@norstream/core';
import { probeTimeshift, readPlaylist, resolveVariant } from './timeshiftProbe.js';
import type { ProbeFetch } from './timeshiftProbe.js';

const creds = { baseUrl: 'http://panel.example:8080', username: 'USER', password: 'SECRET' };
const programme: Programme = {
  channelId: 's:1',
  start: new Date('2026-10-01T20:00:00'),
  stop: new Date('2026-10-01T21:00:00'),
  title: 'Nyhederne',
  description: null,
};
const NOW = new Date('2026-10-01T20:17:00').getTime();

function playlist(segments: number, ended: boolean): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:10', '#EXT-X-MEDIA-SEQUENCE:0'];
  for (let i = 0; i < segments; i += 1) lines.push('#EXTINF:10.000,', `seg${i}.ts`);
  if (ended) lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

describe('readPlaylist', () => {
  it('taeller stykker og sekunder og ser ENDLIST', () => {
    const facts = readPlaylist(playlist(3, true));
    expect(facts).toMatchObject({ segments: 3, seconds: 30, ended: true, mediaSequence: 0, variants: [] });
  });

  it('ser varianterne i en master-spilleliste', () => {
    const facts = readPlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nlow/index.m3u8\n');
    expect(facts.variants).toEqual(['low/index.m3u8']);
    expect(facts.segments).toBe(0);
  });

  it('loeser relative variant-adresser', () => {
    expect(resolveVariant('http://p/timeshift/u/p/60/x/1.m3u8', 'low/index.m3u8')).toBe('http://p/timeshift/u/p/60/x/low/index.m3u8');
    expect(resolveVariant('http://p/a/b.m3u8', '/hls/c.m3u8')).toBe('http://p/hls/c.m3u8');
    expect(resolveVariant('http://p/a/b.m3u8', 'http://q/c.m3u8')).toBe('http://q/c.m3u8');
  });
});

describe('probeTimeshift', () => {
  it('melder at arkivet vokser, naar anden laesning har flere sekunder', async () => {
    let reads = 0;
    const none: Record<string, string> = {};
    const fetchProbe: ProbeFetch = async (url, headersOnly) => {
      if (headersOnly) return { status: 200, headers: { 'transfer-encoding': 'chunked' } as Record<string, string>, text: null };
      if (url.includes('/60/')) {
        reads += 1;
        return { status: 200, headers: none, text: playlist(reads === 1 ? 90 : 93, false) };
      }
      return { status: 200, headers: none, text: playlist(90, true) };
    };
    const report = await probeTimeshift(fetchProbe, creds, '1', programme, 'path', 0, { now: NOW, waitMs: 30_000, sleep: async () => undefined });
    expect(report).toContain('vokser: JA (+30 s)');
    expect(report).toContain('B. HLS kun det der findes (16 min): svar 200, 90 stykker, 900 s, ENDLIST: ja');
    expect(report).toContain('C. .ts til slut: svar 200, ingen Content-Length (chunked)');
    expect(report).toContain('Konklusion: panelet leverer et arkiv der vokser');
    expect(report).not.toContain('SECRET');
    expect(report).not.toContain('http');
  });

  it('melder stykkevis, naar spillelisten til slut er lukket', async () => {
    const fetchProbe: ProbeFetch = async (_url, headersOnly) =>
      headersOnly
        ? { status: 200, headers: { 'content-length': String(120 * 1048576) } as Record<string, string>, text: null }
        : { status: 200, headers: {} as Record<string, string>, text: playlist(90, true) };
    const report = await probeTimeshift(fetchProbe, creds, '1', programme, 'path', 0, { now: NOW, sleep: async () => undefined });
    expect(report).toContain('spillelisten er lukket (ENDLIST)');
    expect(report).toContain('Content-Length 120 MB (færdig fil)');
    expect(report).toContain('Konklusion: panelet giver kun det der findes');
  });

  it('fejl rummer ingen adresser', async () => {
    const fetchProbe: ProbeFetch = async () => {
      throw new Error('kunne ikke naa http://panel.example:8080/timeshift/USER/SECRET/60/x/1.m3u8');
    };
    const report = await probeTimeshift(fetchProbe, creds, '1', programme, 'php', 0, { now: NOW, sleep: async () => undefined });
    expect(report).toContain('fejl: kunne ikke naa [adresse]');
    expect(report).not.toContain('SECRET');
    expect(report).toContain('Konklusion: kunne ikke afgøres');
  });
});
