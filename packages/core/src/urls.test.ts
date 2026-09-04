import { describe, expect, it } from 'vitest';
import { buildLiveUrl } from './urls.js';
import type { XtreamCredentials } from './models.js';

const creds: XtreamCredentials = {
  baseUrl: 'http://panel.example:8080',
  username: 'USER',
  password: 'PASS',
};

describe('buildLiveUrl', () => {
  it('bygger en TS-URL', () => {
    expect(buildLiveUrl(creds, '123', 'ts')).toBe(
      'http://panel.example:8080/live/USER/PASS/123.ts',
    );
  });

  it('bygger en HLS-URL', () => {
    expect(buildLiveUrl(creds, '123', 'm3u8')).toBe(
      'http://panel.example:8080/live/USER/PASS/123.m3u8',
    );
  });

  it('fjerner afsluttende skråstreg fra basis-URL', () => {
    const withSlash = { ...creds, baseUrl: 'http://panel.example:8080/' };
    expect(buildLiveUrl(withSlash, '7', 'm3u8')).toBe(
      'http://panel.example:8080/live/USER/PASS/7.m3u8',
    );
  });

  it('URL-koder credentials med specialtegn', () => {
    const odd = { ...creds, username: 'a b', password: 'p/w' };
    expect(buildLiveUrl(odd, '9', 'ts')).toBe(
      'http://panel.example:8080/live/a%20b/p%2Fw/9.ts',
    );
  });
});
