import { createElement, type ElementType, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), channels: vi.fn(), full: vi.fn(), panel: vi.fn(),
  log: vi.fn(), scroll: vi.fn(), keys: new Set<(event: Record<string, unknown>) => void>(),
}));
vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Platform: { isTV: true, OS: 'android' },
    View: 'View', Text: 'Text', Pressable: 'Pressable', ScrollView: 'ScrollView',
    TVFocusGuideView: 'TVFocusGuideView', ActivityIndicator: 'ActivityIndicator', Modal: 'Modal',
    StyleSheet: { create: (s: unknown) => s, hairlineWidth: 0.5 },
    useWindowDimensions: () => ({ width: 864, height: 486 }),
    PanResponder: { create: () => ({ panHandlers: {} }) },
    useTVEventHandler: (handler: (event: Record<string, unknown>) => void) => {
      React.useEffect(() => {
        mocks.keys.add(handler);
        return () => { mocks.keys.delete(handler); };
      }, [handler]);
    },
    // TVOS' VirtualizedList laegger et ekstra View omkring ScrollView.
    // Ref og layout-haendelser er kontrollerede; ingen native fokusmotor.
    FlatList: React.forwardRef(function TestList(props: Record<string, any>, ref) {
      React.useImperativeHandle(ref, () => ({ scrollToIndex: mocks.scroll, scrollToOffset: mocks.scroll }));
      return React.createElement('TVListWrapper', {}, React.createElement('NativeList', props,
        props.data.map((item: unknown, index: number) => React.createElement(React.Fragment,
          { key: props.keyExtractor(item) }, props.renderItem({ item, index })))));
    }),
  };
});
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../../storage/programmes.js', () => ({ listProgrammes: mocks.list }));
vi.mock('../../storage/channels.js', () => ({ listChannels: mocks.channels }));
vi.mock('../../storage/settings.js', () => ({
  getFavoriteGroup: async () => null, getGuideInfoMode: async () => 'normal',
  setFavoriteGroup: async () => {}, sourcesWithDialect: async () => new Set(['source']),
}));
vi.mock('../../storage/favoriteGroups.js', () => ({ listFavoriteGroups: async () => [] }));
vi.mock('../../storage/reminders.js', () => ({ hasReminder: async () => false, addReminder: async () => {}, removeReminder: async () => {} }));
vi.mock('../../sync/epgCache.js', () => ({ ensureFullEpg: mocks.full, ensureEpg: async () => ({ failed: 0 }) }));
vi.mock('../../sync/panelEpg.js', () => ({ panelEpgInFlight: mocks.panel, startPanelEpg: mocks.panel }));
vi.mock('../../sync/weather.js', () => ({ loadCachedWeather: async () => null, refreshWeather: async () => null }));
vi.mock('../../sync/news.js', () => ({ loadCachedNews: async () => null, refreshNews: async () => null }));
vi.mock('../../diagnostics/log.js', () => ({ logEvent: mocks.log, safe: (text: string) => text }));
vi.mock('../../ui/ChannelLogo.js', () => ({ ChannelLogo: () => null }));
vi.mock('../../ui/Notice.js', () => ({ Notice: () => null }));
vi.mock('../preview/MiniPreview.js', () => ({ MiniPreview: () => null }));
vi.mock('./ClockWeather.js', () => ({ ClockWeather: () => null }));
vi.mock('./NewsTicker.js', () => ({ NewsTicker: () => null }));
vi.mock('./NowNextBox.js', () => ({ NowNextBox: () => null }));

import { ChannelDayScreen } from './ChannelDayScreen.js';
import { GuideScreen } from './GuideScreen.js';
import { TimelineGrid } from './TimelineGrid.js';
import { ProgrammeSheet } from './ProgrammeSheet.js';
import { TvPressable } from '../../ui/TvPressable.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const session = { db: {}, credsBySource: new Map([['source', {}]]), fetchImpl: vi.fn() } as unknown as AppSession;
const channel = { id: 'source:1', sourceId: 'source', name: 'Testkanal 1', logoUrls: [], archiveDays: 7, hasArchive: true } as unknown as StoredChannel;
const second = { ...channel, id: 'source:2', name: 'Testkanal 2' };
function programmes(id = channel.id): Programme[] {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return Array.from({ length: 480 }, (_, i) => ({
    channelId: id, title: `Program ${i}`, description: null,
    start: new Date(midnight.getTime() + (i - 336) * 30 * 60_000),
    stop: new Date(midnight.getTime() + (i - 335) * 30 * 60_000),
  }));
}
let rendered: ReactTestRenderer | null = null;
const host = (name: string): ElementType => name as ElementType;
function textOf(node: any): string {
  if (typeof node === 'string') return node;
  if (node == null) return '';
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.children ?? node.props?.children ?? []);
}
async function mount(element: ReactElement, nativeFocus?: (props: any) => void) {
  await act(async () => {
    rendered = create(element, { createNodeMock: (node) => ({ requestTVFocus: () => nativeFocus?.(node.props) }) });
  });
  return rendered!;
}
function dayElement(selected = channel) {
  return createElement(ChannelDayScreen, { session, channel: selected, hasDialect: true, onBack: vi.fn(), onPlay: vi.fn(), onRestart: vi.fn() });
}
async function measureDay(tree: ReactTestRenderer, height = 390) {
  const frame = tree.root.findAllByType(host('View')).find((node) => node.props.style?.minHeight === 0);
  if (frame !== undefined) await act(async () => frame.props.onLayout({ nativeEvent: { layout: { width: 850, height } } }));
}
async function measureTimeline(tree: ReactTestRenderer) {
  const layout = tree.root.findByType(TimelineGrid).findByType(host('TVFocusGuideView')).props.onLayout;
  if (layout !== undefined) await act(async () => layout({ nativeEvent: { layout: { width: 570, height: 400 } } }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 18, 0, 0));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.clearAllMocks();
  mocks.keys.clear();
  mocks.list.mockImplementation(async (_db, id) => programmes(id));
  mocks.channels.mockResolvedValue([channel, second]);
  mocks.full.mockResolvedValue({ failed: 0 });
  mocks.panel.mockReturnValue(null);
});
afterEach(async () => {
  if (rendered !== null) await act(async () => rendered!.unmount());
  rendered = null;
  expect(mocks.keys.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('dagsoversigt paa TV med faktisk React-livscyklus', () => {
  it.each([240, 390, 428])('begraenser det ekstra TV-listelag til %i punkter og lander efter de foerste 12 raekker', async (height) => {
    const tree = await mount(dayElement());
    await measureDay(tree, height);
    const list = tree.root.findByType(host('NativeList'));
    expect(list.props.style.height).toBe(height);
    expect(list.props.data).toHaveLength(48);
    expect(list.props.initialScrollIndex).toBe(36);
    expect(list.props.getItemLayout(null, 36)).toEqual({ index: 36, length: 76, offset: 2736 });
    expect(list.props.onScrollToIndexFailed).toBeUndefined();
  });

  it('viser kanalens nye tabel mens hele panelets fil stadig hentes', async () => {
    const full = deferred<unknown>();
    const panel = deferred<unknown>();
    mocks.list.mockResolvedValueOnce([]);
    mocks.full.mockReturnValue(full.promise);
    mocks.panel.mockReturnValue(panel.promise);
    const tree = await mount(dayElement());
    await measureDay(tree);
    expect(tree.root.findAllByType(host('NativeList')).filter((node) => node.props.data.length > 0)).toHaveLength(0);
    await act(async () => full.resolve({ failed: 0 }));
    expect(tree.root.findByType(host('NativeList')).props.data).toHaveLength(48);
    expect(tree.root.findAllByType(host('ActivityIndicator')).length).toBeGreaterThan(0);
    await act(async () => panel.resolve(null));
  });

  it('supplerer dagsoversigten fra filen ogsaa paa en kanal uden arkiv', async () => {
    const selected = { ...channel, name: 'DNK| V Film Hits', hasArchive: false, archiveDays: 0, epgChannelId: null };
    const all = programmes(selected.id);
    const current = all.filter(p => p.start.getTime() <= Date.now() && p.stop.getTime() > Date.now());
    mocks.list.mockResolvedValueOnce(current).mockResolvedValueOnce(current).mockResolvedValueOnce(all);
    const tree = await mount(dayElement(selected));
    await measureDay(tree);
    expect(mocks.panel).toHaveBeenCalled();
    expect(tree.root.findByType(host('NativeList')).props.data).toHaveLength(48);
    expect(mocks.log).toHaveBeenCalledWith('epg', expect.stringContaining('VFILMHITS, EPG-id nej, arkiv nej'));
    expect(mocks.log).toHaveBeenCalledWith('epg', expect.stringContaining('fuld tabel 480'));
  });

  it('et sent tomt cache-svar kan ikke slette den frisk hentede tabel', async () => {
    const cache = deferred<Programme[]>();
    const panel = deferred<unknown>();
    mocks.list.mockReturnValueOnce(cache.promise);
    mocks.panel.mockReturnValue(panel.promise);
    const tree = await mount(dayElement());
    await measureDay(tree);
    await act(async () => cache.resolve([]));
    expect(tree.root.findByType(host('NativeList')).props.data).toHaveLength(48);
    await act(async () => panel.resolve(null));
  });

  it('dagsskift viser hele dagen fra midnat, ogsaa syv dage tilbage', async () => {
    const tree = await mount(dayElement());
    await measureDay(tree);
    const chips = tree.root.findByType(host('ScrollView')).findAllByType(TvPressable);
    expect(chips).toHaveLength(10);
    await act(async () => chips[0]!.props.onPress());
    const list = tree.root.findByType(host('NativeList'));
    expect(list.props.data).toHaveLength(48);
    expect(list.props.initialScrollIndex).toBe(0);
    expect(list.props.data[0].title).toBe('Program 0');
  });

  it('sen laesning fra en tidligere kanal kan ikke overskrive den nye kanal', async () => {
    const old = deferred<Programme[]>();
    mocks.list.mockReturnValueOnce(old.promise);
    const tree = await mount(dayElement());
    await measureDay(tree);
    await act(async () => tree.update(dayElement(second)));
    await act(async () => old.resolve(programmes(channel.id)));
    expect(tree.root.findByType(host('NativeList')).props.data.every((p: Programme) => p.channelId === second.id)).toBe(true);
  });

  it('beholder programmerne ved fejl i den store fil og afslutter hentemarkeringen', async () => {
    mocks.panel.mockReturnValue(Promise.reject(new Error('test')));
    const tree = await mount(dayElement());
    await measureDay(tree);
    expect(tree.root.findByType(host('NativeList')).props.data).toHaveLength(48);
    expect(tree.root.findAllByType(host('ActivityIndicator'))).toHaveLength(0);
  });
});

describe('Tilbage fra hele dagen bruger den rigtige TV-guide', () => {
  it('opdaterer et aabent programblad naar udbyderen tilfoejer og fjerner arkiv', async () => {
    const without = { ...channel, hasArchive: false, archiveDays: 0 };
    mocks.channels.mockResolvedValue([without, second]);
    const restart = vi.fn();
    const props = { session, onPlay: vi.fn(), onRestart: restart, onAuthError: vi.fn(), onBrowse: vi.fn(),
      previewEnabled: false, previewHandle: { current: null }, active: true };
    const tree = await mount(createElement(GuideScreen, { ...props, reloadToken: 0 }));
    await measureTimeline(tree);
    const row = tree.root.findByType(TimelineGrid).findAllByType(TvPressable).find(n => textOf(n).includes(channel.name))!;
    await act(async () => row.props.onPress());
    let sheet = tree.root.findByType(ProgrammeSheet);
    expect(sheet.props.channel.hasArchive).toBe(false);
    expect(sheet.findAllByType(TvPressable).some(n => textOf(n).includes('Start forfra'))).toBe(false);
    mocks.channels.mockResolvedValue([channel, second]);
    await act(async () => tree.update(createElement(GuideScreen, { ...props, reloadToken: 1 })));
    sheet = tree.root.findByType(ProgrammeSheet);
    expect(sheet.props.channel.hasArchive).toBe(true);
    const button = sheet.findAllByType(TvPressable).find(n => textOf(n).includes('Start forfra'))!;
    expect(button).toBeDefined();
    mocks.channels.mockResolvedValue([without, second]);
    await act(async () => tree.update(createElement(GuideScreen, { ...props, reloadToken: 2 })));
    sheet = tree.root.findByType(ProgrammeSheet);
    expect(sheet.props.channel.hasArchive).toBe(false);
    expect(sheet.findAllByType(TvPressable).some(n => textOf(n).includes('Start forfra'))).toBe(false);
    expect(restart).not.toHaveBeenCalled();
  });
  async function openDay(nativeFocus?: (props: any) => void) {
    const back = { current: () => false };
    const tree = await mount(createElement(GuideScreen, {
      session, backRef: back, onPlay: vi.fn(), onRestart: vi.fn(), onAuthError: vi.fn(), onBrowse: vi.fn(),
      previewEnabled: false, previewHandle: { current: null }, active: true,
    }), nativeFocus);
    await measureTimeline(tree);
    const row = tree.root.findByType(TimelineGrid).findAllByType(TvPressable).find((node) => textOf(node).includes(second.name))!;
    await act(async () => row.props.onFocus());
    await act(async () => row.props.onPress());
    await act(async () => tree.root.findByType(ProgrammeSheet).props.onDay());
    await measureDay(tree);
    return { tree, back };
  }

  it('lukker kun dagssiden og gendanner anden kanal indtil native fokus bekraeftes', async () => {
    const focus = vi.fn((props) => props.onFocus?.({}));
    const { tree, back } = await openDay(focus);
    let handled = false;
    await act(async () => { handled = back.current(); });
    expect(handled).toBe(true);
    expect(tree.root.findAllByType(ChannelDayScreen)).toHaveLength(0);
    expect(tree.root.findByType(TimelineGrid).props.returnFocusChannelId).toBe(second.id);
    await act(async () => { vi.advanceTimersByTime(20); });
    expect(focus).toHaveBeenCalled();
    expect(textOf({ children: focus.mock.calls[0]![0].children })).toContain(second.name);
    expect(tree.root.findByType(TimelineGrid).props.returnFocusChannelId).toBe(null);
    expect(mocks.log).toHaveBeenCalledWith('guide', expect.stringContaining('fokus bekraeftet'));
  });

  it('skjult guide reagerer ikke paa dagsvaelgerens venstre/hoejre', async () => {
    const { tree } = await openDay();
    await act(async () => {
      for (const handler of mocks.keys) handler({ eventType: 'left', eventKeyAction: 1 });
    });
    expect(tree.root.findByType(TimelineGrid).props.offsetMinutes).toBe(0);
  });

  it('hurtig Tilbage til menuen annullerer guidens ventende native fokusmaal', async () => {
    const focus = vi.fn();
    const { tree, back } = await openDay(focus);
    await act(async () => { expect(back.current()).toBe(true); });
    expect(tree.root.findByType(TimelineGrid).props.returnFocusChannelId).toBe(second.id);
    await act(async () => { expect(back.current()).toBe(false); });
    expect(tree.root.findByType(TimelineGrid).props.returnFocusChannelId).toBe(null);
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(focus).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalledWith('guide', expect.stringContaining('ikke bekraeftet'));
  });

  it('holder fokusmaalet ved langsom native tilbagevenden og rydder gentagelser efter fokus', async () => {
    const readyAt = Date.now() + 500;
    const focus = vi.fn((props) => { if (Date.now() >= readyAt) props.onFocus?.({}); });
    const { tree, back } = await openDay(focus);
    await act(async () => { back.current(); vi.advanceTimersByTime(300); });
    expect(tree.root.findByType(TimelineGrid).props.returnFocusChannelId).toBe(second.id);
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(tree.root.findByType(TimelineGrid).props.returnFocusChannelId).toBe(null);
    const count = focus.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(focus).toHaveBeenCalledTimes(count);
  });

  it('stopper efter en afgraenset ventetid uden at logge falsk fokusbekraeftelse', async () => {
    const { tree, back } = await openDay();
    await act(async () => { back.current(); });
    await act(async () => { vi.advanceTimersByTime(1600); });
    expect(tree.root.findByType(TimelineGrid).props.returnFocusChannelId).toBe(null);
    expect(mocks.log).toHaveBeenCalledWith('guide', expect.stringContaining('ikke bekraeftet'));
    expect(mocks.log).not.toHaveBeenCalledWith('guide', expect.stringContaining(': fokus bekraeftet'));
  });
});
