import { createElement, type ElementType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';

const f = vi.hoisted(() => ({ list: vi.fn(), items: vi.fn(), peek: vi.fn(), peekItems: vi.fn(), due: vi.fn(), key: vi.fn(),
  discover: vi.fn(), pick: vi.fn(), open: vi.fn(), scroll: vi.fn() }));
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
vi.mock('../../storage/settings.js', () => ({ getTmdbApiKey: f.key }));
vi.mock('../../storage/movieCollections.js', () => ({ listMovieCollections: f.list, listMovieCollectionItems: f.items,
  peekMovieCollections: f.peek, peekMovieCollectionItems: f.peekItems, movieCollectionsRefreshDue: f.due }));
vi.mock('../../sync/movieCollections.js', () => ({ discoverMovieCollections: f.discover }));
vi.mock('../../sync/tmdb.js', () => ({ tmdbFetch: vi.fn() }));
import { MovieCollectionsScreen } from './MovieCollectionsScreen.js';
import { TvPressable } from '../../ui/TvPressable.js';

const collection = { id: 7, name: 'Samling', posterUrl: null, available: 2 };
const movie = { key: 'source:movie-1', name: 'Film i pakken', posterUrl: null, foundPosterUrl: null, year: 2000 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const session = { db: {} } as AppSession;
const props = { session, collectionId: null, onCollection: f.pick, onOpen: f.open, active: true, reloadToken: 0 };
let tree: ReactTestRenderer | null = null;
function text(node: any): string { return typeof node === 'string' ? node : !node ? '' : Array.isArray(node) ? node.map(text).join('') : text(node.children ?? node.props?.children); }
const button = (label: string) => tree!.root.findAllByType(TvPressable).find(node => text(node) === label)!;
const card = (label: string) => tree!.root.findAllByType(TvPressable).find(node => node.props.accessibilityLabel === label)!;
const host = (name: string): ElementType => name as ElementType;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => setTimeout(fn, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  f.list.mockResolvedValue([collection]); f.items.mockResolvedValue([movie]);
  f.peek.mockReturnValue([collection]); f.peekItems.mockReturnValue([movie]);
  f.due.mockResolvedValue(true); f.key.mockResolvedValue('key');
  f.discover.mockResolvedValue({ looked: 0, changed: 0, remaining: false, failed: false });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount());
  tree = null; expect(vi.getTimerCount()).toBe(0); vi.unstubAllGlobals(); vi.useRealTimers();
});
const mount = (overrides: Partial<Parameters<typeof MovieCollectionsScreen>[0]> = {}) => act(async () => {
  tree = create(createElement(MovieCollectionsScreen, { ...props, ...overrides }));
});

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

it('viser varme samlingsfilm og deres overskrift mens lokale opslag stadig venter', async () => {
  const collections = deferred<unknown>();
  const items = deferred<unknown>();
  f.list.mockReturnValue(collections.promise); f.items.mockReturnValue(items.promise);
  await mount({ collectionId: 7 });
  expect(card('Film i pakken, 2000')).toBeDefined();
  expect(tree!.root.findAllByType(host('Text')).some(node => text(node) === 'Samling')).toBe(true);
  expect(f.discover).not.toHaveBeenCalled();
  expect(f.key).not.toHaveBeenCalled();
});

it('en kendt frisk oversigt genbruger kortene uden at laese TMDB-noeglen ved genindgang', async () => {
  f.due.mockResolvedValue(false);
  await mount();
  expect(card('Samling, 2 film i pakken')).toBeDefined();
  await act(async () => { tree!.unmount(); tree = null; });
  await mount();
  expect(card('Samling, 2 film i pakken')).toBeDefined();
  expect(f.key).not.toHaveBeenCalled();
  expect(f.discover).not.toHaveBeenCalled();
});

it('bevarer kendte kort mens en forfalden baggrundsopdatering stadig venter', async () => {
  const discovery = deferred<unknown>();
  f.discover.mockReturnValue(discovery.promise);
  await mount();
  expect(f.discover).toHaveBeenCalledTimes(1);
  expect(card('Samling, 2 film i pakken')).toBeDefined();
  expect(tree!.root.findAllByType(host('Text')).some(node => text(node) === 'Finder flere samlinger …')).toBe(true);
});

it('varme kort vises straks mens lokal laesning og TMDB-noeglen er forsinket', async () => {
  const local = deferred<unknown>();
  const key = deferred<unknown>();
  f.list.mockReturnValue(local.promise); f.key.mockReturnValue(key.promise);
  await mount();
  expect(card('Samling, 2 film i pakken')).toBeDefined();
  expect(f.discover).not.toHaveBeenCalled();
});

it('bevarer varme kort ved en fejl i den lokale genindlaesning', async () => {
  f.list.mockRejectedValue(new Error('local read failed'));
  await mount();
  expect(card('Samling, 2 film i pakken')).toBeDefined();
  expect(button('Kunne ikke opdatere samlinger. Prøv igen')).toBeDefined();
});

it('sideskift viser kun den nye samlings varme kort og laaner aldrig den forrige sides kort', async () => {
  const second = { ...collection, id: 8, name: 'Anden samling' };
  const secondMovie = { ...movie, key: 'source:movie-2', name: 'Anden film' };
  f.peek.mockReturnValue([collection, second]);
  f.peekItems.mockImplementation((_db, id) => id === 7 ? [movie] : id === 8 ? [secondMovie] : []);
  f.list.mockReturnValue(deferred<unknown>().promise);
  f.items.mockReturnValue(deferred<unknown>().promise);
  await mount({ collectionId: 7 });
  expect(card('Film i pakken, 2000')).toBeDefined();
  await act(async () => tree!.update(createElement(MovieCollectionsScreen, { ...props, collectionId: 8 })));
  expect(card('Anden film, 2000')).toBeDefined();
  expect(card('Film i pakken, 2000')).toBeUndefined();
  expect(tree!.root.findAllByType(host('Text')).some(node => text(node) === 'Anden samling')).toBe(true);
  await act(async () => tree!.update(createElement(MovieCollectionsScreen, { ...props, collectionId: 9 })));
  expect(card('Film i pakken, 2000')).toBeUndefined();
  expect(card('Anden film, 2000')).toBeUndefined();
  expect(f.discover).not.toHaveBeenCalled();
});

it('begrænser baggrundsarbejde og giver et synligt valg om at finde flere samlinger', async () => {
  f.discover.mockResolvedValue({ looked: 8, changed: 0, remaining: true, failed: false });
  await mount(); expect(f.discover).toHaveBeenCalledTimes(3);
  expect(button('Find flere samlinger')).toBeDefined();
  expect(button('Find flere samlinger').props.hasTVPreferredFocus).toBe(false);
  await act(async () => button('Find flere samlinger').props.onPress());
  expect(f.discover).toHaveBeenCalledTimes(6);
});

it('en tom kold oversigt starter stadig tre smaa opdagelsesbatches og tilbyder flere', async () => {
  f.peek.mockReturnValue([]); f.list.mockResolvedValue([]); f.due.mockResolvedValue(false);
  f.discover.mockResolvedValue({ looked: 8, changed: 0, remaining: true, failed: false });
  await mount();
  expect(f.key).toHaveBeenCalledTimes(1);
  expect(f.discover).toHaveBeenCalledTimes(3);
  expect(f.discover.mock.calls.every(call => call[3].limit === 8)).toBe(true);
  expect(button('Find flere samlinger')).toBeDefined();
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
