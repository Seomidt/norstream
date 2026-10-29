import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import type { StoredEpisode, StoredVodItem } from '../../storage/vod.js';
import type { Playback } from './VodDetailScreen.js';

const mocks = vi.hoisted(() => ({ item: vi.fn(), episodes: vi.fn(), watched: vi.fn(), save: vi.fn(), following: vi.fn(), newEpisodes: vi.fn(), seen: vi.fn(), players: [] as any[] }));
vi.mock('react-native', () => ({
  Platform: { isTV: true, OS: 'android' }, View: 'View', Text: 'Text', Image: 'Image', ScrollView: 'ScrollView', ActivityIndicator: 'ActivityIndicator',
  StyleSheet: { create: (styles: unknown) => styles, absoluteFill: {} },
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('../../ui/TvPressable.js', () => ({ TvPressable: 'Button' }));
vi.mock('../../storage/vod.js', async (original) => ({
  ...await original<typeof import('../../storage/vod.js')>(),
  getVodItem: mocks.item, listEpisodes: mocks.episodes, setWatched: mocks.watched, saveProgress: mocks.save,
}));
vi.mock('../../sync/vodDetails.js', () => ({ ensureVodDetails: async () => null }));
vi.mock('../../storage/followedSeries.js', async (original) => ({
  ...await original<typeof import('../../storage/followedSeries.js')>(),
  isFollowed: mocks.following, getNewEpisodes: mocks.newEpisodes, markSeriesSeen: mocks.seen,
}));
vi.mock('../../storage/settings.js', () => ({ getSubtitlePreference: async () => 'off' }));
vi.mock('../../net/doh.js', () => ({ streamSource: (uri: string) => ({ uri }) }));
vi.mock('../player/Landscape.js', () => ({ useLandscape: () => false }));
vi.mock('../player/TrackPicker.js', () => ({ TrackPicker: () => null }));
vi.mock('../player/SeekButtons.js', () => ({ SeekButtons: () => null }));
vi.mock('../player/ArchiveProgress.js', () => ({ ArchiveProgress: () => null }));
vi.mock('./SubtitleOverlay.js', () => ({ SubtitleOverlay: () => null }));
vi.mock('./externalSubtitles.js', () => ({ loadExternalSubtitles: async () => ({ kind: 'none' }) }));
vi.mock('./watchNext.js', () => ({ removeWatchNext: async () => {}, updateWatchNext: async () => {} }));
vi.mock('expo-video', async () => {
  const React = await import('react');
  return { VideoView: 'Video', useVideoPlayer: (source: { uri: string }, setup: (player: any) => void) => React.useMemo(() => {
    const listeners = new Map<string, Set<(event: any) => void>>();
    const player = {
      uri: source.uri, currentTime: 0, duration: 1800, availableSubtitleTracks: [], availableAudioTracks: [], subtitleTrack: null, audioTrack: null,
      play: vi.fn(), addListener: (name: string, callback: (event: any) => void) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(callback);
        return { remove: () => listeners.get(name)!.delete(callback) };
      },
      emit: (name: string, event = {}) => { for (const callback of [...listeners.get(name) ?? []]) callback(event); },
    };
    setup(player); mocks.players.push(player); return player;
  }, [source.uri]) };
});

import { VodDetailScreen } from './VodDetailScreen.js';
import { VodPlayerScreen } from './VodPlayerScreen.js';
const session = { db: {}, access: () => ({ creds: { baseUrl: 'https://example.test', username: 'test', password: 'test' } }) } as unknown as AppSession;
let tree: ReactTestRenderer | null = null;
const episode = (number: number, extra: Partial<StoredEpisode> = {}) => ({
  key: `source:series:1:${number}`, id: String(number), title: `Afsnit ${number}`, season: 1, episode: number, containerExtension: 'mp4',
  watched: true, positionSeconds: 1800, durationSeconds: 1800, ...extra,
}) as StoredEpisode;
const item = (extra: Partial<StoredVodItem> = {}) => ({
  key: 'source:movie:1', sourceId: 'source', id: '1', name: 'Testfilm', kind: 'movie', containerExtension: 'mp4',
  positionSeconds: null, durationSeconds: null, watched: false, year: null, rating: null, ...extra,
}) as StoredVodItem;
function text(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node) return '';
  if (Array.isArray(node)) return node.map(text).join('');
  return text(node.children ?? node.props?.children);
}
function button(label: string) { return tree!.root.findAllByType('Button' as any).find(node => text(node).includes(label))!; }
async function choose(stored: StoredVodItem, label: string): Promise<Playback> {
  mocks.item.mockResolvedValue(stored);
  const onPlay = vi.fn();
  await act(async () => { tree = create(createElement(VodDetailScreen, { session, itemKey: stored.key, onBack: vi.fn(), onPlay, onTrailer: vi.fn() })); });
  await act(async () => button(label).props.onPress());
  const playback = onPlay.mock.calls[0]![0] as Playback;
  await act(async () => { tree!.unmount(); tree = null; });
  return playback;
}
async function play(playback: Playback) {
  await act(async () => { tree = create(createElement(VodPlayerScreen, { session, playback, onBack: vi.fn() })); });
  const player = mocks.players.at(-1)!;
  await act(async () => player.emit('statusChange', { status: 'readyToPlay' }));
  return player;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.players.length = 0;
  mocks.episodes.mockResolvedValue([episode(1), episode(2), episode(3)]);
  mocks.watched.mockResolvedValue(undefined); mocks.save.mockResolvedValue(undefined);
  mocks.following.mockResolvedValue(false); mocks.newEpisodes.mockResolvedValue([]); mocks.seen.mockResolvedValue(undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount()); tree = null;
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it('afsnit 1 som er set starter ved nul og springer ikke til afsnit 2', async () => {
  const playback = await choose(item({ kind: 'series', name: 'Testserie' }), 'Afsnit 1');
  expect(playback.episodeKey).toBe(episode(1).key);
  const player = await play(playback);
  expect(player.currentTime).toBe(0);
  await act(async () => { vi.advanceTimersByTime(12_000); });
  expect(mocks.players).toHaveLength(1);
});

it('aabning af en fulgt serie bevarer nye afsnit indtil eksplicit markering', async () => {
  const stored = item({ kind: 'series', name: 'Testserie' });
  mocks.item.mockResolvedValue(stored);
  mocks.following.mockResolvedValue(true);
  mocks.newEpisodes.mockResolvedValue([{ season: 2, episode: 5, title: 'Nyt afsnit' }]);
  await act(async () => { tree = create(createElement(VodDetailScreen, {
    session, itemKey: stored.key, onBack: vi.fn(), onPlay: vi.fn(), onTrailer: vi.fn(),
  })); });
  expect(mocks.seen).not.toHaveBeenCalled();
  expect(text(tree!.toJSON())).toContain('S2 E5');
  await act(async () => button('Markér nye afsnit som læst').props.onPress());
  expect(mocks.seen).toHaveBeenCalledWith(session.db, stored.key);
  expect(mocks.watched).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(text(tree!.toJSON())).not.toContain('Markér nye afsnit som læst');
});

it.each([
  ['Se', { positionSeconds: null }, 0],
  ['Fortsæt', { positionSeconds: 600, durationSeconds: 7200 }, 600],
  ['Se igen', { watched: true, positionSeconds: 7200, durationSeconds: 7200 }, 0],
] as const)('film: %s starter korrekt og gemmer fremdrift ved tilbage', async (label, progress, expected) => {
  const playback = await choose(item(progress), label);
  const player = await play(playback);
  expect(player.currentTime).toBe(expected);
  player.currentTime = expected + 120;
  await act(async () => player.emit('timeUpdate', { currentTime: player.currentTime }));
  await act(async () => { tree!.unmount(); tree = null; });
  expect(mocks.save).toHaveBeenCalledWith(session.db, playback.progressKey, expected + 120, 1800);
});

it('naeste allerede sete afsnit starter ogsaa fra begyndelsen efter en rigtig afslutning', async () => {
  const playback = await choose(item({ kind: 'series' }), 'Afsnit 1');
  const first = await play(playback);
  first.currentTime = 1800;
  await act(async () => { first.emit('timeUpdate', { currentTime: 1800 }); first.emit('playToEnd'); });
  expect(button('Afspil nu')).toBeDefined();
  await act(async () => button('Afspil nu').props.onPress());
  const second = mocks.players.at(-1)!;
  await act(async () => second.emit('statusChange', { status: 'readyToPlay' }));
  expect(second.uri).toContain('/2.mp4');
  expect(second.currentTime).toBe(0);
});

it('et uafsluttet afsnit fortsaetter hvor man slap', async () => {
  mocks.episodes.mockResolvedValue([episode(1, { watched: false, positionSeconds: 600 })]);
  const playback = await choose(item({ kind: 'series' }), 'Afsnit 1');
  expect((await play(playback)).currentTime).toBe(600);
});

it.each(['movie', 'series'] as const)('%s: en for tidlig slutmelding springer aldrig videre eller markerer set', async (kind) => {
  const playback = await choose(item({ kind }), kind === 'movie' ? '▶ Se' : 'Afsnit 1');
  const player = await play(playback);
  await act(async () => player.emit('playToEnd'));
  expect(mocks.watched).not.toHaveBeenCalled();
  expect(button('Afspil nu')).toBeUndefined();
  await act(async () => { vi.advanceTimersByTime(12_000); });
  expect(mocks.players).toHaveLength(1);
});

it('en faerdig film markerer set uden at starte en anden titel', async () => {
  const playback = await choose(item(), '▶ Se');
  const player = await play(playback);
  player.currentTime = player.duration;
  await act(async () => player.emit('playToEnd'));
  expect(mocks.watched).toHaveBeenCalledWith(session.db, playback.progressKey, true);
  expect(button('Afspil nu')).toBeUndefined();
});

it('en forkert gemt position efter den native slutning bliver ikke brugt eller gemt igen', async () => {
  const playback = await choose(item({ positionSeconds: 2000, durationSeconds: 7200 }), 'Fortsæt');
  const player = await play(playback);
  expect(player.currentTime).toBe(0);
  await act(async () => { tree!.unmount(); tree = null; });
  expect(mocks.save).not.toHaveBeenCalled();
});

it('automatisk naeste afsnit venter ti sekunder og genafspiller et set afsnit fra nul', async () => {
  const playback = await choose(item({ kind: 'series' }), 'Afsnit 1');
  const player = await play(playback);
  player.currentTime = player.duration;
  await act(async () => player.emit('playToEnd'));
  for (let seconds = 0; seconds < 9; seconds++) await act(async () => { vi.advanceTimersByTime(1000); });
  expect(mocks.players).toHaveLength(1);
  await act(async () => { vi.advanceTimersByTime(1000); });
  const second = mocks.players.at(-1)!;
  await act(async () => second.emit('statusChange', { status: 'readyToPlay' }));
  expect(mocks.players).toHaveLength(2);
  expect(second.uri).toContain('/2.mp4');
  expect(second.currentTime).toBe(0);
});
