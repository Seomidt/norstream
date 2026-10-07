import { expect, it } from 'vitest';
import { playbackFailureKind } from './archiveWatchdog.js';

it('logger aldrig en raa native URI eller private fejltekst', () => {
  expect(playbackFailureKind('Source error https://panel.test/user/secret/file.ts')).toBe('netvaerk/kilde');
  expect(playbackFailureKind('Response code: 403 https://panel.test/user/secret')).toBe('adgang afvist');
  expect(playbackFailureKind('DecoderInitializationException')).toBe('dekoder');
  expect(playbackFailureKind('private ukendt besked')).toBe('ukendt');
});
