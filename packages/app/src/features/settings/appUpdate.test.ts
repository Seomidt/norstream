import { describe, expect, it } from 'vitest';
import { parseRelease, releaseTag } from './appUpdateParse.js';

describe('opdatering: tolkning af udgivelsen', () => {
  it('vaelger maerkat efter tv eller telefon', () => {
    expect(releaseTag(true)).toBe('latest-norstream-tv');
    expect(releaseTag(false)).toBe('latest-norstream');
  });

  it('laeser versionsnummer og APK-adresse', () => {
    const parsed = parseRelease({
      body: '228',
      assets: [
        { name: 'noter.txt', browser_download_url: 'https://x/n.txt' },
        { name: 'norstream-tv.apk', browser_download_url: 'https://x/a.apk' },
      ],
    });
    expect(parsed).toEqual({ versionCode: 228, url: 'https://x/a.apk' });
  });

  it('kaster naar der ikke er nogen APK eller nummer', () => {
    expect(() => parseRelease({ body: '228', assets: [] })).toThrow();
    expect(() => parseRelease({ body: 'ikke et tal', assets: [{ name: 'a.apk', browser_download_url: 'https://x/a.apk' }] })).toThrow();
  });
});
