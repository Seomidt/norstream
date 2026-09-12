import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FetchLikeResponse } from '@norstream/core';
import { clearPins, createResolver, eligibleParts, parseDnsJson, pinHost, pinnedIp, streamSource, viaIp, withDnsFallback } from './doh.js';

const ok = (body: string): FetchLikeResponse => ({ ok: true, status: 200, json: async () => JSON.parse(body) as unknown, text: async () => body });
const DNS_JSON = JSON.stringify({ Answer: [{ type: 5, data: 'alias.example.' }, { type: 1, data: '203.0.113.7' }, { type: 1, data: '203.0.113.8' }] });

describe('DNS over HTTPS som noedudgang', () => {
  beforeEach(() => clearPins());

  it('laeser A-svar ud af DNS-JSON og springer alt andet over', () => {
    expect(parseDnsJson(DNS_JSON)).toEqual(['203.0.113.7', '203.0.113.8']);
    expect(parseDnsJson('ikke json')).toEqual([]);
  });

  it('kun http-adresser med et navn kan gaa udenom', () => {
    expect(eligibleParts('http://panel.example:8080/live/a/b/1.ts?x=1')).toEqual({ scheme: 'http', host: 'panel.example', port: ':8080', rest: '/live/a/b/1.ts?x=1' });
    expect(eligibleParts('https://panel.example/x')).toBeNull();
    expect(eligibleParts('http://203.0.113.7:8080/x')).toBeNull();
    const parts = eligibleParts('http://panel.example:8080/player_api.php?u=1');
    expect(viaIp(parts!, '203.0.113.7')).toEqual({ url: 'http://203.0.113.7:8080/player_api.php?u=1', headers: { Host: 'panel.example:8080' } });
  });

  it('proever adressen naar navnet fejler, og husker den til naeste kald og til streams', async () => {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const fetchImpl = vi.fn(async (url: string, headers?: Record<string, string>) => {
      calls.push({ url, headers });
      if (url.startsWith('http://panel.example')) throw new TypeError('Network request failed');
      return ok('{"ok":1}');
    });
    const wrapped = withDnsFallback(fetchImpl, async () => ['203.0.113.7']);
    const response = await wrapped('http://panel.example:8080/player_api.php');
    expect(response.status).toBe(200);
    expect(calls.map((c) => c.url)).toEqual(['http://panel.example:8080/player_api.php', 'http://203.0.113.7:8080/player_api.php']);
    expect(calls[1]?.headers).toEqual({ Host: 'panel.example:8080' });
    expect(pinnedIp('panel.example')).toBe('203.0.113.7');

    // Naeste kald gaar direkte.
    await wrapped('http://panel.example:8080/live/x.ts');
    expect(calls[2]?.url).toBe('http://203.0.113.7:8080/live/x.ts');
    expect(streamSource('http://panel.example:8080/live/x.ts')).toEqual({ uri: 'http://203.0.113.7:8080/live/x.ts', headers: { Host: 'panel.example:8080' } });
    expect(streamSource('http://other.example/x.ts')).toBe('http://other.example/x.ts');
  });

  it('kaster den oprindelige fejl naar opslaget heller ikke hjaelper', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const wrapped = withDnsFallback(fetchImpl, async () => ['203.0.113.7']);
    await expect(wrapped('http://panel.example/x')).rejects.toThrow('Network request failed');
    expect(pinnedIp('panel.example')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('roerer ikke et svar fra panelet, heller ikke et nej', async () => {
    const resolve = vi.fn(async () => ['203.0.113.7']);
    const wrapped = withDnsFallback(async () => ({ ...ok(''), ok: false, status: 403 }), resolve);
    expect((await wrapped('http://panel.example/x')).status).toBe(403);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('glemmer en pinnet adresse der svigter, og gaar tilbage til navnet', async () => {
    pinHost('panel.example', '203.0.113.9');
    const calls: string[] = [];
    const wrapped = withDnsFallback(async (url) => {
      calls.push(url);
      if (url.startsWith('http://203.0.113.9')) throw new TypeError('timeout');
      return ok('');
    });
    expect((await wrapped('http://panel.example/x')).status).toBe(200);
    expect(calls).toEqual(['http://203.0.113.9/x', 'http://panel.example/x']);
    expect(pinnedIp('panel.example')).toBeNull();
  });

  it('spoerger Google foerst og Cloudflare naar Google ikke svarer', async () => {
    const asked: string[] = [];
    const resolve = createResolver(async (url) => {
      asked.push(url);
      if (url.includes('dns.google')) throw new Error('nede');
      return ok(DNS_JSON);
    });
    expect(await resolve('panel.example')).toEqual(['203.0.113.7', '203.0.113.8']);
    expect(asked[0]).toContain('dns.google');
    expect(asked[1]).toContain('cloudflare-dns.com');
  });
});
