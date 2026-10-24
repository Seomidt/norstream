import { describe, expect, it } from 'vitest';
import {
  buildEpisodeUrl,
  buildLiveUrl,
  buildMovieUrl,
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

describe('buildTimeshiftUrl og filformatet', () => {
  const creds = { baseUrl: 'http://panel.example:8080', username: 'u', password: 'p' };
  const start = new Date('2026-09-06T20:00:00.000Z');

  it('giver m3u8 som standard, som en afspiller vil have', () => {
    expect(buildTimeshiftUrl(creds, '1', start, 60, 'path')).toContain('/1.m3u8');
  });

  it('kan give ts, som er det man kan gemme som fil', () => {
    // En hentet .m3u8 er spillelisten, ikke udsendelsen.
    expect(buildTimeshiftUrl(creds, '1', start, 60, 'path', 0, 'ts')).toContain('/1.ts');
  });

  it('rører ikke php-dialekten, som ingen filendelse har', () => {
    const asTs = buildTimeshiftUrl(creds, '1', start, 60, 'php', 0, 'ts');
    expect(asTs).toBe(buildTimeshiftUrl(creds, '1', start, 60, 'php', 0, 'm3u8'));
    expect(asTs).toContain('timeshift.php?');
  });
});

describe('buildMovieUrl', () => {
  const creds = { baseUrl: 'http://p:8080/', username: 'u', password: 'p' };

  it('bygger adressen med panelets egen filendelse', () => {
    expect(buildMovieUrl(creds, '4711', 'mkv')).toBe('http://p:8080/movie/u/p/4711.mkv');
  });

  it('falder tilbage paa mp4 naar panelet ikke oplyser en', () => {
    expect(buildMovieUrl(creds, '4711', null)).toBe('http://p:8080/movie/u/p/4711.mp4');
  });
});

describe('buildEpisodeUrl', () => {
  it('bruger series-stien', () => {
    expect(
      buildEpisodeUrl({ baseUrl: 'http://p', username: 'u', password: 'p' }, '1001', 'mkv'),
    ).toBe('http://p/series/u/p/1001.mkv');
  });
});

