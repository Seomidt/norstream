import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRailSelection, RAIL_SETTLE_MS } from './railSelection.js';
beforeEach(() => vi.useFakeTimers());
afterEach(() => { expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); });
const key = () => ({ type: 'down', at: Date.now() });
it('hurtigt pil-hoejre efter fokus og blur aabner den valgte side med det samme', () => {
  const select = vi.fn(); const rail = createRailSelection(select, key);
  rail.focus('film'); rail.leave(); rail.enter();
  expect(select.mock.calls).toEqual([['film']]);
  vi.advanceTimersByTime(1000);
  expect(select).toHaveBeenCalledTimes(1);
});
it('hurtig rulning monterer kun den sidste fane efter 100 ms', () => {
  const select = vi.fn(); const rail = createRailSelection(select, key);
  for (const id of ['hjem', 'film', 'sport']) { rail.focus(id); vi.advanceTimersByTime(40); rail.leave(); }
  rail.focus('radio');
  vi.advanceTimersByTime(RAIL_SETTLE_MS - 1); expect(select).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(select.mock.calls).toEqual([['radio']]);
});
it('OK vaelger straks og annullerer en aeldre ventende fane', () => {
  const select = vi.fn(); const rail = createRailSelection(select, key);
  rail.focus('film'); rail.press('sport');
  expect(select.mock.calls).toEqual([['sport']]);
  vi.advanceTimersByTime(1000); expect(select).toHaveBeenCalledTimes(1);
});
it('automatisk fokus og OK fra indholdet skifter ikke fane', () => {
  const select = vi.fn();
  createRailSelection(select, () => ({ type: 'select', at: Date.now() })).focus('hjem');
  createRailSelection(select, () => ({ type: 'down', at: Date.now() - 601 })).focus('hjem');
  vi.advanceTimersByTime(1000); expect(select).not.toHaveBeenCalled();
});
it('Tilbage og afmontering afbryder ogsaa det huskede valg', () => {
  const select = vi.fn(); const rail = createRailSelection(select, key);
  rail.focus('film'); rail.leave(); rail.cancel(); rail.enter();
  vi.advanceTimersByTime(1000); expect(select).not.toHaveBeenCalled();
});
