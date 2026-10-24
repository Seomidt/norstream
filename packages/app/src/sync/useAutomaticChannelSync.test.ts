import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: 'active', listeners: new Set<(state: string) => void>(), log: vi.fn() }));
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return mocks.state; },
  addEventListener: (_name: string, callback: (state: string) => void) => {
    mocks.listeners.add(callback);
    return { remove: () => mocks.listeners.delete(callback) };
  },
} }));
vi.mock('../diagnostics/log.js', () => ({ logEvent: mocks.log }));
import { CHANNEL_SYNC_CHECK_MS, useAutomaticChannelSync } from './useAutomaticChannelSync.js';
function Host({ refresh, enabled = true }: { refresh: () => Promise<void>; enabled?: boolean }) {
  useAutomaticChannelSync(refresh, enabled);
  return null;
}
let tree: ReactTestRenderer | null = null;
async function mount(refresh: () => Promise<void>, enabled = true) {
  await act(async () => { tree = create(createElement(Host, { refresh, enabled })); });
}
async function state(next: string) {
  await act(async () => { mocks.state = next; for (const f of mocks.listeners) f(next); });
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.state = 'active'; mocks.listeners.clear(); mocks.log.mockClear();
});
afterEach(async () => {
  if (tree !== null) await act(async () => tree!.unmount());
  tree = null;
  expect(mocks.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.unstubAllGlobals();
});
describe('automatic channel metadata', () => {
  it('tjekker ved start og loebende uden en ny app-start', async () => {
    const refresh = vi.fn(async () => {});
    await mount(refresh); expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(CHANNEL_SYNC_CHECK_MS); });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('venter i baggrunden og tjekker igen naar appen kommer frem', async () => {
    const refresh = vi.fn(async () => {});
    await mount(refresh); await state('background');
    await act(async () => { vi.advanceTimersByTime(CHANNEL_SYNC_CHECK_MS * 2); });
    expect(refresh).toHaveBeenCalledTimes(1);
    await state('active'); expect(refresh).toHaveBeenCalledTimes(2);
  });
  it('aabner ingen opdatering mens afspilleren daekker Hjem', async () => {
    const refresh = vi.fn(async () => {});
    await mount(refresh, false); expect(refresh).not.toHaveBeenCalled();
    await act(async () => tree!.update(createElement(Host, { refresh, enabled: true })));
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => tree!.update(createElement(Host, { refresh, enabled: false })));
    await state('active'); await act(async () => { vi.advanceTimersByTime(CHANNEL_SYNC_CHECK_MS); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
  it('resume og interval maa ikke starte en ekstra samtidig hentning', async () => {
    let finish!: () => void;
    const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    await mount(refresh); await state('active');
    await act(async () => { vi.advanceTimersByTime(CHANNEL_SYNC_CHECK_MS); });
    expect(refresh).toHaveBeenCalledTimes(1);
    await act(async () => finish()); await state('active');
    expect(refresh).toHaveBeenCalledTimes(2);
    await act(async () => finish());
  });
  it('en netfejl stopper ikke senere automatiske kontroller', async () => {
    const refresh = vi.fn().mockRejectedValueOnce(new Error('test')).mockResolvedValue(undefined);
    await mount(refresh); expect(mocks.log).toHaveBeenCalled();
    await state('active'); expect(refresh).toHaveBeenCalledTimes(2);
  });
});
