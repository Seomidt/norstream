import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const listeners = vi.hoisted(() => new Set<(state: string) => void>());
vi.mock('react-native', () => ({ AppState: { addEventListener: (_name: string, callback: (state: string) => void) => {
  listeners.add(callback); return { remove: () => listeners.delete(callback) };
} } }));
import { useVodShelfRefresh } from './useVodShelfRefresh.js';
function Host({ load, active, token = 0 }: { load: () => Promise<void>; active: boolean; token?: number }) {
  useVodShelfRefresh(load, active, token); return null;
}
let tree: ReactTestRenderer | null = null;
beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true));
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = null; expect(listeners.size).toBe(0); vi.unstubAllGlobals(); });
describe('lokale filmhylder', () => {
  it('genlaeser ved tilbagekomst fra titel, cloud-aendring og app-resume', async () => {
    const load = vi.fn(async () => {});
    await act(async () => { tree = create(createElement(Host, { load, active: true })); });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => tree!.update(createElement(Host, { load, active: false })));
    expect(listeners.size).toBe(0);
    await act(async () => tree!.update(createElement(Host, { load, active: true })));
    expect(load).toHaveBeenCalledTimes(2);
    await act(async () => tree!.update(createElement(Host, { load, active: true, token: 1 })));
    expect(load).toHaveBeenCalledTimes(3);
    await act(async () => { for (const callback of listeners) callback('background'); });
    expect(load).toHaveBeenCalledTimes(3);
    await act(async () => { for (const callback of listeners) callback('active'); });
    expect(load).toHaveBeenCalledTimes(4);
  });
  it('taaler et fejlet opslag og proever igen ved resume', async () => {
    const load = vi.fn(async () => { throw new Error('database'); });
    await act(async () => { tree = create(createElement(Host, { load, active: true })); });
    await act(async () => { for (const callback of listeners) callback('active'); });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
