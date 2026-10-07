import { describe, expect, it } from 'vitest';
import { archiveStopped, playbackFailureKind } from './archiveWatchdog.js';
const stopped = { archive: true, wantsPlay: true, active: true, changing: false, playing: false, status: 'readyToPlay' };
describe('silent archive stop', () => {
  it('detects a stopped archive without a native end event', () => {
    expect(archiveStopped(stopped)).toBe(true);
    expect(archiveStopped({ ...stopped, status: 'idle' })).toBe(true);
  });
  it('does not treat pause, replacement, seek, loading or live as a silent stop', () => {
    for (const patch of [{ wantsPlay: false }, { changing: true }, { active: false }, { status: 'loading' }, { archive: false }, { playing: true }]) {
      expect(archiveStopped({ ...stopped, ...patch })).toBe(false);
    }
  });
});

it('logger aldrig en raa native URI eller private fejltekst', () => {
  expect(playbackFailureKind('Source error https://panel.test/user/secret/file.ts')).toBe('netvaerk/kilde');
  expect(playbackFailureKind('Response code: 403 https://panel.test/user/secret')).toBe('adgang afvist');
  expect(playbackFailureKind('DecoderInitializationException')).toBe('dekoder');
  expect(playbackFailureKind('private ukendt besked')).toBe('ukendt');
});
