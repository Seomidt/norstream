import { createElement, type ElementType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import type { TmdbTitle } from '../../sync/tmdbHome.js';

const f = vi.hoisted(() => ({ matches: vi.fn(), item: vi.fn(), open: vi.fn() }));
vi.mock('react-native', async () => {
  const { createElement: el } = await import('react');
  return { Platform: { isTV: true, OS: 'android' }, StyleSheet: { create: (v: unknown) => v, absoluteFill: {} },
    Text: 'Text', View: 'View', Image: 'Image', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator',
    BackHandler: { addEventListener: () => ({ remove() {} }) },
    FlatList: ({ data, renderItem }: any) => el('FlatList', {}, ...data.map((item: unknown, index: number) => el('Row', { key: index }, renderItem({ item, index })))),
  };
});
vi.mock('../../storage/settings.js', () => ({ getTmdbApiKey: async () => 'key' }));
vi.mock('../../storage/vod.js', () => ({ getVodItem: f.item }));
vi.mock('./cinemaPackage.js', () => ({ cinemaPackageMatches: f.matches }));
vi.mock('../../sync/tmdb.js', () => ({ tmdbFetch: vi.fn() }));
vi.mock('../../sync/tmdbHome.js', () => ({ cinemaTitles: vi.fn() }));
vi.mock('../../sync/shelfCache.js', () => ({ cachedShelf: async (_db: unknown, key: string) => key === 'cinema-now' ? titles : [] }));
import { CinemaScreen } from './CinemaScreen.js';
import { TvPressable } from '../../ui/TvPressable.js';

const titles: TmdbTitle[] = ['I pakken', 'Ikke i pakken'].map((name, i) => ({ id: i + 1, title: name, kind: 'movie', year: 2026, posterUrl: null, thumbUrl: null, overview: '', rating: 7 }));
const session = { db: {} } as AppSession;
const stored = { key: 'source:matched', name: 'I pakken' };
let tree: ReactTestRenderer | null = null;
const text = (node: any): string => typeof node === 'string' ? node : !node ? '' : Array.isArray(node) ? node.map(text).join('') : text(node.children ?? node.props?.children);
const props = { session, onOpen: f.open, onTrailer: vi.fn(), onOpenSettings: vi.fn(), active: true, reloadToken: 0 };
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 16)); vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  f.matches.mockResolvedValue(new Map([[1, stored.key]])); f.item.mockResolvedValue(stored);
});
afterEach(async () => {
  if (tree) await act(async () => tree!.unmount()); tree = null;
  expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.unstubAllGlobals();
});
const mount = () => act(async () => { tree = create(createElement(CinemaScreen, props)); });
const cards = () => tree!.root.findAllByType(TvPressable).filter(node => node.props.accessibilityLabel !== undefined);

it('viser kun bekraeftede film med maerket paa coveret og aabner det samme katalogmatch', async () => {
  await mount();
  expect(cards()).toHaveLength(2);
  expect(text(cards()[0])).toContain('★ I pakken');
  expect(text(cards()[1])).not.toContain('★ I pakken');
  expect(cards()[0]!.props.accessibilityLabel).toBe('I pakken, i din pakke');
  await act(async () => cards()[0]!.props.onPress());
  expect(f.item).toHaveBeenCalledWith(session.db, stored.key);
  const play = tree!.root.findAllByType(TvPressable).find(node => text(node) === 'Se i din pakke')!;
  await act(async () => play.props.onPress());
  expect(f.open).toHaveBeenCalledWith(stored);
});

it('genopfrisker match ved katalogsynk og indgang i fanen uden nye opslag per plakat', async () => {
  await mount(); expect(f.matches).toHaveBeenCalledTimes(1);
  f.matches.mockResolvedValue(new Map());
  await act(async () => tree!.update(createElement(CinemaScreen, { ...props, reloadToken: 1 })));
  expect(cards()).toHaveLength(2);
  expect(cards().every(card => !text(card).includes('★ I pakken'))).toBe(true);
  await act(async () => tree!.update(createElement(CinemaScreen, { ...props, active: false, reloadToken: 1 })));
  expect(f.matches).toHaveBeenCalledTimes(2);
  await act(async () => tree!.update(createElement(CinemaScreen, { ...props, active: true, reloadToken: 1 })));
  expect(f.matches).toHaveBeenCalledTimes(3);
});

it('et fejlet katalogopslag viser ingen falske tilgaengelighedsmaerker', async () => {
  f.matches.mockRejectedValue(new Error('offline database'));
  await mount();
  expect(cards()).toHaveLength(2);
  expect(cards().every(card => !text(card).includes('★ I pakken'))).toBe(true);
});
