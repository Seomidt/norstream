import { createElement, type ElementType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const events = vi.hoisted(() => ({ key: null as null | ((event: Record<string, unknown>) => void) }));
vi.mock('react-native', () => ({
  Platform: { isTV: true, OS: 'android' }, StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
  View: 'View', Text: 'Text', Pressable: 'Pressable',
  useWindowDimensions: () => ({ width: 864, height: 486 }),
  useTVEventHandler: (handler: (event: Record<string, unknown>) => void) => { events.key = handler; },
}));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { ArchiveProgress } from './ArchiveProgress.js';
import { LandscapePlayer } from './Landscape.js';

let tree: ReactTestRenderer | null = null;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  if (tree !== null) await act(async () => tree!.unmount());
  tree = null;
  events.key = null;
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function text(): string {
  return tree!.root.findAllByType('Text' as ElementType).map((node) => node.children.join('')).join(' · ');
}
describe('OK viser arkivtid uden at pause', () => {
  it('viser tidslinjen paa keyup, bevarer afspilning og skjuler igen efter ti sekunder', async () => {
    const playerKey = vi.fn(() => true);
    const read = vi.fn(() => ({ elapsed: 754, duration: 2700, remaining: 1946 }));
    await act(async () => {
      tree = create(createElement(LandscapePlayer, {
        video: null, playing: false, initialBarShown: false, selectShowsControls: true,
        bar: createElement(ArchiveProgress, { read }), onPlayerKey: playerKey,
      }));
    });
    await act(async () => events.key!({ eventType: 'select', eventKeyAction: 0 }));
    expect(tree!.root.findAllByType(ArchiveProgress)).toHaveLength(0);
    await act(async () => events.key!({ eventType: 'select', eventKeyAction: 1 }));
    expect(text()).toBe('12:34 / 45:00 · 32:26 tilbage');
    expect(playerKey).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(tree!.root.findAllByType(ArchiveProgress)).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(4999); });
    expect(tree!.root.findAllByType(ArchiveProgress)).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(tree!.root.findAllByType(ArchiveProgress)).toHaveLength(0);
    const reads = read.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(read).toHaveBeenCalledTimes(reads);
  });
  it('opdaterer tiden fra afspilningsuret og bevarer den mens afspilleren er pauset', async () => {
    let elapsed = 754;
    const read = () => ({ elapsed, duration: 2700, remaining: 2700 - elapsed });
    await act(async () => { tree = create(createElement(ArchiveProgress, { read })); });
    elapsed = 755;
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(text()).toBe('12:35 / 45:00 · 32:25 tilbage');
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(text()).toBe('12:35 / 45:00 · 32:25 tilbage');
  });
  it('medietasten kan stadig pause, og live beholder sin tidligere OK-handling', async () => {
    const playerKey = vi.fn(() => true);
    await act(async () => { tree = create(createElement(LandscapePlayer, { video: null, bar: null, playing: false, initialBarShown: false, onPlayerKey: playerKey })); });
    await act(async () => events.key!({ eventType: 'select', eventKeyAction: 1 }));
    expect(playerKey).toHaveBeenCalledWith('select');
    await act(async () => events.key!({ eventType: 'playPause', eventKeyAction: 1 }));
    expect(playerKey).toHaveBeenCalledWith('playPause');
  });
});
