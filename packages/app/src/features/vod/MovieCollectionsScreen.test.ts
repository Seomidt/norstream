import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';

const f = vi.hoisted(() => ({ list: vi.fn(), items: vi.fn(), discover: vi.fn(), pick: vi.fn(), open: vi.fn(), scroll: vi.fn() }));
vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Platform: { isTV: true, OS: 'android' }, StyleSheet: { create: (v: unknown) => v },
    View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
    useWindowDimensions: () => ({ width: 864, height: 486 }),
    FlatList: React.forwardRef(function List(props: any, ref) {
      React.useImperativeHandle(ref, () => ({ scrollToIndex: f.scroll, scrollToOffset: f.scroll }));
      return React.createElement('List', {}, ...props.data.map((item: any, index: number) => React.createElement('Row', { key: item.key }, props.renderItem({ item, index }))));
    }),
  };
});
vi.mock('../../storage/settings.js', () => ({ getTmdbApiKey: async () => 'key' }));
vi.mock('../../storage/movieCollections.js', () => ({ listMovieCollections: f.list, listMovieCollectionItems: f.items }));
vi.mock('../../sync/movieCollections.js', () => ({ discoverMovieCollections: f.discover }));
vi.mock('../../sync/tmdb.js', () => ({ tmdbFetch: vi.fn() }));
import { MovieCollectionsScreen } from './MovieCollectionsScreen.js';
import { TvPressable } from '../../ui/TvPressable.js';

const collection = { id: 7, name: 'Samling', posterUrl: null, available: 2 };
const movie = { key: 'source:movie-1', name: 'Film i pakken', posterUrl: null, foundPosterUrl: null, year: 2000 };
const session = { db: {} } as AppSession;
const props = { session, collectionId: null, onCollection: f.pick, onOpen: f.open, active: true, reloadToken: 0 };
let tree: ReactTestRenderer | null = null;
function text(node: any): string { return typeof node === 'string' ? node : !node ? '' : Array.isArray(node) ? node.map(text).join('') : text(node.children ?? node.props?.children); }
const button = (label: string) => tree!.root.findAllByType(TvPressable).find(node => text(node) === label)!;
const card = (label: string) => tree!.root.findAllByType(TvPressable).find(node => node.props.accessibilityLabel === label)!;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  f.list.mockResolvedValue([collection]); f.items.mockResolvedValue([movie]);
  f.discover.mockResolvedValue({ looked: 0, changed: 0, remaining: false, failed: false });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = null; expect(vi.getTimerCount()).toBe(0); vi.unstubAllGlobals(); vi.useRealTimers();
});
const mount = () => act(async () => { tree = create(createElement(MovieCollectionsScreen, props)); });

it('viser cachede samlinger med antal egne film og sender valget til den rigtige samling', async () => {
  await mount();
  const item = card('Samling, 2 film i pakken');
  expect(item.props.hasTVPreferredFocus).toBe(true);
  await act(async () => item.props.onPress()); expect(f.pick).toHaveBeenCalledWith(7);
  await act(async () => item.props.onFocus()); expect(f.scroll).toHaveBeenCalledWith({ index: 0, viewPosition: 0.5, animated: false });
  await act(async () => { vi.advanceTimersByTime(16); });
  expect(card('Samling, 2 film i pakken').props.hasTVPreferredFocus).toBe(false);
});

it('samlingens lokale film aabnes uden nye generelle katalogopslag paa nettet', async () => {
  await act(async () => { tree = create(createElement(MovieCollectionsScreen, { ...props, collectionId: 7 })); });
  expect(f.discover).not.toHaveBeenCalled();
  await act(async () => card('Film i pakken, 2000').props.onPress());
  expect(f.open).toHaveBeenCalledWith(movie);
});

it('begrænser baggrundsarbejde og giver et synligt valg om at finde flere samlinger', async () => {
  f.discover.mockResolvedValue({ looked: 8, changed: 0, remaining: true, failed: false });
  await mount(); expect(f.discover).toHaveBeenCalledTimes(3);
  expect(button('Find flere samlinger')).toBeDefined();
  expect(button('Find flere samlinger').props.hasTVPreferredFocus).toBe(false);
  await act(async () => button('Find flere samlinger').props.onPress());
  expect(f.discover).toHaveBeenCalledTimes(6);
});

it('et netproblem bevarer de cachede samlinger og kan forsoeges igen', async () => {
  f.discover.mockResolvedValue({ looked: 0, changed: 0, remaining: false, failed: true });
  await mount();
  expect(card('Samling, 2 film i pakken')).toBeDefined();
  expect(button('Kunne ikke opdatere samlinger. Prøv igen')).toBeDefined();
});

it('afgang annullerer naeste metadatakald og en skjult fane starter ikke opslag', async () => {
  let resolve!: (value: unknown) => void;
  f.discover.mockImplementation(() => new Promise(done => { resolve = done; }));
  await mount();
  const options = f.discover.mock.calls[0]![3];
  expect(options.isCancelled()).toBe(false);
  await act(async () => { tree!.unmount(); tree = null; });
  expect(options.isCancelled()).toBe(true);
  await act(async () => resolve({ looked: 8, changed: 1, remaining: true, failed: false }));
  expect(f.discover).toHaveBeenCalledTimes(1);
  await act(async () => { tree = create(createElement(MovieCollectionsScreen, { ...props, active: false })); });
  expect(f.discover).toHaveBeenCalledTimes(1);
});
