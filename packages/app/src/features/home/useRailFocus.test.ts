import { createElement } from 'react';
import type { RefObject } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRailFocus } from './useRailFocus.js';

let tree: ReactTestRenderer | null = null;
let focus: ReturnType<typeof useRailFocus>;
const request = vi.fn();
const target: RefObject<{ requestTVFocus(): void } | null> = { current: null };
function Screen({ enabled = true }: { enabled?: boolean }) {
  focus = useRailFocus(enabled, target);
  return null;
}
async function render(enabled = true) {
  await act(async () => {
    const screen = createElement(Screen, { enabled });
    if (tree === null) tree = create(screen);
    else tree.update(screen);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  request.mockReset();
  target.current = { requestTVFocus: request };
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
});
afterEach(async () => {
  if (tree !== null) await act(async () => tree!.unmount());
  tree = null;
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('Tilbage gentager et overset native fokus indtil menuen bekraefter det', async () => {
  await render();
  expect(request).not.toHaveBeenCalled();
  await act(async () => {
    focus.request();
    // Foerste native kommando sker i samme Back-handler, uden at flytte uret.
    expect(request).toHaveBeenCalledTimes(1);
  });
  // Android kan stadig vaere ved at frigive guidens fokuserede raekke.
  await act(async () => { vi.advanceTimersByTime(300); });
  expect(request).toHaveBeenCalledTimes(4);
  expect(focus.pending).toBe(true);
  await act(async () => focus.confirm());
  expect(focus.pending).toBe(false);
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(request).toHaveBeenCalledTimes(4);
});

it('menuens native knap maa blive klar efter den foerste tegning', async () => {
  target.current = null;
  await render();
  await act(async () => focus.request());
  await act(async () => { vi.advanceTimersByTime(16); });
  target.current = { requestTVFocus: request.mockImplementation(() => focus.confirm()) };
  await act(async () => { vi.advanceTimersByTime(150); });
  expect(request).toHaveBeenCalledTimes(1);
  expect(focus.pending).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('et mislykket fokusforsoeg udloeber og kan proeves igen med Tilbage', async () => {
  await render();
  await act(async () => focus.request());
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(focus.pending).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  request.mockClear();
  await act(async () => focus.request());
  expect(request).toHaveBeenCalledTimes(1);
});

it('en frigivet native knap maa ikke stoppe det naeste fokusforsoeg', async () => {
  request.mockImplementationOnce(() => { throw new Error('released view'); });
  await render();
  await act(async () => focus.request());
  request.mockImplementation(() => focus.confirm());
  await act(async () => { vi.advanceTimersByTime(150); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(focus.pending).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
});

it('en daekket skaerm stopper fokusforsoeg og gentager ikke et gammelt Tilbage', async () => {
  await render();
  await act(async () => focus.request());
  expect(request).toHaveBeenCalledTimes(1);
  await render(false);
  expect(focus.pending).toBe(false);
  expect(vi.getTimerCount()).toBe(0);
  request.mockClear();
  await act(async () => focus.request());
  await render();
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(request).not.toHaveBeenCalled();
  expect(focus.pending).toBe(false);
});

it('bekraeftet fokus stopper alle gentagelser foer en efterfoelgende tegning', async () => {
  request.mockImplementation(() => focus.confirm());
  await render();
  await act(async () => {
    focus.request();
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  await render();
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(request).toHaveBeenCalledTimes(1);
  expect(focus.pending).toBe(false);
});
