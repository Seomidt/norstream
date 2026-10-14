import { afterEach, expect, it, vi } from 'vitest';
import { watchArchivePreparation } from './archivePreparation.js';
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });
it('viser lang overlap-fremdrift og oprydder ved et manuelt Tilbage', () => {
  vi.useFakeTimers();
  const player = {currentTime: 0, bufferedPosition: 5, playing: true, playbackRate: 4, status: 'readyToPlay'};
  const state = {preparationPhase: 'sekventielt overlap'};
  const log = vi.fn(); const stop = watchArchivePreparation(player, state, 58.774, log);
  player.currentTime = 20; player.bufferedPosition = 80; vi.advanceTimersByTime(5000);
  expect(log.mock.calls.at(-1)?.[0]).toContain('position 20.000 s, maal 58.774 s, buffer 80.000 s');
  vi.advanceTimersByTime(15000);
  expect(log.mock.calls.at(-1)?.[0]).toContain('ventet 20 s, position 20.000 s');
  stop('afbrudt'); stop('klar');
  expect(log.mock.calls.at(-1)?.[0]).toContain('afbrudt');
  const n = log.mock.calls.length; vi.advanceTimersByTime(10000); expect(log).toHaveBeenCalledTimes(n);
});
it('afslutter ved klar og afskaerer ukendt native status og ugyldige tal', () => {
  vi.useFakeTimers(); const log = vi.fn();
  const stop = watchArchivePreparation({currentTime: NaN, bufferedPosition: -1, playing: false, playbackRate: 1, status: 'secret-url'}, {preparationPhase:'buffer'}, 0, log);
  stop('klar'); expect(log.mock.calls.at(-1)?.[0]).toContain('position ? s, maal 0.000 s, buffer ? s');
  expect(log.mock.calls.at(-1)?.[0]).not.toContain('secret-url');
});
it('taaler en allerede frigivet native afspiller', () => {
  vi.useFakeTimers(); const log = vi.fn();
  const player = {get currentTime(): number {throw new Error('secret');}, bufferedPosition: 0, playing: false, playbackRate: 1, status:'idle'};
  const stop = watchArchivePreparation(player, {preparationPhase:'metadata'}, 0, log);
  stop('fejl'); expect(log.mock.calls.at(-1)?.[0]).toBe('klargoering v392: fejl, native afspiller utilgaengelig');
});
