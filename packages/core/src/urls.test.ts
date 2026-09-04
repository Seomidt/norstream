import { describe, expect, it } from 'vitest';
import {
  buildLiveUrl,
  buildTimeshiftUrl,
  buildXmltvUrl,
  formatTimeshiftStart,
} from './urls.js';
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

  it('URL-koder streamId', () => {
    expect(buildLiveUrl(creds, 'a/b', 'ts')).toBe(
      'http://panel.example:8080/live/USER/PASS/a%2Fb.ts',
    );
  });
});

describe('formatTimeshiftStart', () => {
  it('formaterer i UTC som standard', () => {
    const d = new Date(Date.UTC(2026, 8, 4, 20, 5));
    expect(formatTimeshiftStart(d)).toBe('2026-09-04:20-05');
  });

  it('anvender panelets offset', () => {
    const d = new Date(Date.UTC(2026, 8, 4, 20, 5));
    expect(formatTimeshiftStart(d, 120)).toBe('2026-09-04:22-05');
  });

  it('håndterer datoskift ved negativt offset', () => {
    const d = new Date(Date.UTC(2026, 8, 4, 0, 30));
    expect(formatTimeshiftStart(d, -60)).toBe('2026-09-03:23-30');
  });
});

describe('buildTimeshiftUrl', () => {
  const start = new Date(Date.UTC(2026, 8, 4, 20, 0));

  it('bygger php-dialekten', () => {
    expect(buildTimeshiftUrl(creds, '123', start, 60, 'php')).toBe(
      'http://panel.example:8080/streaming/timeshift.php' +
        '?username=USER&password=PASS&stream=123&start=2026-09-04%3A20-00&duration=60',
    );
  });

  it('bygger path-dialekten', () => {
    expect(buildTimeshiftUrl(creds, '123', start, 60, 'path')).toBe(
      'http://panel.example:8080/timeshift/USER/PASS/60/2026-09-04:20-00/123.m3u8',
    );
  });

  it('runder varighed op til nærmeste hele minut', () => {
    const url = buildTimeshiftUrl(creds, '123', start, 59.2, 'path');
    expect(url).toContain('/60/');
  });

  it('URL-koder streamId i path-dialekten', () => {
    const url = buildTimeshiftUrl(creds, 'a/b', start, 60, 'path');
    expect(url).toContain('/a%2Fb.m3u8');
  });
});

describe('buildXmltvUrl', () => {
  it('bygger URL til xmltv.php', () => {
    expect(buildXmltvUrl(creds)).toBe(
      'http://panel.example:8080/xmltv.php?username=USER&password=PASS',
    );
  });

  it('URL-koder et password med specialtegn', () => {
    const odd = { ...creds, password: 'p+w/x y' };
    expect(buildXmltvUrl(odd)).toBe(
      'http://panel.example:8080/xmltv.php?username=USER&password=p%2Bw%2Fx%20y',
    );
  });

  it('fjerner afsluttende skråstreg fra basis-URL', () => {
    const withSlash = { ...creds, baseUrl: 'http://panel.example:8080/' };
    expect(buildXmltvUrl(withSlash)).toBe(
      'http://panel.example:8080/xmltv.php?username=USER&password=PASS',
    );
  });
});
