import { createElement, type ElementType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';
import type { StoredVodItem } from '../../storage/vod.js';
const f = vi.hoisted(() => ({
  progress: [] as StoredVodItem[], visible: true,
  readOnce: null as null | (() => Promise<StoredVodItem[]>),
  remove: vi.fn(async (_db: unknown, _key: string) => {}), clear: vi.fn(async (_db: unknown) => {}), select: vi.fn(), open: vi.fn(),
}));
vi.mock('react-native', async () => {
  const { createElement: el } = await import('react');
  return {
    Platform: { isTV: true, OS: 'android' }, StyleSheet: { create: (s: unknown) => s, absoluteFill: {} },
    Text: 'Text', View: 'View', Image: 'Image', Pressable: 'Pressable', Modal: 'Modal',
    ActivityIndicator: 'ActivityIndicator', RefreshControl: 'RefreshControl',
    FlatList: ({ data, renderItem }: any) => el('FlatList', {}, ...data.map((item: unknown, index: number) => el('Row', { key: index }, renderItem({ item, index })))),
    BackHandler: { addEventListener: () => ({ remove() {} }) }, Linking: { openURL: vi.fn() },
  };
});
vi.mock('../../storage/settings.js', () => ({
  getLastChannelId: async () => 'tv2', getSetting: async () => null,
  getHomeProviders: async () => [], getTmdbApiKey: async () => null, setSetting: async () => {},
}));
vi.mock('../../storage/channels.js', () => ({ getChannel: async () => ({ id: 'tv2', name: 'TV 2', logoUrls: [] }), listChannels: async () => [] }));
vi.mock('../../storage/programmes.js', () => ({ nowProgrammesFor: async () => new Map(), listProgrammesFor: async () => [] }));
vi.mock('../../storage/history.js', () => ({ listArchiveProgress: async () => [], listRecentChannels: async () => [] }));
vi.mock('../../storage/continueList.js', () => ({
  continueChannelVisible: async () => f.visible,
  dismissContinueItem: (db: unknown, key: string) => f.remove(db, key), clearContinueList: (db: unknown) => f.clear(db),
}));
vi.mock('../../storage/favoriteGroups.js', () => ({ listFavoriteGroups: async () => [] }));
vi.mock('../../storage/followedSeries.js', () => ({ listFollowedSeries: async () => [] }));
vi.mock('../../storage/sport.js', () => ({ getSportTeams: async () => [] }));
vi.mock('../../storage/reminders.js', () => ({ listReminders: async () => [], addReminder: async () => {}, removeReminder: async () => {} }));
vi.mock('../../storage/vod.js', () => ({ listVodItems: async (_db: unknown, opts: any) => {
  if (!opts.inProgressOnly) return [];
  const read = f.readOnce; f.readOnce = null;
  return read === null ? f.progress : read();
}, recentlyWatchedTitles: async () => [] }));
vi.mock('../../sync/epgCache.js', () => ({ ensureEpg: async () => ({ fetched: 0 }), ensureFullEpg: async () => ({ fetched: 0 }) }));
vi.mock('../../sync/tmdb.js', () => ({ cleanVodTitle: () => ({ title: '' }), searchTmdb: async () => [], tmdbFetch: vi.fn() }));
vi.mock('../../sync/tmdbHome.js', () => ({ justWatchLink: vi.fn(), providerShelf: vi.fn(), recommendedTitles: vi.fn(), serviceSearchUrl: vi.fn(), trendingTitles: vi.fn() }));
vi.mock('../../sync/shelfCache.js', () => ({ cachedShelf: vi.fn() }));
vi.mock('../sport/findMatches.js', () => ({ autoRemindTeams: async () => 0, refreshSportEpg: async () => 0, teamMatchesToday: async () => [] }));
vi.mock('../../diagnostics/log.js', () => ({ logEvent: () => {} }));
vi.mock('../../ui/ChannelLogo.js', () => ({ ChannelLogo: () => null }));
vi.mock('../vod/VodScreen.js', async () => {
  const { createElement: el } = await import('react');
  return { Poster: (props: any) => el('Poster', props) };
});
import { FrontScreen } from './FrontScreen.js';
import { ContinueMenu } from './ContinueMenu.js';
const movie = { key: 'source:movie-1', name: 'Film' } as StoredVodItem;
const props = { session: { db: {}, credsBySource: new Map() } as unknown as AppSession,
  onSelect: f.select, onResume: vi.fn(), onOpenVod: f.open, onOpenSettings: vi.fn(), onBrowse: vi.fn(), refreshing: false, onRefresh: vi.fn(), reloadToken: 0 };
let tree: ReactTestRenderer | null = null;
const mount = () => act(async () => { tree = create(createElement(FrontScreen, props)); });
const text = () => tree!.root.findAllByType('Text' as ElementType).map(n => n.children.join('')).join(' ');
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  f.progress = [movie]; f.visible = true; f.readOnce = null;
  f.open.mockClear(); f.select.mockClear();
  f.remove.mockReset().mockImplementation(async (_db, key) => { if (key.startsWith('channel:')) f.visible = false; else f.progress = []; });
  f.clear.mockReset().mockImplementation(async () => { f.progress = []; f.visible = false; });
});
afterEach(async () => { if (tree) await act(async () => tree!.unmount()); tree = null; vi.unstubAllGlobals(); });

it('langt tryk paa en film aabner valgene uden at aabne filmen ved slip', async () => {
  await mount();
  const poster = tree!.root.findByType('Poster' as ElementType);
  await act(async () => { poster.props.onLongPress(); poster.props.onOpen(movie); });
  expect(f.open).not.toHaveBeenCalled();
  expect(text()).toContain('Ryd hele Se videre');
  await act(async () => tree!.root.findByType(ContinueMenu).props.onRemove());
  expect(f.remove).toHaveBeenCalledWith(props.session.db, 'vod:source:movie-1');
  expect(tree!.root.findAllByType('Poster' as ElementType)).toHaveLength(0);
  expect(text()).toContain('TV 2');
});

it('ryd hele listen fjerner baade filmen og sidst sete kanal', async () => {
  await mount();
  await act(async () => tree!.root.findByType('Poster' as ElementType).props.onLongPress());
  await act(async () => tree!.root.findByType(ContinueMenu).props.onClear());
  expect(f.clear).toHaveBeenCalledOnce();
  expect(text()).not.toContain('Se videre');
  expect(f.select).not.toHaveBeenCalled();
});

it('langt tryk paa kanalkortet fjerner kun kanalen og starter ikke TV', async () => {
  await mount();
  const card = tree!.root.findAllByType('Pressable' as ElementType).find(n => n.props.onLongPress !== undefined)!;
  await act(async () => { card.props.onLongPress(); card.props.onPress(); });
  expect(f.select).not.toHaveBeenCalled();
  await act(async () => tree!.root.findByType(ContinueMenu).props.onRemove());
  expect(f.remove).toHaveBeenCalledWith(props.session.db, 'channel:tv2');
  expect(tree!.root.findAllByType('Poster' as ElementType)).toHaveLength(1);
  expect(text()).not.toContain('TV 2');
});

it('et langsomt opslag fra foer rydningen kan ikke faa kortene tilbage', async () => {
  await mount();
  let resolve!: (items: StoredVodItem[]) => void;
  f.readOnce = () => new Promise(done => { resolve = done; });
  await act(async () => tree!.update(createElement(FrontScreen, { ...props, reloadToken: 1 })));
  await act(async () => tree!.root.findByType('Poster' as ElementType).props.onLongPress());
  await act(async () => tree!.root.findByType(ContinueMenu).props.onClear());
  await act(async () => resolve([movie]));
  expect(text()).not.toContain('Se videre');
});

it('Tilbage/Annuller aendrer ingen data, og fejl lader menuen blive staaende', async () => {
  await mount();
  await act(async () => tree!.root.findByType('Poster' as ElementType).props.onLongPress());
  await act(async () => tree!.root.findByType('Modal' as ElementType).props.onRequestClose());
  expect(f.remove).not.toHaveBeenCalled(); expect(f.clear).not.toHaveBeenCalled();
  await act(async () => tree!.root.findByType('Poster' as ElementType).props.onLongPress());
  f.remove.mockRejectedValueOnce(new Error('db error'));
  await act(async () => tree!.root.findByType(ContinueMenu).props.onRemove());
  expect(text()).toContain('Listen kunne ikke ryddes. Prøv igen.');
  expect(tree!.root.findAllByType('Poster' as ElementType)).toHaveLength(1);
});
