import { expect, it } from 'vitest';
import { ArchiveWatchdog, ArchiveVideoClock, nativeFailureDetails, playbackClock, playbackFailureKind } from './archiveWatchdog.js';

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

it('v383-loggens lydur paa 48.290 s flytter ikke resume forbi sidste billede ved 18.290 s', () => {
  const clock = new ArchiveVideoClock();
  clock.reset(16.050);
  expect(clock.observe(16.747, 19)).toBe(16.747);
  expect(clock.observe(18.290, 59)).toBe(18.290);
  expect(clock.observe(48.290, 59)).toBe(18.290);
  expect(clock.observe(50, 59)).toBe(18.290);
  clock.reset(18.290);
  expect(clock.hasFrames).toBe(false);
  expect(clock.observe(18.4, 1)).toBe(18.4);
  expect(clock.observe(19.4, 26)).toBe(19.4);
});

it.each([undefined, null, 0, NaN])('optional billedtaeller %s maa ikke nulstille 30 sekunders afspilning ved EOF', (frames) => {
  const clock = new ArchiveVideoClock();
  clock.reset(0, 120);
  for (let second = 1; second <= 30; second++) expect(clock.observe(second, frames)).toBe(second);
  expect(clock.hasFrames).toBe(false);
  expect(clock.observe(0, frames)).toBe(30);
  expect(clock.read(0, true)).toBe(30);
  expect(clock.read(90_000, true)).toBe(30);
});

it('rigtige billedtaellere bevarer sidste billede ved lydfremdrift og nulstillet TS-ur', () => {
  const clock = new ArchiveVideoClock();
  clock.reset(0, 120);
  expect(clock.observe(30, 750)).toBe(30);
  expect(clock.observe(60, 750)).toBe(30);
  expect(clock.read(60, true)).toBe(30);
  expect(clock.observe(0, 751)).toBe(30);
  expect(clock.read(0, true)).toBe(30);
  expect(clock.read(31, true)).toBe(31);
  // Nyt arkivstykke eller et bevidst tilbage-seek har et nyt udgangspunkt.
  clock.reset(10, 120);
  expect(clock.observe(10.5, 1)).toBe(10.5);
  expect(clock.observe(11.5, 26)).toBe(11.5);
});

it('asynkron HLS-spoling ignorerer gamle samples og native poll indtil maalets bekraeftelse', () => {
  const clock = new ArchiveVideoClock();
  clock.reset(0, 120);
  clock.observe(80, 2000);
  clock.requestSeek(70);
  expect(clock.position).toBe(80); // et oenske er endnu ikke bekraeftet fremdrift
  expect(clock.observe(80, 2001)).toBe(80);
  expect(clock.read(80)).toBe(80);
  expect(clock.observe(70, 2002)).toBe(70);
  expect(clock.read(0, true)).toBe(70);
  clock.requestSeek(100);
  expect(clock.observe(71, 2026)).toBe(70);
  expect(clock.read(100)).toBe(100);
  clock.requestSeek(90);
  clock.reset(0, 60); // kildeskift annullerer den gamle spoleanmodning
  expect(clock.observe(1, undefined)).toBe(1);
});
