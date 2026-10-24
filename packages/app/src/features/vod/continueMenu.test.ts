import { createElement, type ElementType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import type { StoredVodItem } from '../../storage/vod.js';
const f = vi.hoisted(() => ({ progress: [] as StoredVodItem[], readOnce: null as null | (() => Promise<StoredVodItem[]>), remove: vi.fn(), clear: vi.fn(), open: vi.fn(), scroll: vi.fn(), list: vi.fn() }));
vi.mock('react-native', async () => {
  const { createElement: el, forwardRef, useImperativeHandle } = await import('react');
  return {
    useWindowDimensions: () => ({ width: 960, height: 540 }), Platform: { isTV: true, OS: 'android' }, StyleSheet: { create: (s: unknown) => s },
    Text: 'Text', View: 'View', Image: 'Image', Pressable: 'Pressable', Modal: 'Modal', ScrollView: 'ScrollView', TextInput: 'Input', ActivityIndicator: 'ActivityIndicator',
    AppState: { addEventListener: () => ({ remove() {} }) },
    FlatList: forwardRef(function List({ data, renderItem }: any, ref) { useImperativeHandle(ref, () => ({ scrollToIndex: f.scroll, scrollToOffset: vi.fn() })); return el('FlatList', {}, ...data.map((item: StoredVodItem, index: number) => el('Row', { key: item.key }, renderItem({ item, index })))); }),
  };
});
vi.mock('../../storage/vod.js', () => ({ listVodItems: f.list, vodCounts: async () => ({ movies: 1, series: 1 }), listVodCountryGroups: async () => [{ key: 'US', name: 'USA', flag: '🇺🇸', categoryCount: 1, channelCount: 50 }, { key: 'GB', name: 'Storbritannien', flag: '🇬🇧', categoryCount: 1, channelCount: 50 }] }));
vi.mock('../../storage/continueList.js', () => ({ dismissContinueItem: f.remove, clearVodContinueList: f.clear }));
vi.mock('../../storage/settings.js', () => ({ getHomeProviders: async () => [] }));
vi.mock('../../ui/posterFill.js', () => ({ ensurePoster: () => {}, foundPoster: () => null, subscribePoster: () => () => {} }));
vi.mock('./CinemaScreen.js', () => ({ CinemaScreen: () => null }));
vi.mock('./VodFilterScreen.js', () => ({ VodFilterScreen: () => null }));
import { VodScreen, Poster } from './VodScreen.js';
import { ContinueMenu } from '../home/ContinueMenu.js';
const movie = { key: 'source:movie-1', name: 'Film', providers: [], posterUrl: null, rating: null, positionSeconds: 300, durationSeconds: 3600 } as unknown as StoredVodItem;
const series = { ...movie, key: 'source:series-2', kind: 'series', name: 'Serie' } as StoredVodItem;
const props = { session: { db: {} } as AppSession, active: true, reloadToken: 0, backRef: { current: () => false }, level: { name: 'home' } as const,
  onLevelChange: vi.fn(), onOpen: f.open, onTrailer: vi.fn(), onOpenSettings: vi.fn() };
let tree: ReactTestRenderer | null = null;
const mount = () => act(async () => { tree = create(createElement(VodScreen, props)); });
const posters = () => tree!.root.findAllByType(Poster).filter(node => node.props.onLongPress !== undefined);
const text = () => tree!.root.findAllByType('Text' as ElementType).map(node => node.children.join('')).join(' ');
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  f.progress = [series, movie]; f.readOnce = null;
  f.list.mockImplementation(async (_db, opts) => {
    if (!opts.inProgressOnly) return [];
    const read = f.readOnce; f.readOnce = null;
    return read === null ? f.progress : read();
  });
  f.remove.mockImplementation(async (_db, key) => { f.progress = f.progress.filter(item => `vod:${item.key}` !== key); });
  f.clear.mockImplementation(async () => { f.progress = []; });
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount()); tree = null;
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});
it('Film bruger samme lokale synlighed som Se videre og aabner valgte serier med et kort tryk', async () => {
  await mount();
  expect(f.list).toHaveBeenCalledWith(props.session.db, { inProgressOnly: true, homeContinueOnly: true, limit: 20 });
  await act(async () => posters()[0]!.props.onOpen(series));
  expect(f.open).toHaveBeenCalledWith(series);
});
it('langt tryk paa serie aabner Fortsaet-menuen uden at aabne titlen ved slip', async () => {
  await mount();
  const poster = posters()[0]!;
  await act(async () => { poster.props.onLongPress(); poster.props.onOpen(series); });
  expect(f.open).not.toHaveBeenCalled();
  expect(text()).toContain('Fjern denne fra Fortsæt');
  expect(text()).toContain('Ryd hele Fortsæt');
  await act(async () => tree!.root.findByType(ContinueMenu).props.onRemove());
  expect(f.remove).toHaveBeenCalledWith(props.session.db, 'vod:source:series-2');
  expect(posters().map(node => node.props.item.key)).toEqual([movie.key]);
});
it('ryd hele Fortsaet bruger VOD-rydning og fjerner alle viste titler', async () => {
  await mount();
  await act(async () => posters()[0]!.props.onLongPress());
  await act(async () => tree!.root.findByType(ContinueMenu).props.onClear());
  expect(f.clear).toHaveBeenCalledWith(props.session.db);
  expect(posters()).toHaveLength(0);
});
it('gamle opslag kan ikke genoprette en titel efter fjernelse', async () => {
  await mount();
  let resolve!: (items: StoredVodItem[]) => void;
  f.readOnce = () => new Promise(done => { resolve = done; });
  await act(async () => tree!.update(createElement(VodScreen, { ...props, reloadToken: 1 })));
  await act(async () => posters()[0]!.props.onLongPress());
  await act(async () => tree!.root.findByType(ContinueMenu).props.onRemove());
  await act(async () => resolve([series, movie]));
  expect(posters().map(node => node.props.item.key)).toEqual([movie.key]);
});
it('Annuller bevarer listen og en skrivefejl bliver i menuen', async () => {
  await mount();
  await act(async () => posters()[0]!.props.onLongPress());
  await act(async () => tree!.root.findByType('Modal' as ElementType).props.onRequestClose());
  expect(f.remove).not.toHaveBeenCalled(); expect(f.clear).not.toHaveBeenCalled();
  await act(async () => posters()[0]!.props.onLongPress());
  f.remove.mockRejectedValueOnce(new Error('database'));
  await act(async () => tree!.root.findByType(ContinueMenu).props.onRemove());
  expect(text()).toContain('Listen kunne ikke ryddes. Prøv igen.');
  expect(posters()).toHaveLength(2);
});

it('viser Fortsaet selv om nyeste film stadig venter eller fejler', async () => {
  let reject!: (error: Error) => void;
  f.list.mockImplementation(async (_db, opts) => {
    if (opts.newestFirst && opts.kind === 'movie') return new Promise((_resolve, fail) => { reject = fail; });
    return opts.inProgressOnly ? f.progress : [];
  });
  await mount();
  expect(posters()).toHaveLength(2);
  await act(async () => reject(new Error('langsom hylde')));
  expect(posters()).toHaveLength(2);
});

it('viser gemt alternativt cover straks naar udbyderens billede fejler', async () => {
  await act(async () => { tree = create(createElement(Poster, { item: { ...movie, posterUrl: 'https://provider.invalid/broken.jpg', foundPosterUrl: 'https://image.tmdb.org/t/p/original/bond.jpg' }, onOpen: f.open })); });
  const image = () => tree!.root.findByType('Image' as ElementType);
  await act(async () => image().props.onError());
  expect(image().props.source.uri).toBe('https://image.tmdb.org/t/p/w342/bond.jpg');
});

it.each(['movie', 'series'] as const)('%s: USA og UK er tilgaengelige og det sidste land kan aabnes', async (kind) => {
  await act(async () => { tree = create(createElement(VodScreen, { ...props, level: { name: 'countries', kind } })); });
  expect(text()).toContain('USA'); expect(text()).toContain('Storbritannien');
  const last = tree!.root.findAllByType('Pressable' as ElementType).filter(node => node.props.onPress !== undefined).at(-1)!;
  await act(async () => last.props.onPress({}));
  expect(props.onLevelChange).toHaveBeenCalledWith(expect.objectContaining({ name: 'categories', kind, country: expect.objectContaining({ key: 'GB' }) }));
});
