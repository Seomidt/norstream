import { expect, it } from 'vitest';
import { nativeFailureDetails, playbackClock, playbackFailureKind } from './archiveWatchdog.js';

it('logger aldrig en raa native URI eller private fejltekst', () => {
  expect(playbackFailureKind('Source error https://panel.test/user/secret/file.ts')).toBe('netvaerk/kilde');
  expect(playbackFailureKind('Response code: 403 https://panel.test/user/secret')).toBe('adgang afvist');
  expect(playbackFailureKind('DecoderInitializationException')).toBe('dekoder');
  expect(playbackFailureKind('private ukendt besked')).toBe('ukendt');
});

it('skelner forsinkede JS-haendelser fra et faktisk stoppet native ur', () => {
  expect(playbackClock(110.268, 122.268, true)).toBe(122.268);
  expect(playbackClock(110.268, 110.268, true)).toBe(110.268);
  expect(playbackClock(50.268, 900, false)).toBe(50.268); // gammel kilde under seek
  expect(playbackClock(110.268, NaN, true)).toBe(110.268);
  expect(playbackClock(110.268, -1, true)).toBe(110.268);
});

it('logger kun numeriske native koder, og virker ogsaa uden den nye Android-patch', () => {
  expect(nativeFailureDetails({ errorCode: 4003, errorType: 1, message: 'https://private/secret' })).toBe('kode 4003, type 1');
  expect(nativeFailureDetails({ errorCode: 'https://private/secret', errorType: 'secret' })).toBe('kode ?, type ?');
  expect(nativeFailureDetails({ errorCode: NaN, errorType: 99 })).toBe('kode ?, type ?');
  expect(nativeFailureDetails(undefined)).toBe('kode ?, type ?');
  expect(playbackFailureKind('AudioSink.UnexpectedDiscontinuityException')).toBe('tidsstempel');
});
