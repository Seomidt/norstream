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
  };
  const line = liveFailureSnapshot(player, 'native', 'ts');
  expect(line).toContain('ur ? s');
  expect(line).not.toContain('private');
  expect(line).not.toContain('password');
  expect(line).not.toContain('http');
});
