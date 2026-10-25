import { createElement, useState, type ElementType, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AppSession } from '../../session.js';

const mocks = vi.hoisted(() => ({
  keys: new Set<(event: Record<string, unknown>) => void>(),
  nativeFocus: vi.fn(), log: vi.fn(), front: vi.fn(), vod: vi.fn(), radio: vi.fn(),
  subpageBack: false,
}));
vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Platform: { isTV: true, OS: 'android' },
    View: 'View', Text: 'Text', Pressable: 'Pressable', TVFocusGuideView: 'TVFocusGuideView',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
    AppState: { addEventListener: () => ({ remove: () => {} }) },
    useTVEventHandler: (handler: (event: Record<string, unknown>) => void) => {
      React.useEffect(() => {
        mocks.keys.add(handler);
        return () => { mocks.keys.delete(handler); };
      }, [handler]);
    },
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../../diagnostics/log.js', () => ({ logEvent: mocks.log }));
vi.mock('../../storage/settings.js', () => ({
  clearLastSyncMs: vi.fn(), getLastSyncMs: async () => Date.now(),
  getMiniPreviewEnabled: async () => false, getStreamFormatSetting: async () => 'ts',
  getTmdbApiKey: async () => null, getVideoSurface: async () => 'surfaceView',
}));
vi.mock('../../sync/syncAll.js', () => ({ CHANNEL_SYNC_INTERVAL_MS: 86_400_000, syncAllSources: vi.fn() }));
vi.mock('../../sync/useAutomaticChannelSync.js', () => ({ useAutomaticChannelSync: () => {} }));
vi.mock('../../sync/useFollowedSeriesRefresh.js', () => ({ useFollowedSeriesRefresh: () => {} }));
vi.mock('../../sync/prefetchEpg.js', () => ({ prefetchFavouritesEpg: vi.fn() }));
vi.mock('../../ui/posterFill.js', () => ({ forgetPosterMisses: vi.fn() }));
vi.mock('../../ui/logoCache.js', () => ({ forgetLogoMisses: vi.fn(), resetLogo: vi.fn() }));
vi.mock('../../ui/Notice.js', () => ({ Notice: () => null }));
vi.mock('../player/format.js', () => ({ applyStreamFormatSetting: vi.fn(), applyVideoSurfaceSetting: vi.fn() }));
vi.mock('../../storage/cloudBackup.js', () => ({ runWeeklyCloudBackup: vi.fn() }));
vi.mock('../../storage/credentials.js', () => ({ loadSourceCredentials: vi.fn() }));
vi.mock('../settings/cloudSync.js', () => ({ loadFromCloud: vi.fn(), saveToCloud: vi.fn() }));
vi.mock('../../storage/cloudAutoSync.js', () => ({ runCloudSync: vi.fn() }));
vi.mock('../sport/findMatches.js', () => ({ refreshSportEpg: vi.fn() }));
vi.mock('../../sync/vodMeta.js', () => ({ enrichVodMeta: vi.fn() }));
vi.mock('../../sync/tmdb.js', () => ({ tmdbFetch: vi.fn() }));
vi.mock('./FrontScreen.js', () => ({ FrontScreen: (props: unknown) => { mocks.front(props); return null; } }));
vi.mock('../vod/VodScreen.js', () => ({ VodScreen: (props: unknown) => { mocks.vod(props); return null; } }));
vi.mock('../radio/RadioScreen.js', () => ({
  RADIO_START: { section: 'home' }, RadioScreen: (props: unknown) => { mocks.radio(props); return null; },
}));
vi.mock('../../ui/deferredScreen.js', () => ({
  deferredScreen: () => (props: { backRef?: { current: () => boolean } }) => {
    if (props.backRef) props.backRef.current = () => mocks.subpageBack;
    return null;
  },
}));

import { HomeScreen, type HomePlace, type Tab } from './HomeScreen.js';
import { NavigationRail, type NavigationRailControl } from './NavigationRail.js';
import { TvPressable } from '../../ui/TvPressable.js';

const tabs = [
  { id: 'home', label: 'Hjem', icon: 'H' },
  { id: 'guide', label: 'Guide', icon: 'G' },
  { id: 'sport', label: 'Sport', icon: 'S' },
  { id: 'vod', label: 'Film', icon: 'F' },
  { id: 'settings', label: 'Indstil.', icon: 'I' },
] satisfies { id: Tab; label: string; icon: string }[];
const host = (name: string): ElementType => name as ElementType;
let tree: ReactTestRenderer | null = null;
let control: { current: NavigationRailControl | null };
let selected: ReturnType<typeof vi.fn>;
let entered: ReturnType<typeof vi.fn>;
function textOf(node: any): string {
  if (typeof node === 'string') return node;
  if (node == null) return '';
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children ?? node.children ?? []);
}
async function mount(element: ReactElement) {
  await act(async () => {
    tree = create(element, { createNodeMock: node => ({ requestTVFocus: () => mocks.nativeFocus(node.props) }) });
  });
  return tree!;
}
function railElement(activeTab: Tab = 'guide', enabled = true) {
  return createElement(NavigationRail, { tabs, activeTab, enabled, onSelect: selected, onEnter: entered, controlRef: control });
}
async function renderRail(activeTab: Tab = 'guide', enabled = true) {
  if (tree === null) await mount(railElement(activeTab, enabled));
  else await act(async () => tree!.update(railElement(activeTab, enabled)));
}
function button(id: Tab) {
  const items = tree!.root.findByType(NavigationRail).props.tabs as typeof tabs;
  return tree!.root.findByType(NavigationRail).findAllByType(TvPressable)[items.findIndex(item => item.id === id)]!;
}
async function focus(id: Tab) { await act(async () => button(id).props.onFocus({})); }
async function blur(id: Tab) { await act(async () => button(id).props.onBlur({})); }
async function key(eventType: string, eventKeyAction = 1) {
  await act(async () => { for (const handler of mocks.keys) handler({ eventType, eventKeyAction }); });
}
async function tick(ms: number) { await act(async () => { vi.advanceTimersByTime(ms); }); }
function counts() { return [mocks.front.mock.calls.length, mocks.vod.mock.calls.length, mocks.radio.mock.calls.length]; }

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-25T12:00:00Z'));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.clearAllMocks();
  mocks.nativeFocus.mockReset();
  mocks.keys.clear();
  mocks.subpageBack = false;
  control = { current: null };
  selected = vi.fn(); entered = vi.fn();
});
afterEach(async () => {
  if (tree !== null) await act(async () => tree!.unmount());
  tree = null;
  expect(mocks.keys.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('pil op/ned vaelger kun sidste fane efter 25 ms, og sen blur maa ikke afbryde den', async () => {
  await renderRail();
  await key('down'); await focus('vod'); await tick(10);
  await key('up'); await focus('sport'); await blur('vod');
  expect(control.current!.isFocused()).toBe(true);
  await tick(24); expect(selected).not.toHaveBeenCalled();
  await tick(1); expect(selected.mock.calls).toEqual([['sport']]);
  await tick(2000); expect(selected).toHaveBeenCalledTimes(1);
});

it('automatisk fokus, OK fra indholdet og gamle piltryk skifter ikke fane; OK i menuen vaelger straks', async () => {
  await renderRail();
  await focus('home'); await tick(25);
  await key('select'); await focus('home'); await tick(25);
  await key('down'); await tick(601); await focus('home'); await tick(25);
  expect(selected).not.toHaveBeenCalled();
  await key('down'); await focus('vod');
  await act(async () => button('sport').props.onPress());
  expect(selected.mock.calls).toEqual([['sport']]);
  await tick(25); expect(selected).toHaveBeenCalledTimes(1);
});

it('hurtig pil-hoejre efter blur udfoerer valget og indgangen én gang ved slip', async () => {
  await renderRail();
  await key('down'); await focus('vod'); await blur('vod');
  await key('right', 0);
  expect(selected).not.toHaveBeenCalled(); expect(entered).not.toHaveBeenCalled();
  await key('right');
  expect(selected.mock.calls).toEqual([['vod']]); expect(entered).toHaveBeenCalledTimes(1);
  await key('right'); await tick(500);
  expect(selected).toHaveBeenCalledTimes(1); expect(entered).toHaveBeenCalledTimes(1);
});

it('Tilbage annullerer ogsaa pilens hensigt foer automatisk fokus paa en anden fane', async () => {
  await renderRail();
  await key('down'); await focus('vod');
  control.current!.cancelSelection();
  await focus('home'); await tick(25);
  expect(selected).not.toHaveBeenCalled();
});

it('Tilbage sender native fokus synkront og gentager paa den aktive fane indtil korrekt bekraeftelse', async () => {
  await renderRail();
  await focus('guide'); await blur('guide'); await tick(2000);
  expect(textOf(tree!.root.findByType(NavigationRail).findAllByType(host('Text')))).not.toContain('Guide');
  await act(async () => {
    control.current!.requestFocus();
    expect(mocks.nativeFocus).toHaveBeenCalledTimes(1);
    expect(textOf(mocks.nativeFocus.mock.calls[0]![0].children)).toContain('G');
    expect(control.current!.isFocused()).toBe(false);
  });
  await focus('home'); await tick(150);
  expect(control.current!.isFocused()).toBe(false);
  expect(mocks.nativeFocus.mock.calls.length).toBeGreaterThan(1);
  expect(mocks.log).not.toHaveBeenCalled();
  await renderRail('vod'); await tick(150);
  expect(textOf(mocks.nativeFocus.mock.lastCall![0].children)).toContain('Film');
  await focus('vod');
  expect(mocks.log.mock.calls).toEqual([['menu', 'Tilbage: vod, native fokus efter 300 ms']]);
  const calls = mocks.nativeFocus.mock.calls.length;
  await focus('vod'); await tick(2000);
  expect(mocks.nativeFocus).toHaveBeenCalledTimes(calls);
  expect(mocks.log).toHaveBeenCalledTimes(1);
  expect(textOf(tree!.root.findByType(NavigationRail).findAllByType(host('Text')))).toContain('Guide');
});

it('pil hoejre annullerer en ventende native anmodning saa menuen ikke stjaeler fokus igen', async () => {
  await renderRail();
  await act(async () => control.current!.requestFocus());
  await focus('home');
  expect(control.current!.isFocused()).toBe(false);
  await key('right');
  const calls = mocks.nativeFocus.mock.calls.length;
  await tick(2000);
  expect(mocks.nativeFocus).toHaveBeenCalledTimes(calls);
  expect(entered).toHaveBeenCalledTimes(1);
  expect(mocks.log).not.toHaveBeenCalled();
});

it('Tilbage annullerer en gammel fold-timer mens native fokus stadig er paa vej', async () => {
  await renderRail();
  await focus('guide'); await blur('guide'); await tick(1500);
  await act(async () => control.current!.requestFocus());
  await tick(600);
  expect(textOf(tree!.root.findByType(NavigationRail).findAllByType(host('Text')))).toContain('Guide');
  await focus('guide');
  expect(mocks.log.mock.calls).toEqual([['menu', 'Tilbage: guide, native fokus efter 600 ms']]);
});

it('en daekket skaerm stopper ventende valg, foldning og native forsoeg uden at afspille dem igen', async () => {
  await renderRail();
  const delayedFocus = button('vod').props.onFocus;
  const delayedPress = button('vod').props.onPress;
  await key('down'); await focus('vod'); await blur('vod');
  await act(async () => control.current!.requestFocus());
  expect(mocks.nativeFocus).toHaveBeenCalledTimes(1);
  await renderRail('guide', false);
  expect(control.current!.isFocused()).toBe(false);
  expect(tree!.root.findAllByType(TvPressable).every(node => node.props.focusable === false)).toBe(true);
  await key('down'); await focus('vod');
  await act(async () => { delayedFocus({}); delayedPress(); button('vod').props.onPress(); control.current!.requestFocus(); });
  await renderRail(); await tick(2000);
  expect(control.current!.isFocused()).toBe(false);
  expect(mocks.nativeFocus).toHaveBeenCalledTimes(1);
  expect(selected).not.toHaveBeenCalled(); expect(entered).not.toHaveBeenCalled(); expect(mocks.log).not.toHaveBeenCalled();
});

it('udloeb og afmontering fjerner anmodningen og alle timere', async () => {
  await renderRail();
  await act(async () => control.current!.requestFocus());
  await tick(1500); await focus('guide');
  expect(mocks.log).not.toHaveBeenCalled();
  await blur('guide');
  await act(async () => control.current!.requestFocus());
  await act(async () => tree!.unmount()); tree = null;
  expect(control.current).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});

function homeElement(backRef: { current: () => boolean }, onPlaceChange = vi.fn()) {
  function Home() {
    const [place, setPlace] = useState<HomePlace>({ tab: 'home', browse: null, vod: null });
    return createElement(HomeScreen, {
      session: { db: {}, sources: [], credsBySource: new Map(), fetchImpl: vi.fn() } as unknown as AppSession,
      place, onPlaceChange: next => { onPlaceChange(next); setPlace(next); },
      onSelect: vi.fn(), onOpenVod: vi.fn(), onTrailer: vi.fn(), onSignedOut: vi.fn(), onSourcesChanged: vi.fn(), backRef,
    });
  }
  return createElement(Home);
}

it('HomeScreen genoptegner ikke Hjem, Film eller Radio ved fokus, foldning og Tilbage til menuen', async () => {
  const back = { current: () => false }; const changed = vi.fn();
  await mount(homeElement(back, changed)); await tick(4000);
  expect(counts().every(count => count > 0)).toBe(true);
  const before = counts();
  await key('down'); await focus('home'); await tick(25);
  expect(changed).not.toHaveBeenCalled();
  await blur('home'); await tick(2000);
  mocks.nativeFocus.mockImplementation(props => props.onFocus({}));
  await act(async () => { expect(back.current()).toBe(true); expect(mocks.nativeFocus).toHaveBeenCalledTimes(1); });
  expect(counts()).toEqual(before);
  expect(back.current()).toBe(false);
  expect(counts()).toEqual(before);
});

it('HomeScreen annullerer et gammelt pilvalg naar en undersides Tilbage bruges', async () => {
  const back = { current: () => false }; const changed = vi.fn();
  await mount(homeElement(back, changed)); await tick(4000);
  await act(async () => button('guide').props.onPress());
  changed.mockClear();
  mocks.subpageBack = true;
  await key('down'); await focus('vod');
  await act(async () => { expect(back.current()).toBe(true); });
  await focus('home'); await tick(25);
  expect(changed).not.toHaveBeenCalled();
  expect(mocks.nativeFocus).not.toHaveBeenCalled();
});

it('HomeScreen lader et nyt Tilbage gentage Guide-fokus efter forkert automatisk Hjem-fokus', async () => {
  const back = { current: () => false }; const changed = vi.fn();
  await mount(homeElement(back, changed)); await tick(4000);
  await act(async () => button('guide').props.onPress());
  changed.mockClear();
  const before = counts();
  await act(async () => { expect(back.current()).toBe(true); });
  await focus('home');
  await act(async () => { expect(back.current()).toBe(true); });
  expect(mocks.nativeFocus).toHaveBeenCalledTimes(2);
  const destinations = mocks.nativeFocus.mock.calls.map(([props]) => textOf(props.children));
  expect(destinations[0]).toContain('Guide');
  expect(destinations[1]).toBe(destinations[0]);
  expect(changed).not.toHaveBeenCalled();
  expect(counts()).toEqual(before);
  await focus('guide');
  expect(mocks.log).toHaveBeenCalledTimes(1);
});
