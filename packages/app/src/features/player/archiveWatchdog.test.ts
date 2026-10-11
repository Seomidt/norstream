import { expect, it } from 'vitest';
import { ArchiveWatchdog, nativeFailureDetails, playbackClock, playbackFailureKind } from './archiveWatchdog.js';

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

it('genforbinder ved v382-loggens 2526.557 s trods konstante READY/loading-skift', () => {
  const watchdog = new ArchiveWatchdog(15_000);
  let failures = 0;
  // Afspilningen og bufferen gaar frem i mere end 40 minutter.
  for (let now = 0; now < 2_500_000; now += 3000) {
    expect(watchdog.stalled(now / 1000, now, true)).toBe(false);
  }
  // Ved en tom buffer er brugerens Afspil stadig valgt. Native playing
  // bliver falsk under loading, og korte READY-klarmeldinger hjalp ikke.
  for (let second = 0; second <= 30; second += 1) {
    for (const status of ['loading', 'readyToPlay', 'loading']) {
      // Ingen af disse haendelser er faktisk afspilningsfremdrift.
      if (watchdog.stalled(2526.557, 2_526_000 + second * 1000, status !== 'idle')) failures += 1;
    }
  }
  expect(failures).toBe(1);
});

it('kort buffering nulstilles foerst naar native uret gaar frem igen', () => {
  const watchdog = new ArchiveWatchdog(15_000);
  expect(watchdog.stalled(100, 0, true)).toBe(false);
  expect(watchdog.stalled(100, 14_000, true)).toBe(false);
  expect(watchdog.stalled(101, 14_500, true)).toBe(false);
  expect(watchdog.stalled(101, 29_499, true)).toBe(false);
  expect(watchdog.stalled(101, 29_500, true)).toBe(true);
  expect(watchdog.stalled(101, 50_000, true)).toBe(false);
});

it('en rigtig pause og klargoering af et nyt arkiv har ingen stopdeadline', () => {
  const watchdog = new ArchiveWatchdog(15_000);
  watchdog.stalled(2339.946, 0, true);
  expect(watchdog.stalled(2339.946, 3000, false)).toBe(false); // EOF/kildeskift
  expect(watchdog.stalled(59.946, 35_000, false)).toBe(false); // load ejer sin deadline
  expect(watchdog.stalled(59.946, 40_000, true)).toBe(false); // bekraeftet nyt seek
  expect(watchdog.stalled(60.946, 41_000, true)).toBe(false);
  expect(watchdog.stalled(60.946, 45_000, false)).toBe(false); // brugerens pause
  expect(watchdog.stalled(60.946, 3_645_000, false)).toBe(false);
  expect(watchdog.stalled(60.946, 3_646_000, true)).toBe(false);
  expect(watchdog.stalled(60.946, 3_661_000, true)).toBe(true);
});

it('smal urjitter kan ikke holde en stoppet buffer i live, men spoling nulstiller', () => {
  const watchdog = new ArchiveWatchdog(15_000);
  watchdog.stalled(2526.557, 0, true);
  for (let second = 1; second < 15; second += 1) {
    expect(watchdog.stalled(2526.557 + (second % 2) * 0.01, second * 1000, true)).toBe(false);
  }
  expect(watchdog.stalled(2526.557, 15_000, true)).toBe(true);
  expect(watchdog.stalled(2500, 16_000, true)).toBe(false); // manuelt seek
  expect(watchdog.stalled(2500, 30_999, true)).toBe(false);
  expect(watchdog.stalled(2500, 31_000, true)).toBe(true);
});

it('ugyldige native maalinger og et ur der stilles tilbage udloeser ikke en falsk fejl', () => {
  const watchdog = new ArchiveWatchdog(15_000);
  watchdog.stalled(100, 5000, true);
  expect(watchdog.stalled(NaN, 50_000, true)).toBe(false);
  expect(watchdog.stalled(100, 55_000, true)).toBe(false);
  expect(watchdog.stalled(100, 1000, true)).toBe(false);
  expect(watchdog.stalled(100, 15_999, true)).toBe(false);
  expect(watchdog.stalled(100, 16_000, true)).toBe(true);
});
