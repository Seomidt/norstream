import { createElement, type ElementType } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Programme } from '@norstream/core';
import type { AppSession } from '../../session.js';
import type { StoredChannel } from '../../storage/channels.js';

const mocks = vi.hoisted(() => ({
  list: vi.fn(), short: vi.fn(), full: vi.fn(), scroll: vi.fn(), focus: vi.fn(),
  keys: new Set<(event: Record<string, unknown>) => void>(),
}));
vi.mock('react-native', async () => {
  const React = await import('react');
  return {
    Platform: { isTV: true, OS: 'android' },
    View: 'View', Text: 'Text', Pressable: 'Pressable', TVFocusGuideView: 'TVFocusGuideView',
    StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 0.5 },
    useTVEventHandler: (handler: (event: Record<string, unknown>) => void) => {
      React.useEffect(() => {
        mocks.keys.add(handler);
        return () => { mocks.keys.delete(handler); };
      }, [handler]);
    },
    // Denne native erstatning monterer kun et vindue. Et offscreen fokusmaal
    // bliver foerst til et native view naar scrollToIndex har flyttet vinduet.
    FlatList: React.forwardRef(function VirtualList(props: Record<string, any>, ref) {
      const [index, setIndex] = React.useState(props.initialScrollIndex ?? 0);
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: (options: { index: number }) => {
          mocks.scroll(options);
          setIndex(options.index);
        },
      }), []);
      const count = props.initialNumToRender ?? 10;
      const start = Math.max(0, Math.min(props.data.length - count, index - Math.floor(count / 2)));
      return React.createElement('NativeList', props,
        props.data.slice(start, start + count).map((item: StoredChannel, offset: number) =>
          React.createElement(React.Fragment, { key: props.keyExtractor(item) },
            props.renderItem({ item, index: start + offset }))));
    }),
  };
});
vi.mock('../../storage/programmes.js', () => ({ listProgrammesFor: mocks.list }));
vi.mock('../../sync/epgCache.js', () => ({ ensureEpg: mocks.short, ensureFullEpg: mocks.full }));
vi.mock('../../ui/ChannelLogo.js', () => ({ ChannelLogo: () => null }));

import { TimelineGrid } from './TimelineGrid.js';
import { TvPressable } from '../../ui/TvPressable.js';
import { invalidateQueryCache } from '../../storage/queryCache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const host = (name: string): ElementType => name as ElementType;
const channel = (index: number) => ({
  id: `timeline:${index}`, sourceId: 'timeline', name: `Kanal ${index}`,
  logoUrls: [], archiveDays: 7, hasArchive: true,
}) as unknown as StoredChannel;
const channels = Array.from({ length: 1000 }, (_, index) => channel(index));
let session: AppSession;
type Props = Parameters<typeof TimelineGrid>[0];
function props(overrides: Partial<Props> = {}): Props {
  return {
    session, channels, now: new Date(2026, 9, 12, 18), hasDialectFor: () => true,
    onFocusChannel: vi.fn(), onFocusProgramme: vi.fn(), onOpen: vi.fn(),
    offsetMinutes: 0, onStepTime: vi.fn(), focusFirstSignal: 0, active: true,
    returnFocusChannelId: null, onReturnFocus: vi.fn(), ...overrides,
  };
}
function text(node: any): string {
  if (typeof node === 'string') return node;
  if (node == null) return '';
  return Array.isArray(node) ? node.map(text).join('') : text(node.children ?? node.props?.children);
}
let tree: ReactTestRenderer | null = null;
async function mount(value: Props) {
  await act(async () => {
    tree = create(createElement(TimelineGrid, value), {
      createNodeMock: (node) => ({ requestTVFocus: () => mocks.focus(node.props) }),
    });
  });
  await act(async () => {
    tree!.root.findByType(host('TVFocusGuideView')).props.onLayout({ nativeEvent: { layout: { width: 570, height: 400 } } });
  });
  return tree!;
}
const row = (index: number) => tree!.root.findAllByType(TvPressable).find(node => text(node).includes(`Kanal ${index}`))!;
const cached = (index: number): Programme[] => tree!.root.findByType(host('NativeList')).props
  .renderItem({ item: channels[index], index }).props.programmes;
const view = async (index: number) => act(async () => {
  tree!.root.findByType(host('NativeList')).props.onViewableItemsChanged({
    viewableItems: [{ item: channels[index], index, isViewable: true }], changed: [],
  });
});
function programme(id: string, title = `Program ${id}`): Programme {
  return { channelId: id, title, description: null,
    start: new Date(Date.now() - 60_000), stop: new Date(Date.now() + 120 * 60_000) };
}
const programmesFor = async (_db: unknown, ids: string[]) => ids.map(id => programme(id));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 12, 18));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (run: () => void) => setTimeout(run, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.clearAllMocks(); mocks.keys.clear();
  session = { db: {}, credsBySource: new Map([['timeline', {}]]), fetchImpl: vi.fn() } as unknown as AppSession;
  mocks.list.mockResolvedValue([]);
  mocks.short.mockResolvedValue({ failed: 0 });
  mocks.full.mockResolvedValue({ failed: 0 });
});
afterEach(async () => {
  if (tree !== null) await act(async () => tree!.unmount());
  tree = null;
  expect(mocks.keys.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
  vi.unstubAllGlobals(); vi.useRealTimers();
});

it('en aendret EPG-korrektion viser ikke gamle varme programtider mens SQLite genlaeses', async () => {
  mocks.list.mockImplementation(programmesFor);
  const options = props();
  await mount(options);
  expect(cached(0)).toHaveLength(1);
  await act(async () => { tree!.unmount(); tree = null; });
  invalidateQueryCache();
  const held = deferred<Programme[]>();
  mocks.list.mockImplementation(() => held.promise);
  await mount(options);
  expect(cached(0)).toEqual([]);
  const corrected = { ...programme(channels[0]!.id, '19 News'), start: new Date(Date.now() + 60 * 60_000) };
  await act(async () => held.resolve([corrected]));
  expect(cached(0)[0]?.title).toBe('19 News');
  expect(cached(0)[0]?.start).toEqual(corrected.start);
});

it('et gammelt SQLite-svar maa ikke gemme tidligere EPG-tider efter en tidskorrektion', async () => {
  const held = deferred<Programme[]>();
  mocks.list.mockImplementation(() => held.promise);
  const options = props();
  await mount(options);
  invalidateQueryCache();
  mocks.list.mockImplementation(async (_db: unknown, ids: string[]) => ids.map(id => programme(id, '19 News')));
  await act(async () => held.resolve([programme(channels[0]!.id, 'Gammel kl. 18')]));
  expect(cached(0).some(item => item.title === 'Gammel kl. 18')).toBe(false);
  await act(async () => tree!.update(createElement(TimelineGrid, options)));
  expect(cached(0)[0]?.title).toBe('19 News');
});

it('tegner et begraenset TV-vindue for 1000 kanaler med fast layout til alle indeks', async () => {
  const value = await mount(props());
  const list = value.root.findByType(host('NativeList'));
  expect(list.props.data).toHaveLength(1000);
  expect(list.props.initialNumToRender).toBeLessThanOrEqual(12);
  expect(list.props.maxToRenderPerBatch).toBeLessThanOrEqual(12);
  expect(list.props.windowSize).toBeLessThanOrEqual(5);
  expect(value.root.findAllByType(TvPressable).length).toBeLessThanOrEqual(12);
  expect(list.props.getItemLayout(null, 999)).toEqual({ length: 62, offset: 61938, index: 999 });
  expect(new Set(mocks.list.mock.calls.flatMap(call => call[1])).size).toBeLessThan(50);
  expect(mocks.list.mock.calls.every(call => call[1].length <= 23)).toBe(true);
  expect(mocks.list.mock.calls.every(call => call[3].getTime() - call[2].getTime() === 90 * 60_000)).toBe(true);
  expect(mocks.short.mock.calls.every(call => call[3].length <= 12)).toBe(true);
});

it('ruller et fokusmaal uden for vinduet ind og beholder det indtil native bekraeftelse', async () => {
  const options = props();
  await mount(options);
  expect(row(900)).toBeUndefined();
  await act(async () => tree!.update(createElement(TimelineGrid, { ...options, returnFocusChannelId: channels[900]!.id })));
  expect(mocks.scroll).toHaveBeenCalledWith({ index: 900, viewPosition: 0.5, animated: false });
  expect(row(900)).toBeDefined();
  await act(async () => { vi.advanceTimersByTime(20); });
  expect(mocks.focus.mock.calls.some(call => text(call[0]).includes('Kanal 900'))).toBe(true);
  expect(options.onReturnFocus).not.toHaveBeenCalled();
  await act(async () => row(900).props.onFocus());
  expect(options.onReturnFocus).toHaveBeenCalledWith(true);
  const count = mocks.focus.mock.calls.length;
  await act(async () => { vi.advanceTimersByTime(1600); });
  expect(mocks.focus).toHaveBeenCalledTimes(count);
  expect(options.onReturnFocus).not.toHaveBeenCalledWith(false);
});

it('holder op/ned fokus i midten og behandler venstre/hoejre kun ved tastslip', async () => {
  const options = props({ channels: channels.slice(0, 12) });
  await mount(options);
  await act(async () => row(2).props.onFocus());
  await act(async () => row(3).props.onFocus());
  await act(async () => row(2).props.onFocus());
  expect(mocks.scroll.mock.calls.slice(-3).map(call => call[0].index)).toEqual([2, 3, 2]);
  await act(async () => {
    for (const handler of mocks.keys) {
      handler({ eventType: 'right', eventKeyAction: 0 });
      handler({ eventType: 'right', eventKeyAction: 1 });
      handler({ eventType: 'left', eventKeyAction: 1 });
    }
  });
  expect(options.onStepTime).toHaveBeenCalledTimes(2);
  expect(options.onStepTime).toHaveBeenNthCalledWith(1, 30);
  expect(options.onStepTime).toHaveBeenNthCalledWith(2, -30);
});

it('annullerer native fokusgentagelse synkront inden menuens naeste render', async () => {
  const cancelFocusRef = { current: null as (() => void) | null };
  const options = props({ returnFocusChannelId: channels[900]!.id, cancelFocusRef });
  await mount(options);
  expect(cancelFocusRef.current).toEqual(expect.any(Function));
  await act(async () => { cancelFocusRef.current!(); });
  await act(async () => { vi.advanceTimersByTime(1600); });
  expect(mocks.focus).not.toHaveBeenCalled();
  expect(options.onReturnFocus).not.toHaveBeenCalled();
});

it('Tilbage standser naeste metadatabatch synkront og indgangssignalet genoptager det synlige udsnit', async () => {
  const epg = deferred<unknown>();
  mocks.short.mockReturnValueOnce(epg.promise);
  const cancelFocusRef = { current: null as (() => void) | null };
  const options = props({ cancelFocusRef });
  await mount(options);
  expect(mocks.short).toHaveBeenCalledTimes(1);
  const shouldContinue = mocks.short.mock.calls[0]![6].shouldContinue as () => boolean;
  expect(shouldContinue()).toBe(true);
  const firstIds = new Set<string>(mocks.short.mock.calls[0]![3]);
  const reads = mocks.list.mock.calls.length;
  await act(async () => { cancelFocusRef.current!(); });
  expect(shouldContinue()).toBe(false);
  await act(async () => { epg.resolve({ failed: 0 }); });
  expect(mocks.short).toHaveBeenCalledTimes(1);
  expect(mocks.full).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledTimes(reads);

  // Sene native rulningsdata og urets nye halvtimesvindue maa ikke starte
  // guidens arbejde igen, mens menuen stadig har fokus.
  await act(async () => {
    tree!.root.findByType(host('NativeList')).props.onViewableItemsChanged({
      viewableItems: [{ item: channels[200], index: 200, isViewable: true }], changed: [],
    });
  });
  const afterBack = { ...options, now: new Date(options.now.getTime() + 30 * 60_000) };
  await act(async () => tree!.update(createElement(TimelineGrid, afterBack)));
  expect(mocks.short).toHaveBeenCalledTimes(1);
  expect(mocks.full).not.toHaveBeenCalled();
  expect(mocks.list).toHaveBeenCalledTimes(reads);

  // Guiden er fortsat aktiv bag menuen; pil hoejre sender et nyt signal.
  await act(async () => tree!.update(createElement(TimelineGrid, { ...afterBack, focusFirstSignal: 1 })));
  expect(mocks.list.mock.calls.length).toBeGreaterThan(reads);
  expect(mocks.short.mock.calls.slice(1).some(call => call[3].some((id: string) => !firstIds.has(id)))).toBe(true);
  expect(mocks.full.mock.calls.length).toBeGreaterThan(0);
  expect(new Set(mocks.list.mock.calls.flatMap(call => call[1])).size).toBeLessThan(50);
});

it('holder kun programdata for det synlige udsnit og fokus og deler ikke cachen mellem databaser', async () => {
  mocks.list.mockImplementation(programmesFor);
  await mount(props());
  await act(async () => row(0).props.onFocus());
  await view(100);
  expect(cached(100)[0]?.title).toBe('Program timeline:100');
  await view(200);
  expect(cached(200)[0]?.title).toBe('Program timeline:200');
  expect(cached(100)).toHaveLength(0);
  expect(cached(0)[0]?.title).toBe('Program timeline:0');
  expect(channels.filter((_item, index) => cached(index).length > 0).length).toBeLessThanOrEqual(23);

  await act(async () => { tree!.unmount(); tree = null; });
  await mount(props({ session: { ...session, db: {} } as AppSession, active: false }));
  expect(cached(0)).toHaveLength(0);
  expect(cached(200)).toHaveLength(0);
});

it('viser den varme foerste side straks efter rulning vaek og genindgang mens SQLite stadig venter', async () => {
  mocks.list.mockImplementation(programmesFor);
  const options = props();
  await mount(options);
  expect(cached(0)[0]?.title).toBe('Program timeline:0');
  await view(200);
  expect(cached(200)[0]?.title).toBe('Program timeline:200');
  await act(async () => { tree!.unmount(); tree = null; });

  const sqlite = deferred<Programme[]>();
  mocks.list.mockReturnValue(sqlite.promise);
  await mount(options);
  expect(cached(0)[0]?.title).toBe('Program timeline:0');
  expect(text(row(0))).toContain('Program timeline:0');
});

it('begraenser den varme cache til nylige udsnit og bevarer den foerste side', async () => {
  mocks.list.mockImplementation(programmesFor);
  await mount(props());
  for (let index = 0; index < 14; index += 1) await view(100 + index * 60);
  const sqlite = deferred<Programme[]>();
  mocks.list.mockReturnValue(sqlite.promise);
  await view(100);
  expect(cached(100)).toHaveLength(0);
  await view(0);
  expect(cached(0)[0]?.title).toBe('Program timeline:0');
});

it('viser et nyt synligt cacheudsnit uden at vente paa den gamle udbyderhentning', async () => {
  const oldProvider = deferred<unknown>();
  mocks.short.mockReturnValueOnce(oldProvider.promise);
  mocks.list.mockImplementation(programmesFor);
  await mount(props());
  expect(mocks.short).toHaveBeenCalledTimes(1);
  const reads = mocks.list.mock.calls.length;
  await view(100);
  expect(mocks.list.mock.calls.length).toBeGreaterThan(reads);
  expect(cached(100)[0]?.title).toBe('Program timeline:100');
  expect(mocks.short).toHaveBeenCalledTimes(1);
  expect(mocks.full).not.toHaveBeenCalled();
  await act(async () => { oldProvider.resolve({ failed: 0 }); });
  expect(cached(100)[0]?.title).toBe('Program timeline:100');
});

it('et sent svar fra det gamle tidsvindue kan ikke overskrive det nye halvtimesvindue', async () => {
  const oldRead = deferred<Programme[]>();
  const provider = deferred<unknown>();
  mocks.short.mockReturnValue(provider.promise);
  mocks.list.mockImplementation(async (_db, ids: string[]) => ids.map(id => programme(id, 'Nyt tidsvindue')));
  mocks.list.mockReturnValueOnce(oldRead.promise);
  const options = props();
  await mount(options);
  await act(async () => tree!.update(createElement(TimelineGrid, { ...options, offsetMinutes: 30 })));
  expect(cached(0)[0]?.title).toBe('Nyt tidsvindue');
  const reads = mocks.list.mock.calls;
  expect(reads.at(-1)![2].getTime() - reads[0]![2].getTime()).toBe(30 * 60_000);
  expect(reads.at(-1)![3].getTime() - reads.at(-1)![2].getTime()).toBe(90 * 60_000);
  await act(async () => { oldRead.resolve([programme(channels[0]!.id, 'Gammelt tidsvindue')]); });
  expect(cached(0)[0]?.title).toBe('Nyt tidsvindue');
  expect(text(row(0))).not.toContain('Gammelt tidsvindue');
});

it('et tomt SQLite-svar ved genindgang rydder ikke den allerede varme programvisning', async () => {
  mocks.list.mockImplementation(programmesFor);
  const options = props();
  await mount(options);
  expect(cached(0)[0]?.title).toBe('Program timeline:0');
  await act(async () => { tree!.unmount(); tree = null; });

  const previousReads = mocks.list.mock.calls.length;
  mocks.list.mockResolvedValue([]);
  await mount(options);
  expect(mocks.list.mock.calls.length).toBeGreaterThan(previousReads);
  expect(cached(0)[0]?.title).toBe('Program timeline:0');
  expect(text(row(0))).toContain('Program timeline:0');
});

it.each(['inactive', 'unmount'] as const)('stopper et sent cache-svar efter %s', async (stop) => {
  const cache = deferred<Programme[]>();
  mocks.list.mockReturnValue(cache.promise);
  const options = props({ channels: channels.slice(0, 12) });
  await mount(options);
  const reads = mocks.list.mock.calls.length;
  const requests = mocks.short.mock.calls.length;
  const fullRequests = mocks.full.mock.calls.length;
  await act(async () => {
    if (stop === 'unmount') { tree!.unmount(); tree = null; }
    else tree!.update(createElement(TimelineGrid, { ...options, active: false }));
  });
  await act(async () => {
    cache.resolve([{ channelId: channels[0]!.id, title: 'Sent program', description: null,
      start: new Date(Date.now() - 60_000), stop: new Date(Date.now() + 60_000) }]);
  });
  expect(mocks.list).toHaveBeenCalledTimes(reads);
  expect(mocks.short).toHaveBeenCalledTimes(requests);
  expect(mocks.full).toHaveBeenCalledTimes(fullRequests);
  if (tree !== null) expect(text(tree.toJSON())).not.toContain('Sent program');
});

it.each(['inactive', 'unmount'] as const)('starter ikke fuld EPG efter et sent kort EPG-svar og %s', async (stop) => {
  const epg = deferred<unknown>();
  mocks.short.mockReturnValue(epg.promise);
  const options = props({ channels: channels.slice(0, 12) });
  await mount(options);
  expect(mocks.short.mock.calls.length).toBeGreaterThan(0);
  expect(mocks.full).not.toHaveBeenCalled();
  const reads = mocks.list.mock.calls.length;
  const requests = mocks.short.mock.calls.length;
  await act(async () => {
    if (stop === 'unmount') { tree!.unmount(); tree = null; }
    else tree!.update(createElement(TimelineGrid, { ...options, active: false }));
  });
  await act(async () => { epg.resolve({ failed: 0 }); });
  expect(mocks.list).toHaveBeenCalledTimes(reads);
  expect(mocks.short).toHaveBeenCalledTimes(requests);
  expect(mocks.full).not.toHaveBeenCalled();
});

it('annullerer ogsaa kanaler inde i den fulde EPG-batch naar afspilleren daekker guiden', async () => {
  const pending = deferred<unknown>();
  mocks.full.mockReturnValue(pending.promise);
  const options = props({ channels: channels.slice(0, 12) });
  await mount(options);
  expect(mocks.full).toHaveBeenCalledTimes(1);
  const shouldContinue = mocks.full.mock.calls[0]![5].shouldContinue as () => boolean;
  expect(shouldContinue()).toBe(true);
  await act(async () => tree!.update(createElement(TimelineGrid, { ...options, active: false })));
  expect(shouldContinue()).toBe(false);
  await act(async () => pending.resolve({ failed: 0 }));
  expect(mocks.full).toHaveBeenCalledTimes(1);
});
