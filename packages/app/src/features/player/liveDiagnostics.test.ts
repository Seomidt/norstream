import { expect, it } from 'vitest';
import { liveFailureSnapshot } from './liveDiagnostics.js';
it('viser tom buffer, buffer foran dekoderen og EOF uden at gaette paa netvaerket', () => {
  const player = { currentTime: 100, bufferedPosition: 100.2, status: 'loading', playing: false };
  expect(liveFailureSnapshot(player, 'buffer-timeout', 'ts')).toContain('foran 0.2 s');
  expect(liveFailureSnapshot({ ...player, bufferedPosition: 120 }, 'ur-stoppet', 'hls')).toContain('foran 20.0 s');
  expect(liveFailureSnapshot(player, 'eof', 'ts')).toContain('eof, ts');
});
it('taaler frigivet afspiller og logger ingen raa fejl eller adresser', () => {
  const player = {
    get currentTime(): number { throw Error('http://private/u/password'); },
    bufferedPosition: NaN, status: 'http://private/u/password', playing: false,
    get isLive(): boolean { throw Error('http://private/u/password'); },
    get duration(): number { throw Error('http://private/u/password'); },
  };
  const line = liveFailureSnapshot(player, 'native', 'ts');
  expect(line).toContain('ur ? s');
  expect(line).not.toContain('private');
  expect(line).not.toContain('password');
  expect(line).not.toContain('http');
  expect(line).toContain('native live ?, varighed ? s');
});
it('skelner native live metadata fra endelig varighed uden at gaette paa aarsagen', () => {
  const player = { currentTime: 77.6, bufferedPosition: 77.6, status: 'idle', playing: false, duration: 77.6, isLive: false };
  expect(liveFailureSnapshot(player, 'eof', 'hls')).toContain('native live nej, varighed 77.6 s');
  expect(liveFailureSnapshot({ ...player, duration: Infinity, isLive: true }, 'buffer-timeout', 'hls')).toContain('native live ja, varighed ? s');
});
it('tager videotaellerne med naar de findes, og udelader dem ellers', () => {
  const player = { currentTime: 100, bufferedPosition: 130, status: 'readyToPlay', playing: true };
  expect(liveFailureSnapshot(player, 'ur-stoppet', 'ts', { videoQueuedFrames: 2500, videoRenderedFrames: 2400, videoDroppedFrames: 3 }))
    .toContain('billeder ind 2500, vist 2400, tabt 3');
  expect(liveFailureSnapshot(player, 'ur-stoppet', 'ts', { videoQueuedFrames: null })).toContain('billeder ind ?, vist ?, tabt ?');
  expect(liveFailureSnapshot(player, 'ur-stoppet', 'ts')).not.toContain('billeder');
});
