import { createElement, useState, type ElementType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';

const mocks = vi.hoisted(() => ({ countries: vi.fn(), open: vi.fn() }));
vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Platform: { isTV: true, OS: 'android' },
    View: 'View', Text: 'Text', Image: 'Image', Pressable: 'Pressable', ScrollView: 'ScrollView',
    TextInput: 'TextInput', ActivityIndicator: 'ActivityIndicator',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
    useWindowDimensions: () => ({ width: 864, height: 486 }),
    AppState: { addEventListener: () => ({ remove() {} }) },
    FlatList: React.forwardRef(function List(props: Record<string, any>, ref) {
      React.useImperativeHandle(ref, () => ({ scrollToIndex() {}, scrollToOffset() {} }));
      return React.createElement('List', {}, props.ListHeaderComponent,
        ...props.data.map((item: any, index: number) => React.createElement(React.Fragment,
          { key: props.keyExtractor(item) }, props.renderItem({ item, index }))),
        props.data.length === 0 ? props.ListEmptyComponent : null);
    }),
  };
});
vi.mock('../../storage/vod.js', () => ({
  vodCounts: async () => ({ movies: 20, series: 12 }), listVodItems: async () => [],
  listVodCountryGroups: mocks.countries, listVodCategoriesInCountry: async () => [],
}));
vi.mock('../../storage/settings.js', () => ({ getHomeProviders: async () => [] }));
vi.mock('../../ui/tvKeys.js', () => ({ cameBySelect: () => true }));
vi.mock('../../ui/posterFill.js', () => ({ ensurePoster() {}, foundPoster: () => null, subscribePoster: () => () => {} }));
vi.mock('./CinemaScreen.js', () => ({ CinemaScreen: () => null }));
vi.mock('./VodFilterScreen.js', () => ({ VodFilterScreen: () => null }));
vi.mock('./MovieCollectionsScreen.js', async () => {
  const React = await import('react');
  return { MovieCollectionsScreen: (props: Record<string, unknown>) => React.createElement('Collections', props) };
});
vi.mock('./FollowedSeriesScreen.js', async () => {
  const React = await import('react');
  return { FollowedSeriesScreen: (props: Record<string, unknown>) => React.createElement('Followed', props) };
});

import { VodScreen, type VodLevel } from './VodScreen.js';
import { parentVodLevel } from './vodNavigation.js';
import { TvPressable } from '../../ui/TvPressable.js';

let tree: ReactTestRenderer | null = null;
let current: VodLevel;
let goBack: () => void;
const session = { db: {} } as AppSession;
const host = (name: string): ElementType => name as ElementType;
function content(node: any): string {
  if (typeof node === 'string') return node;
  if (node == null) return '';
  if (Array.isArray(node)) return node.map(content).join('');
  return content(node.children ?? node.props?.children);
}
function Navigation({ initial = { name: 'home' } }: { initial?: VodLevel }) {
  const [level, setLevel] = useState(initial);
  current = level;
  goBack = () => { const next = parentVodLevel(level); if (next !== null) setLevel(next); };
  return createElement(VodScreen, {
    session, active: true, level, onLevelChange: setLevel, backRef: { current: () => false },
    onOpen: mocks.open, onTrailer() {}, onOpenSettings() {},
  });
}
async function mount(initial?: VodLevel) {
  await act(async () => { tree = create(createElement(Navigation, { initial })); });
}
async function click(title: string) {
  const button = tree!.root.findAllByType(TvPressable).find(node =>
    node.findAllByType(host('Text')).some(text => content(text) === title));
  expect(button).toBeDefined();
  await act(async () => button!.props.onPress({}));
}
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  mocks.countries.mockResolvedValue([{ key: 'DK', name: 'Danmark', flag: '🇩🇰', categoryCount: 2, channelCount: 20 }]);
});
afterEach(async () => {
  if (tree !== null) await act(async () => tree!.unmount());
  tree = null; expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.unstubAllGlobals();
});

it('forsiden har kun Film, Serier og Biograf som hovedvalg', async () => {
  await mount();
  const labels = tree!.root.findAllByType(TvPressable).map(node =>
    content(node.findAllByType(host('Text'))[0]));
  expect(labels).toEqual(['Film', 'Serier', 'Biograf']);
});

it('Film aabner samlinger i samme katalog og Tilbage bevarer hele hierarkiet', async () => {
  await mount(); await click('Film');
  expect(current).toEqual({ name: 'countries', kind: 'movie' });
  expect(content(tree!.toJSON())).toContain('Filmsamlinger');
  expect(content(tree!.toJSON())).not.toContain('Serier jeg følger');
  await click('Filmsamlinger');
  expect(current).toEqual({ name: 'collections' });
  await act(async () => tree!.root.findByType(host('Collections')).props.onCollection(7));
  expect(current).toEqual({ name: 'collection', collectionId: 7 });
  await act(async () => goBack()); expect(current).toEqual({ name: 'collections' });
  await act(async () => goBack()); expect(current).toEqual({ name: 'countries', kind: 'movie' });
  expect(content(tree!.toJSON())).toContain('Danmark');
  await act(async () => goBack()); expect(current).toEqual({ name: 'home' });
});

it('Serier har foelgeoversigten og kommer tilbage til Serier', async () => {
  await mount(); await click('Serier');
  expect(content(tree!.toJSON())).toContain('Serier jeg følger');
  expect(content(tree!.toJSON())).not.toContain('Filmsamlinger');
  await click('Serier jeg følger');
  expect(current).toEqual({ name: 'followed', fromSeries: true });
  expect(tree!.root.findByType(host('Followed'))).toBeDefined();
  await act(async () => goBack()); expect(current).toEqual({ name: 'countries', kind: 'series' });
});

it.each(['movie', 'series'] as const)('%s: genvejen kan stadig aabnes med tom landeliste og faar TV-fokus', async kind => {
  mocks.countries.mockResolvedValue([]);
  await mount({ name: 'countries', kind });
  const title = kind === 'movie' ? 'Filmsamlinger' : 'Serier jeg følger';
  const button = tree!.root.findAllByType(TvPressable).find(node => content(node).includes(title));
  expect(button?.props.hasTVPreferredFocus).toBe(true);
  await click(title);
  expect(current.name).toBe(kind === 'movie' ? 'collections' : 'followed');
});
