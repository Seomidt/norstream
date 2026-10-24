import { createElement, type ElementType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import type { Playback } from './VodDetailScreen.js';

const f = vi.hoisted(() => ({
  key: null as null | ((event: Record<string, unknown>) => void),
  listeners: new Map<string, Set<(event: any) => void>>(),
  duration: 2700, released: false,
  player: {
    currentTime: 754, playing: true,
    get duration() { if (f.released) throw new Error('released'); return f.duration; },
    availableSubtitleTracks: [], availableAudioTracks: [], subtitleTrack: null, audioTrack: null,
    play: vi.fn(), pause: vi.fn(), seekBy: vi.fn(),
    addListener: (event: string, handler: (value: any) => void) => {
      let entries = f.listeners.get(event);
      if (entries === undefined) { entries = new Set(); f.listeners.set(event, entries); }
      entries.add(handler); return { remove: () => entries!.delete(handler) };
    },
  },
}));
vi.mock('react-native', () => ({
  Platform: { isTV: true, OS: 'android' }, StyleSheet: { create: (s: unknown) => s, absoluteFill: {} },
  View: 'View', Text: 'Text', Pressable: 'Pressable',
  useWindowDimensions: () => ({ width: 864, height: 486 }),
  useTVEventHandler: (handler: typeof f.key) => { f.key = handler; },
}));
vi.mock('expo-video', () => ({ VideoView: 'VideoView', useVideoPlayer: () => f.player }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../../net/doh.js', () => ({ streamSource: (url: string) => url }));
vi.mock('../../storage/settings.js', () => ({ getSubtitlePreference: async () => 'off' }));
vi.mock('../../storage/vod.js', () => ({
  getVodItem: async () => null, listEpisodes: async () => [], saveProgress: async () => {}, setWatched: async () => {},
}));
vi.mock('../../sync/tmdb.js', () => ({ cleanVodTitle: () => ({ title: '' }) }));
vi.mock('./watchNext.js', () => ({ removeWatchNext: async () => {}, updateWatchNext: async () => {} }));
vi.mock('./externalSubtitles.js', () => ({ loadExternalSubtitles: async () => ({ kind: 'none' }) }));
vi.mock('./SubtitleOverlay.js', () => ({ SubtitleOverlay: () => null }));
vi.mock('../player/TrackPicker.js', () => ({ TrackPicker: () => null }));

import { VodPlayerScreen } from './VodPlayerScreen.js';
let tree: ReactTestRenderer | null = null;
const playback: Playback = {
  url: 'https://example.invalid/movie.mp4', title: 'Film', subtitle: null,
  sourceId: 'source', progressKey: 'movie', seriesKey: null, episodeKey: null, resumeAtSeconds: null,
};
const session = { db: {} } as AppSession;
const text = () => tree!.root.findAllByType('Text' as ElementType).map(n => n.children.join('')).join(' · ');
const key = (eventType: string) => act(async () => f.key!({ eventType, eventKeyAction: 1 }));
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  f.listeners.clear(); f.key = null; f.duration = 2700; f.released = false;
  f.player.currentTime = 754; f.player.playing = true;
  f.player.pause.mockClear(); f.player.play.mockClear(); f.player.seekBy.mockClear();
});
afterEach(async () => {
  if (tree !== null) await act(async () => tree!.unmount());
  tree = null;
  expect([...f.listeners.values()].every(v => v.size === 0)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it.each(['film', 'serieafsnit'])('OK viser tid for %s uden at pause og foelger native spoling', async kind => {
  const input = kind === 'film' ? playback : { ...playback, progressKey: 'episode', seriesKey: 'series', episodeKey: 'episode' };
  await act(async () => { tree = create(createElement(VodPlayerScreen, { session, playback: input, onBack: () => {} })); });
  expect(text()).not.toContain('tilbage');
  await key('select');
  expect(text()).toContain('12:34 / 45:00 · 32:26 tilbage');
  expect(f.player.pause).not.toHaveBeenCalled();
  f.player.currentTime = 1200;
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(text()).toContain('20:00 / 45:00 · 25:00 tilbage');
  await key('playPause'); expect(f.player.pause).toHaveBeenCalledOnce();
  await act(async () => { vi.advanceTimersByTime(10_000); });
  expect(text()).not.toContain('tilbage');
});

it('venter paa filens varighed og taaler at den native afspiller frigives', async () => {
  f.duration = 0;
  await act(async () => { tree = create(createElement(VodPlayerScreen, { session, playback, onBack: () => {} })); });
  await key('select');
  expect(text()).not.toContain('tilbage');
  f.duration = 2700;
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(text()).toContain('32:26 tilbage');
  f.released = true;
  await act(async () => { vi.advanceTimersByTime(1000); });
  expect(text()).not.toContain('tilbage');
});
