import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
const f = vi.hoisted(() => ({ list: vi.fn(), acknowledge: vi.fn(), unfollow: vi.fn(), open: vi.fn(), scroll: vi.fn() }));
vi.mock('react-native', async () => {
  const React = await import('react');
  return { Platform: { isTV: true, OS: 'android' }, StyleSheet: { create: (v: unknown) => v },
    Text: 'Text', View: 'View', Image: 'Image', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
    AppState: { addEventListener: () => ({ remove() {} }) }, useWindowDimensions: () => ({ width: 864, height: 486 }),
    FlatList: React.forwardRef(function List(props: any, ref) {
      React.useImperativeHandle(ref, () => ({ scrollToIndex: f.scroll, scrollToOffset: f.scroll }));
      return React.createElement('List', {}, props.data.length === 0 ? props.ListEmptyComponent : props.data.map((item: any, index: number) => React.createElement('Row', { key: item.series.key }, props.renderItem({ item, index }))));
    }),
  };
});
vi.mock('../../storage/followedSeries.js', async (original) => ({ ...await original<typeof import('../../storage/followedSeries.js')>(), listFollowedSeries: f.list, markSeriesSeen: f.acknowledge, unfollowSeries: f.unfollow }));
import { FollowedSeriesScreen } from './FollowedSeriesScreen.js';
import { TvPressable } from '../../ui/TvPressable.js';
const series = { key: 's:series', name: 'En serie', posterUrl: null, foundPosterUrl: null };
const entry = { series, followedMs: 1, episodes: 5, seenEpisodes: 4, newCount: 1, newEpisodes: [{ season: 2, episode: 5, title: 'Nyt' }] };
const session = { db: {} } as AppSession;
let tree: ReactTestRenderer | null = null;
const text = (node: any): string => typeof node === 'string' ? node : !node ? '' : Array.isArray(node) ? node.map(text).join('') : text(node.children ?? node.props?.children);
const button = (label: string) => tree!.root.findAllByType(TvPressable).find(node => text(node) === label)!;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  f.list.mockResolvedValue([entry]); f.acknowledge.mockResolvedValue(undefined); f.unfollow.mockResolvedValue(undefined);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount()); tree = null;
  expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.unstubAllGlobals();
});
const mount = () => act(async () => { tree = create(createElement(FollowedSeriesScreen, { session, active: true, onOpen: f.open })); });

it('viser det konkrete nye afsnit; aabning af serien kvitterer ikke for det', async () => {
  await mount();
  expect(text(tree!.toJSON())).toContain('S2 E5 · 1 nyt afsnit');
  const open = tree!.root.findAllByType(TvPressable)[0]!;
  await act(async () => open.props.onPress());
  expect(f.open).toHaveBeenCalledWith(series); expect(f.acknowledge).not.toHaveBeenCalled();
  await act(async () => open.props.onFocus());
  expect(f.scroll).toHaveBeenCalledWith({ index: 0, viewPosition: 0.5, animated: false });
});

it('kun eksplicit Markér nye som laest rydder markeringen', async () => {
  await mount();
  f.list.mockResolvedValue([{ ...entry, newCount: 0, newEpisodes: [] }]);
  await act(async () => button('Markér nye som læst').props.onPress());
  expect(f.acknowledge).toHaveBeenCalledWith(session.db, series.key);
  expect(button('Markér nye som læst')).toBeUndefined();
  expect(text(tree!.toJSON())).toContain('Ingen nye afsnit');
});

it('Stop med at foelge opdaterer oversigten', async () => {
  await mount(); f.list.mockResolvedValue([]);
  await act(async () => button('Stop med at følge').props.onPress());
  expect(f.unfollow).toHaveBeenCalledWith(session.db, series.key);
  expect(text(tree!.toJSON())).toContain('Du følger ingen serier endnu.');
});
