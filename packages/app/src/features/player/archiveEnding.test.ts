import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';

// Native afspilning er daekket af playbackConnection.test. Her afproeves
// skaermens rigtige EOF-lyttere, kildevalg, genforsoeg og unmount med TV2-loggen.
const f = vi.hoisted(() => ({
  listeners: new Map<string, Set<(value: any) => void>>(),
  requests: [] as Array<{ from: Date; minutes: number }>,
  loads: [] as Array<{ source: unknown; seek: number }>,
  setting: vi.fn(async () => 'php'),
  player: {
    currentTime: 0, bufferedPosition: 90, duration: 1020, playing: true,
    status: 'readyToPlay', playbackRate: 1, volume: 1, muted: false,
    availableAudioTracks: [{ id: 'audio' }], audioTrack: { id: 'audio' },
    availableVideoTracks: [{ id: 'video' }], videoTrack: { id: 'video' },
    availableSubtitleTracks: [], subtitleTrack: null,
    addListener: (event: string, fn: (value: any) => void) => {
      let entries = f.listeners.get(event);
      if (entries === undefined) { entries = new Set(); f.listeners.set(event, entries); }
      entries.add(fn);
      return { remove: () => entries!.delete(fn) };
    },
    play: () => { f.player.playing = true; },
    pause: () => { f.player.playing = false; },
  },
}));
vi.mock('react-native', () => ({
  Platform: { isTV: true, OS: 'android' }, StyleSheet: { create: (v: unknown) => v, absoluteFill: {} },
  View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
  useWindowDimensions: () => ({ width: 864, height: 486 }), useTVEventHandler: () => {},
}));
vi.mock('expo-video', () => ({ VideoView: 'VideoView', useVideoPlayer: () => f.player }));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('expo-keep-awake', () => ({ useKeepAwake: () => {} }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('@norstream/core', async (importOriginal) => ({
  ...await importOriginal<typeof import('@norstream/core')>(),
  detectTimeshiftDialect: vi.fn(),
  buildTimeshiftUrl: (_creds: unknown, _id: unknown, from: Date, minutes: number) => {
    f.requests.push({ from, minutes });
    return `https://example.invalid/archive/${f.requests.length}.ts`;
  },
}));
vi.mock('./playbackConnection.js', () => ({ PlaybackConnection: class {
  committed = true; prepared = true; active = true; seeking = false; preparationPhase = 'klar';
  async load(source: unknown, _archive: boolean, seek = 0) {
    f.loads.push({ source, seek }); f.player.currentTime = seek; f.player.status = 'readyToPlay';
  }
  position() { return true; }
  sourceLoaded() { return true; }
  status() {} cancel() {} dispose() {} setPlayingIntent() {}
} }));
vi.mock('../../storage/settings.js', () => ({
  getTimeshiftDialect: () => f.setting(),
  getPanelOffsetMinutes: async () => 120, getSubtitlePreference: async () => null,
  setTimeshiftDialect: async () => {}, setLastChannelId: async () => {},
}));
vi.mock('../../storage/programmes.js', () => ({ getNowNext: async () => ({ now: null, next: null }) }));
vi.mock('../../storage/channels.js', () => ({ listChannels: async () => [] }));
vi.mock('../../storage/history.js', () => ({ recordChannelWatch: async () => {}, saveArchiveProgress: async () => {} }));
vi.mock('../../sync/epgCache.js', () => ({ ensureEpg: async () => {} }));
vi.mock('../../sources/access.js', () => ({ liveUrlFor: () => 'https://example.invalid/live.ts' }));
vi.mock('../../net/doh.js', () => ({ streamSource: (source: string) => source }));
vi.mock('../../diagnostics/reporter.js', () => ({ setPlaybackSnapshot: () => {}, closePlaybackSnapshot: () => {} }));
vi.mock('../../diagnostics/log.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../diagnostics/log.js')>(), logEvent: () => {}, clockOf: () => 'tid',
}));
vi.mock('../../ui/ChannelLogo.js', () => ({ ChannelLogo: () => null }));
vi.mock('./ChannelOverlay.js', () => ({ ChannelOverlay: () => null }));
vi.mock('./TrackPicker.js', () => ({ TrackPicker: () => null }));
vi.mock('./RadioView.js', () => ({ RadioView: () => null }));
vi.mock('./useRadioNowPlaying.js', () => ({ useRadioNowPlaying: () => null }));
vi.mock('../radio/useSaveSong.js', () => ({ useSaveSong: () => null }));

import { PlayerScreen } from './PlayerScreen.js';
import { ArchiveEnd } from './ArchiveEnd.js';
import { LandscapePlayer } from './Landscape.js';

const at = (time: string) => new Date(`2026-10-16T${time}Z`);
const news = { channelId: 'tv2', title: '18-Nyhederne', description: null, start: at('18:00:00'), stop: at('18:20:00') };
const access = { creds: {} };
const session = { db: {}, access: () => access } as unknown as AppSession;
const channel = { id: 'tv2', sourceId: 'test', streamId: 'tv2', name: 'TV 2', logoUrls: [], hasArchive: true } as unknown as StoredChannel;
let tree: ReactTestRenderer | null;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(at('18:19:08.546'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  f.requests.length = 0; f.loads.length = 0; f.listeners.clear();
  f.player.currentTime = 0; f.player.status = 'readyToPlay'; f.player.playing = true;
  f.setting.mockReset().mockResolvedValue('php');
  tree = null;
});
afterEach(async () => {
  if (tree !== null) await act(async () => tree!.unmount());
  expect([...f.listeners.values()].every(entries => entries.size === 0)).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals(); vi.useRealTimers();
});
const mount = async () => act(async () => { tree = create(createElement(PlayerScreen, { session, channel, startFrom: news, onBack: () => {} })); });
async function end(position: number, now: string) {
  vi.setSystemTime(at(now));
  await act(async () => {
    f.player.currentTime = position; f.player.status = 'idle'; f.player.playing = false;
    for (const fn of [...f.listeners.get('playToEnd') ?? []]) fn(undefined);
  });
}

describe('TV2: igangvaerende udsendelse slutter under forsinket afspilning', () => {
  it('henter afslutningen fra samme punkt, viser slutvalg og forlaenger kun ved tryk', async () => {
    await mount();
    expect(f.requests[0]).toEqual({ from: news.start, minutes: 17 });
    await end(1020.379, '18:36:10.171');
    expect(f.requests[1]).toEqual({ from: at('18:17:00'), minutes: 8 });
    expect(f.loads[1]!.seek).toBeCloseTo(0.379);
    await end(179.340, '18:39:08.451');
    expect(f.requests[2]).toEqual({ from: at('18:19:00'), minutes: 6 });
    expect(f.loads[2]!.seek).toBeCloseTo(59.34);
    expect(tree!.root.findAllByType(ArchiveEnd)).toHaveLength(0);
    await end(359.34, '18:44:08.451');
    expect(tree!.root.findByType(LandscapePlayer).props.suspended).toBe(true);
    expect(f.player.playing).toBe(false);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    expect(f.loads).toHaveLength(3);
    await act(async () => tree!.root.findByType(ArchiveEnd).props.onContinue());
    expect(f.requests[3]).toEqual({ from: at('18:24:00'), minutes: 6 });
    expect(f.loads[3]!.seek).toBeCloseTo(59.34);
    expect(tree!.root.findAllByType(ArchiveEnd)).toHaveLength(0);
    await end(359.34, '18:50:08.451');
    await act(async () => tree!.root.findByType(ArchiveEnd).props.onLive());
    expect(f.loads.at(-1)!.source).toBe('https://example.invalid/live.ts');
    expect(f.requests).toHaveLength(4);
    expect(tree!.root.findAllByType(ArchiveEnd)).toHaveLength(0);
  });

  it('aabner ikke en sen arkivfortsaettelse efter brugeren er gaaet tilbage', async () => {
    await mount();
    let resolve!: (value: string) => void;
    f.setting.mockImplementation(() => new Promise<string>(done => { resolve = done; }));
    await end(1020.379, '18:36:10.171');
    await act(async () => tree!.unmount()); tree = null;
    await act(async () => resolve('php'));
    expect(f.requests).toHaveLength(1);
    expect(f.loads).toHaveLength(1);
  });
});
