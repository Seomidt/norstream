import { createElement, type ElementType, type ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), channels: vi.fn(), full: vi.fn(), panel: vi.fn(),
  log: vi.fn(), scroll: vi.fn(), appListeners: new Set<(state:string)=>void>(), keys: new Set<(event: Record<string, unknown>) => void>(),
}));
vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Platform: { isTV: true, OS: 'android' },
    AppState: {currentState:'active',addEventListener:(_event:string,listener:(state:string)=>void)=>{mocks.appListeners.add(listener);return{remove(){mocks.appListeners.delete(listener);}}}},
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
vi.mock('../../sync/epgCache.js', () => ({
  ensureFullEpg: mocks.full,
  ensureEpg: async (_db: unknown, _creds: unknown, _fetch: unknown, ids: string[], now: Date, limit: number, options: {onProgrammes?: (id: string, rows: Programme[]) => void}) => {
    let count = 0;
    for (const id of ids) {
      const rows = programmes(id).filter(p => p.stop > now).slice(0, limit);
      options?.onProgrammes?.(id, rows);
      count += rows.length;
    }
    return {fetched:ids.length,programmes:count,failed:0,reason:null};
  },
}));
vi.mock('../../sync/panelEpg.js', () => ({ panelEpgInFlight: mocks.panel, startPanelEpg: mocks.panel, syncPanelEpg: mocks.panel }));
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
import type { CellState } from './layout.js';
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
function dayElement(selected = channel, active = true) {
  return createElement(ChannelDayScreen, { session, channel: selected, hasDialect: true, active, onBack: vi.fn(), onPlay: vi.fn(), onRestart: vi.fn() });
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
  mocks.full.mockResolvedValue({ fetched: 1, programmes: 1, failed: 0, reason: null });
  mocks.panel.mockReturnValue(null);
});
afterEach(async () => {
  if (rendered !== null) await act(async () => rendered!.unmount());
  rendered = null;
  expect(mocks.keys.size).toBe(0);
  expect(mocks.appListeners.size).toBe(0);
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

  it('viser det gemte straks, men fornyer denne kanals dagsplan ved indgang (v426)', async () => {
    const full = deferred<unknown>();
    mocks.full.mockReturnValue(full.promise);
    const tree = await mount(dayElement());
    await measureDay(tree);
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(tree.root.findByType(host('NativeList')).props.data).toHaveLength(48);
    expect(mocks.full.mock.calls[0]![5]).toMatchObject({ shouldContinue: expect.any(Function) });
    expect(mocks.full.mock.calls[0]![5].force).toBe(true);
    await act(async () => full.resolve({ fetched: 1, programmes: 480, failed: 0, reason: null }));
    expect(tree.root.findByType(host('NativeList')).props.data).toHaveLength(48);
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(tree.root.findAllByType(host('ActivityIndicator'))).toHaveLength(0);
  });

  it('supplerer dagsoversigten fra filen ogsaa paa en kanal uden arkiv', async () => {
    const selected = { ...channel, name: 'DNK| V Film Hits', hasArchive: false, archiveDays: 0, epgChannelId: null };
    const all = programmes(selected.id);
    mocks.full.mockResolvedValue({ fetched: 1, programmes: 0, failed: 0, reason: null });
    mocks.panel.mockResolvedValue({ matched: 1, programmes: all.length });
    mocks.list.mockResolvedValue(all);
    const tree = await mount(dayElement(selected));
    await measureDay(tree);
    expect(mocks.panel).toHaveBeenCalled();
    expect(tree.root.findByType(host('NativeList')).props.data).toHaveLength(48);
    expect(mocks.log).toHaveBeenCalledWith('epg', expect.stringContaining('VFILMHITS, EPG-id nej, arkiv nej'));
    expect(mocks.log).toHaveBeenCalledWith('epg', expect.stringContaining('fuld tabel 480'));
  });

  it('et sent SQL-svar fra en skjult aabning kan ikke overskrive en ny frisk aabning', async () => {
    const cache = deferred<Programme[]>();
    mocks.list.mockReturnValueOnce(cache.promise);
    const tree = await mount(dayElement());
    await measureDay(tree);
    await act(async () => tree.update(dayElement(channel, false)));
    await act(async () => tree.update(dayElement(channel, true)));
    expect(tree.root.findByType(host('NativeList')).props.data).toHaveLength(48);
    // Den skjulte aabning naaede aldrig til panelet; kun den nye spoerger.
    expect(mocks.full).toHaveBeenCalledTimes(1);
    await act(async () => cache.resolve([]));
    expect(tree.root.findByType(host('NativeList')).props.data).toHaveLength(48);
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

  it('en panelfejl skjuler ikke den gemte tabel', async () => {
    mocks.full.mockResolvedValue({ fetched: 0, programmes: 0, failed: 1, reason: 'x' });
    const tree = await mount(dayElement());
    await measureDay(tree);
    expect(tree.root.findByType(host('NativeList')).props.data).toHaveLength(48);
    expect(textOf(tree.toJSON())).not.toContain('kunne ikke hentes');
  });

  it('viser en sikker fejl naar intet er gemt og panelhentningen fejler', async () => {
    mocks.full.mockResolvedValue({ fetched: 0, programmes: 0, failed: 1, reason: 'https://secret.example/password' });
    mocks.list.mockResolvedValue([]);
    const tree = await mount(dayElement());
    await measureDay(tree);
    expect(tree.root.findAllByType(host('NativeList'))).toHaveLength(0);
    expect(textOf(tree.toJSON())).toContain('Programoversigten kunne ikke hentes');
    expect(textOf(tree.toJSON())).not.toContain('secret.example');
    expect(tree.root.findAllByType(host('ActivityIndicator'))).toHaveLength(0);
  });

  it('starter ikke dags-EPG naar afspilleren daekker den, og stopper koesatte kald ved unmount', async () => {
    const full = deferred<unknown>();
    mocks.full.mockReturnValue(full.promise);
    const tree = await mount(dayElement(channel, false));
    expect(mocks.full).not.toHaveBeenCalled();
    await act(async () => tree.update(dayElement(channel, true)));
    const shouldContinue = mocks.full.mock.calls[0]![5].shouldContinue as () => boolean;
    expect(shouldContinue()).toBe(true);
    await act(async () => { tree.unmount(); rendered = null; });
    expect(shouldContinue()).toBe(false);
    const reads = mocks.list.mock.calls.length;
    await act(async () => full.resolve({ fetched: 1, programmes: 10, failed: 0, reason: null }));
    expect(mocks.list).toHaveBeenCalledTimes(reads);
  });

  it('viser kun den senest begyndte udsendelse som Sendes nu ved overlap', async () => {
    const ms=Date.now();
    const items: Programme[] = [
      {channelId:channel.id,title:'Aeldre overlap',description:null,start:new Date(ms-30*60_000),stop:new Date(ms+30*60_000)},
      {channelId:channel.id,title:'Aktuelt',description:null,start:new Date(ms),stop:new Date(ms+60*60_000)},
    ];
    mocks.list.mockResolvedValue(items);
    const tree=await mount(dayElement());await measureDay(tree);
    expect(textOf(tree.toJSON()).split('Sendes nu').length-1).toBe(1);
    const list=tree.root.findByType(host('NativeList'));
    expect(list.props.initialScrollIndex).toBe(1);
    expect(list.props.data[0]).toBe(items[0]);
    expect(items[0]!.stop.getTime()).toBe(ms+30*60_000);
  });

  it('viser M3U-kanalens importerede data uden et panelkald', async () => {
    const imported = { ...session, credsBySource: new Map(), access: () => ({ source: {kind:'m3u'}, creds: null }) } as unknown as AppSession;
    const tree = await mount(createElement(ChannelDayScreen, {session: imported,channel,hasDialect:false,onBack:vi.fn(),onPlay:vi.fn(),onRestart:vi.fn()}));
    await measureDay(tree);
    expect(mocks.full).not.toHaveBeenCalled();
    expect(tree.root.findByType(host('NativeList')).props.data).toHaveLength(48);
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
    // Raekkens OK aabner den udsendelse der sendes nu (18:00-18:30). Den kan
    // ikke startes forfra mens den sendes (v425), saa arkivet ses i bladets
    // forklaring og ikke i en knap.
    let sheet = tree.root.findByType(ProgrammeSheet);
    expect(sheet.props.channel.hasArchive).toBe(false);
    expect(sheet.props.state).toBe('live');
    expect(sheet.findAllByType(TvPressable).some(n => textOf(n).includes('Start forfra'))).toBe(false);
    expect(textOf(tree.toJSON())).toContain('Kanalen har intet arkiv');
    mocks.channels.mockResolvedValue([channel, second]);
    await act(async () => tree.update(createElement(GuideScreen, { ...props, reloadToken: 1 })));
    sheet = tree.root.findByType(ProgrammeSheet);
    expect(sheet.props.channel.hasArchive).toBe(true);
    expect(sheet.findAllByType(TvPressable).some(n => textOf(n).includes('Start forfra'))).toBe(false);
    expect(textOf(tree.toJSON())).toContain('Start forfra bliver muligt, når udsendelsen er slut (kl. 18:30).');
    expect(textOf(tree.toJSON())).not.toContain('intet arkiv');
    mocks.channels.mockResolvedValue([without, second]);
    await act(async () => tree.update(createElement(GuideScreen, { ...props, reloadToken: 2 })));
    sheet = tree.root.findByType(ProgrammeSheet);
    expect(sheet.props.channel.hasArchive).toBe(false);
    expect(sheet.findAllByType(TvPressable).some(n => textOf(n).includes('Start forfra'))).toBe(false);
    expect(textOf(tree.toJSON())).toContain('Kanalen har intet arkiv');
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

describe('Start forfra kun naar udsendelsen er slut og helt i arkivet (v425)', () => {
  // Klokken er 18:00:00 (beforeEach). Tiderne herunder er lokal tid.
  function at(hour: number, minute: number, second = 0): Date {
    return new Date(2026, 9, 12, hour, minute, second);
  }
  function programmeAt(start: Date, stop: Date, title = 'Udsendelse'): Programme {
    return { channelId: channel.id, title, description: null, start, stop };
  }
  function sheetElement(programme: Programme, state: CellState, overrides: Record<string, unknown> = {}) {
    return createElement(ProgrammeSheet, {
      channel, programme, state, hasDialect: true, nowMs: Date.now(),
      onPlay: vi.fn(), onRestart: vi.fn(), onClose: vi.fn(), ...overrides,
    });
  }
  const buttons = (tree: ReactTestRenderer) => tree.root.findAllByType(TvPressable);
  const restartButton = (tree: ReactTestRenderer) => buttons(tree).find(n => textOf(n).includes('Start forfra'));
  const playButton = (tree: ReactTestRenderer) => buttons(tree).find(n => textOf(n).includes(`Se ${channel.name}`));

  it('en udsendelse der sendes nu: ingen knap, og forklaringen naevner sluttidspunktet', async () => {
    const tree = await mount(sheetElement(programmeAt(at(17, 30), at(18, 30)), 'live'));
    expect(restartButton(tree)).toBeUndefined();
    expect(textOf(tree.toJSON())).toContain('Start forfra bliver muligt, når udsendelsen er slut (kl. 18:30).');
    // Fjernbetjeningen lander paa "Se kanalen", naar start forfra ikke er der.
    expect(playButton(tree)?.props.hasTVPreferredFocus).toBe(true);
  });

  it('en udsendelse der sluttede for 60 s siden: ingen knap, arkivet faar de sidste minutter', async () => {
    const programme = programmeAt(at(17, 0), at(17, 59));
    const tree = await mount(sheetElement(programme, 'past'));
    expect(restartButton(tree)).toBeUndefined();
    expect(textOf(tree.toJSON())).toContain('Start forfra bliver muligt om et øjeblik: arkivet får udsendelsens sidste minutter.');
    expect(playButton(tree)?.props.hasTVPreferredFocus).toBe(true);
    // To minutter efter slut (naeste minuttik i guiden) kommer knappen frem.
    await act(async () => tree.update(sheetElement(programme, 'past', { nowMs: at(18, 1).getTime() })));
    expect(restartButton(tree)).toBeDefined();
    expect(textOf(tree.toJSON())).not.toContain('bliver muligt');
  });

  it('en udsendelse der sluttede for 3 min siden: knappen er der og starter netop den', async () => {
    const restart = vi.fn();
    const programme = programmeAt(at(17, 0), at(17, 57));
    const tree = await mount(sheetElement(programme, 'past', { onRestart: restart }));
    const button = restartButton(tree)!;
    expect(button).toBeDefined();
    expect(button.props.hasTVPreferredFocus).toBe(true);
    expect(playButton(tree)).toBeUndefined();
    expect(textOf(tree.toJSON())).not.toContain('bliver muligt');
    await act(async () => button.props.onPress());
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('en kommende udsendelse faar ingen arkivforklaring', async () => {
    const tree = await mount(sheetElement(programmeAt(at(19, 0), at(19, 30)), 'future'));
    expect(restartButton(tree)).toBeUndefined();
    const text = textOf(tree.toJSON());
    expect(text).not.toContain('arkiv');
    expect(text).not.toContain('Start forfra');
  });

  it('uden dialekt eller arkiv staar den gamle forklaring, ogsaa for den der sendes nu', async () => {
    const live = programmeAt(at(17, 30), at(18, 30));
    let tree = await mount(sheetElement(live, 'live', { hasDialect: false }));
    expect(textOf(tree.toJSON())).toContain('Appen har ikke fundet vejen til udbyderens arkiv endnu');
    await act(async () => { tree.unmount(); rendered = null; });
    tree = await mount(sheetElement(live, 'live', { channel: { ...channel, hasArchive: false, archiveDays: 0 } }));
    expect(textOf(tree.toJSON())).toContain('Kanalen har intet arkiv hos udbyderen');
    expect(restartButton(tree)).toBeUndefined();
  });

  it('dagsoversigten maerker kun udsendelser der er helt i arkivet, og foelger klokken', async () => {
    const tree = await mount(dayElement());
    await measureDay(tree);
    const row = (title: string) => tree.root.findByType(host('NativeList')).findAllByType(TvPressable)
      .find(n => textOf(n).includes(title))!;
    // Program 370: 17:00-17:30, helt i arkivet. Program 371: 17:30-18:00, lige
    // slut. Program 372: 18:00-18:30, sendes nu.
    expect(textOf(row('Program 370'))).toContain('⏱ Start forfra');
    expect(textOf(row('Program 371'))).not.toContain('Start forfra');
    expect(textOf(row('Program 372'))).toContain('Sendes nu');
    expect(textOf(row('Program 372'))).not.toContain('Start forfra');
    // Klokken tikker til 18:02: nu er de sidste minutter af 371 i arkivet.
    await act(async () => { vi.advanceTimersByTime(120_000); });
    expect(textOf(row('Program 371'))).toContain('⏱ Start forfra');
    expect(textOf(row('Program 372'))).not.toContain('Start forfra');
  });

  it('et tryk paa en udsendelse der lige er slut aabner bladet med forklaringen og starter ikke arkivet', async () => {
    const restart = vi.fn();
    const tree = await mount(createElement(ChannelDayScreen, {
      session, channel, hasDialect: true, onBack: vi.fn(), onPlay: vi.fn(), onRestart: restart,
    }));
    await measureDay(tree);
    const rows = () => tree.root.findByType(host('NativeList')).findAllByType(TvPressable);
    const justEnded = rows().find(n => textOf(n).includes('Program 371'))!;
    await act(async () => justEnded.props.onPress());
    let sheet = tree.root.findByType(ProgrammeSheet);
    expect(sheet.props.programme.title).toBe('Program 371');
    expect(sheet.findAllByType(TvPressable).some(n => textOf(n).includes('Start forfra'))).toBe(false);
    expect(textOf(tree.toJSON())).toContain('om et øjeblik');
    expect(restart).not.toHaveBeenCalled();
    await act(async () => sheet.props.onClose());
    // Den der er helt i arkivet starter forfra fra bladet, med netop den udsendelse.
    const settled = rows().find(n => textOf(n).includes('Program 370'))!;
    await act(async () => settled.props.onPress());
    sheet = tree.root.findByType(ProgrammeSheet);
    const button = sheet.findAllByType(TvPressable).find(n => textOf(n).includes('Start forfra'))!;
    expect(button).toBeDefined();
    await act(async () => button.props.onPress());
    expect(restart).toHaveBeenCalledTimes(1);
    expect(restart.mock.calls[0]![0]).toBe(channel);
    expect(restart.mock.calls[0]![1].title).toBe('Program 370');
    expect(tree.root.findAllByType(ProgrammeSheet)).toHaveLength(0);
  });
});


describe('absolut dato og autoritativ dagsplan v426', () => {
  const at = (day: number, hour = 19) => new Date(2026, 9, day, hour, 0, 0);
  const episode = (day: number, title: string): Programme => ({channelId:channel.id,title,description:null,start:at(day),stop:at(day,20)});

  it('holder onsdag 21/10 og onsdag 28/10 adskilt med dato i dagvalget', async () => {
    vi.setSystemTime(at(28,21));
    const old=episode(21,'Afsnit fra 21/10'), current=episode(28,'Afsnit fra 28/10');
    mocks.list.mockResolvedValue([old,current]);
    const tree=await mount(dayElement());await measureDay(tree);
    const rows=()=>tree.root.findByType(host('NativeList')).props.data as Programme[];
    expect(rows().map(p=>p.title)).toEqual(['Afsnit fra 28/10']);
    const chips=tree.root.findByType(host('ScrollView')).findAllByType(TvPressable);
    expect(chips.some(n=>textOf(n)==='I dag 28.10')).toBe(true);
    const lastWednesday=chips.find(n=>textOf(n)==='ons 21.10')!;
    await act(async()=>lastWednesday.props.onPress());
    expect(rows().map(p=>p.title)).toEqual(['Afsnit fra 21/10']);
    await act(async()=>chips.find(n=>textOf(n)==='I dag 28.10')!.props.onPress());
    expect(rows().map(p=>p.title)).toEqual(['Afsnit fra 28/10']);
  });

  it('et friskt API-svar erstatter dagens gamle plan uden genindblanding fra SQL', async () => {
    vi.setSystemTime(at(28,21));
    const stale=episode(28,'Gammel plan'), fresh=episode(28,'Ny plan');
    mocks.list.mockResolvedValue([stale]);
    mocks.full.mockImplementation(async (...args: any[])=>{args[5].onProgrammes(channel.id,[fresh]);return{fetched:1,programmes:1,failed:0};});
    const tree=await mount(dayElement());await measureDay(tree);
    expect(mocks.full.mock.calls[0]![5].force).toBe(true);
    expect(tree.root.findByType(host('NativeList')).props.data.map((p:Programme)=>p.title)).toEqual(['Ny plan']);
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it('et aabent vindue skifter faktisk kalenderdag og viser ikke gaarsdagens liste under nyt navn', async () => {
    vi.setSystemTime(at(21,23));
    const shared=[episode(21,'Foerste onsdag'),episode(28,'Naeste onsdag')];
    mocks.list.mockResolvedValue(shared);
    mocks.full.mockResolvedValue({fetched:0,programmes:0,failed:0});
    const tree=await mount(dayElement());await measureDay(tree);
    expect(tree.root.findByType(host('NativeList')).props.data[0].title).toBe('Foerste onsdag');
    vi.setSystemTime(at(28,21));
    await act(async()=>{await vi.advanceTimersByTimeAsync(60_000);});
    expect(tree.root.findByType(host('NativeList')).props.data[0].title).toBe('Naeste onsdag');
  });
});


it('standby fra onsdag 21/10 til onsdag 28/10: rigtig dato og plan straks ved genoptagelse, foer noget minut-tik', async () => {
  const at=(day:number)=>new Date(2026,9,day,20,0,0);
  const item=(day:number):Programme=>({channelId:channel.id,title:`Udsendelse ${day}/10`,description:null,start:new Date(2026,9,day,19),stop:at(day)});
  const shared=[item(21),item(28)];
  vi.setSystemTime(at(21));mocks.list.mockResolvedValue(shared);mocks.full.mockResolvedValue({fetched:0,programmes:0,failed:0});
  const tree=await mount(dayElement());await measureDay(tree);
  expect(tree.root.findByType(host('NativeList')).props.data[0].title).toBe('Udsendelse 21/10');
  const row=tree.root.findAllByType(TvPressable).find(n=>textOf(n).includes('Udsendelse 21/10'))!;
  await act(async()=>row.props.onPress());
  expect(tree.root.findAllByType(ProgrammeSheet)).toHaveLength(1);
  await act(async()=>{for(const f of mocks.appListeners)f('background');});
  vi.setSystemTime(at(28));
  await act(async()=>{for(const f of mocks.appListeners)f('active');});
  expect(tree.root.findByType(host('NativeList')).props.data[0].title).toBe('Udsendelse 28/10');
  const chips=tree.root.findByType(host('ScrollView')).findAllByType(TvPressable);
  expect(chips.some(n=>textOf(n)==='I dag 28.10')).toBe(true);
  expect(tree.root.findAllByType(ProgrammeSheet)).toHaveLength(0);
});


describe('dagraekken i Hele dagen v427', () => {
  const at = (day: number, hour = 19) => new Date(2026, 9, day, hour, 0, 0);
  const item = (day: number, title: string): Programme => ({ channelId: channel.id, title, description: null, start: at(day), stop: at(day, 20) });
  const chipTexts = (tree: ReactTestRenderer) => tree.root.findByType(host('ScrollView')).findAllByType(TvPressable).map(textOf);
  const rows = (tree: ReactTestRenderer) => (tree.root.findByType(host('NativeList')).props.data as Programme[]).map(p => p.title);

  it('vokser ikke foran I dag naar panelets friske svar raekker laengere tilbage end det gemte', async () => {
    // Torsdag 29/10: det gemte gaar til mandag 26/10, panelets svar til torsdag 22/10.
    vi.setSystemTime(at(29, 15));
    mocks.list.mockResolvedValue([item(26, 'Mandag'), item(29, 'I dag')]);
    // Panelets svar kommer efter det gemte, som paa boksen (1,5 s senere i loggen).
    let answer!: () => void;
    mocks.full.mockImplementation((...args: any[]) => new Promise(resolve => {
      answer = () => {
        args[5].onProgrammes(channel.id, [item(22, 'Torsdag i sidste uge'), item(26, 'Mandag'), item(29, 'I dag')]);
        resolve({ fetched: 1, programmes: 3, failed: 0 });
      };
    }));
    const tree = await mount(dayElement({ ...channel, archiveDays: 3 } as StoredChannel));
    await measureDay(tree);
    expect(chipTexts(tree)[0]).toBe('man 26.10');
    await act(async () => { answer(); });
    const chips = chipTexts(tree);
    // Tre dage tilbage fra det gemte, ingen "tor 22.10" sat ind foran fokus.
    expect(chips[0]).toBe('man 26.10');
    expect(chips).not.toContain('tor 22.10');
    expect(chips).toContain('I dag 29.10');
    expect(rows(tree)).toEqual(['I dag']);
    // Den valgte dag har fokus-praeferencen, ikke den foerste knap.
    const preferred = tree.root.findByType(host('ScrollView')).findAllByType(TvPressable).filter(n => n.props.hasTVPreferredFocus === true).map(textOf);
    expect(preferred.every(text => text === 'I dag 29.10')).toBe(true);
  });

  it('aabner paa I dag ved kanalskift, ogsaa naar en dag i sidste uge var valgt', async () => {
    vi.setSystemTime(at(29, 15));
    mocks.list.mockResolvedValue([item(22, 'Torsdag i sidste uge'), item(29, 'I dag')]);
    mocks.full.mockResolvedValue({ fetched: 0, programmes: 0, failed: 0 });
    const tree = await mount(dayElement());
    await measureDay(tree);
    const lastThursday = tree.root.findByType(host('ScrollView')).findAllByType(TvPressable).find(n => textOf(n) === 'tor 22.10')!;
    await act(async () => lastThursday.props.onPress());
    expect(rows(tree)).toEqual(['Torsdag i sidste uge']);
    const other = { ...channel, id: 'source:2', name: 'Testkanal 2' } as StoredChannel;
    mocks.list.mockResolvedValue([{ ...item(22, 'Anden kanal sidste uge'), channelId: other.id }, { ...item(29, 'Anden kanal i dag'), channelId: other.id }]);
    await act(async () => { tree.update(dayElement(other)); });
    await measureDay(tree);
    expect(rows(tree)).toEqual(['Anden kanal i dag']);
  });
});
