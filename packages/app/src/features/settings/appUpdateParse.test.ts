import { describe, expect, it } from 'vitest';
import { installFailureText, installOutcome, parseRelease, percentText, releaseTag } from './appUpdateParse.js';

describe('parseRelease', () => {
  it('versionsnummer fra noten, APK-fil og stoerrelse', () => {
    expect(
      parseRelease({
        body: '340',
        name: 'NorStream TV (v340)',
        assets: [
          { name: 'notes.txt', browser_download_url: 'https://x/notes.txt', size: 3 },
          { name: 'NorStream-TV.apk', browser_download_url: 'https://x/NorStream-TV.apk', size: 107155888 },
        ],
      }),
    ).toEqual({ versionCode: 340, url: 'https://x/NorStream-TV.apk', size: 107155888 });
    expect(parseRelease({ name: '12', assets: [{ name: 'a.apk', browser_download_url: 'https://x/a.apk' }] }).size).toBeNull();
    expect(() => parseRelease({ body: 'x', assets: [] })).toThrow(/mangler/);
  });

  it('maerkat per udgave', () => {
    expect(releaseTag(true)).toBe('latest-norstream-tv');
    expect(releaseTag(false)).toBe('latest-norstream');
  });
});

describe('installOutcome', () => {
  it('OK, afbrudt og fejl med Androids kode', () => {
    expect(installOutcome(-1, undefined)).toEqual({ kind: 'installed' });
    expect(installOutcome(0, undefined)).toEqual({ kind: 'cancelled' });
    const failed = installOutcome(1, -4);
    expect(failed.kind).toBe('failed');
    if (failed.kind === 'failed') {
      expect(failed.code).toBe(-4);
      expect(failed.text).toMatch(/plads/);
    }
    expect(installOutcome(1, 'nej')).toMatchObject({ kind: 'failed', code: null });
  });

  it('forklaringer der kan handles paa', () => {
    expect(installFailureText(-7)).toMatch(/anden nøgle/);
    expect(installFailureText(-104)).toMatch(/anden nøgle/);
    expect(installFailureText(-25)).toMatch(/ældre/);
    expect(installFailureText(-102)).toMatch(/beskadiget/);
    expect(installFailureText(-999)).toMatch(/kode -999/);
    expect(installFailureText(null)).toMatch(/sagde ikke hvorfor/);
  });
});

describe('percentText', () => {
  it('procent, kun naar stoerrelsen kendes', () => {
    expect(percentText(50, 200)).toBe('25 %');
    expect(percentText(999, 200)).toBe('100 %');
    expect(percentText(10, null)).toBeNull();
  });
});
