import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../session.js';
const f = vi.hoisted(() => ({ refresh: vi.fn(), changed: vi.fn(), state: null as null | ((state: string) => void), remove: vi.fn() }));
vi.mock('react-native', () => ({ AppState: { currentState: 'active', addEventListener: (_: string, callback: (state: string) => void) => { f.state = callback; return { remove: f.remove }; } } }));
vi.mock('./vodDetails.js', () => ({ refreshFollowedSeries: f.refresh }));
import { useFollowedSeriesRefresh } from './useFollowedSeriesRefresh.js';
const session = { db: {}, sources: [{ source: { id: 'source', kind: 'xtream' }, creds: {} }], fetchImpl: vi.fn() } as unknown as AppSession;
function Screen({ enabled }: { enabled: boolean }) { useFollowedSeriesRefresh(session, enabled, f.changed); return null; }
let tree: ReactTestRenderer | null = null;
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); f.refresh.mockResolvedValue(1); f.state = null; vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); });
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = null; expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('kontrollerer ved start og resume men ikke i baggrunden eller efter lukning', async () => {
  await act(async () => { tree = create(createElement(Screen, { enabled: true })); });
  expect(f.refresh).toHaveBeenCalledTimes(1); expect(f.changed).toHaveBeenCalledTimes(1);
  await act(async () => { f.state!('background'); vi.advanceTimersByTime(30 * 60_000); });
  expect(f.refresh).toHaveBeenCalledTimes(1);
  await act(async () => f.state!('active'));
  expect(f.refresh).toHaveBeenCalledTimes(2);
  await act(async () => tree!.update(createElement(Screen, { enabled: false })));
  await act(async () => { vi.advanceTimersByTime(60 * 60_000); });
  expect(f.refresh).toHaveBeenCalledTimes(2); expect(f.remove).toHaveBeenCalled();
});

it('samtidige resume-haendelser starter ikke parallelle kildekald', async () => {
  let finish!: (n: number) => void;
  f.refresh.mockImplementation(() => new Promise<number>(resolve => { finish = resolve; }));
  await act(async () => { tree = create(createElement(Screen, { enabled: true })); });
  await act(async () => { f.state!('active'); f.state!('active'); });
  expect(f.refresh).toHaveBeenCalledTimes(1);
  await act(async () => finish(0)); expect(f.changed).not.toHaveBeenCalled();
});
